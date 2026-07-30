import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { MFAService } from "@eks/auth";
import { sessionService } from "@eks/auth";
import { verifyCookie } from "@eks/security";
import { getConfig } from "@eks/config";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { UnauthorizedError } from "@eks/errors";

export const dynamic = "force-dynamic";

const mfa = new MFAService();

async function currentUserId(req: NextRequest): Promise<string> {
  const secret = getConfig().security.secretKey;
  const raw = req.cookies.get("__Host-eks_access")?.value;
  if (!raw) throw new UnauthorizedError("Not authenticated");
  const token = await verifyCookie(raw, secret);
  if (!token) throw new UnauthorizedError("Invalid session");
  const session = await sessionService.validate(token);
  if (!session) throw new UnauthorizedError("Session expired");
  return session.userId;
}

/** POST /api/v1/mfa/enroll — generate a TOTP secret + recovery codes for the current user. */
export const POST = apiHandler(async (req: NextRequest) => {
  const userId = await currentUserId(req);
  const body = await req.json().catch(() => ({}));
  const email = body.email ?? userId;
  const totp = mfa.generateTOTP(email);
  const recovery = await mfa.generateRecoveryCodes(10);
  // Store the (encrypted) secret + recovery-code hashes, but DON'T enable yet.
  await db.mFAConfiguration.upsert({
    where: { userId_method: { userId, method: "TOTP" } },
    update: { secret: totp.encrypted, enabled: false },
    create: { userId, method: "TOTP", secret: totp.encrypted, enabled: false },
  });
  // Replace recovery codes.
  await db.recoveryCode.deleteMany({ where: { userId, usedAt: null } });
  for (const code of recovery) {
    await db.recoveryCode.create({ data: { userId, codeHash: code.hash } });
  }
  return success({ otpauthUri: totp.otpauthUri, recoveryCodes: recovery.map((c) => c.plaintext) });
});
