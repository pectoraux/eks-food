import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { MFAService, sessionService } from "@eks/auth";
import { verifyCookie } from "@eks/security";
import { getConfig } from "@eks/config";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { UnauthorizedError } from "@eks/errors";

export const dynamic = "force-dynamic";

const mfa = new MFAService();

export const GET = apiHandler(async (req: NextRequest) => {
  const secret = getConfig().security.secretKey;
  const raw = req.cookies.get("__Host-eks_access")?.value;
  if (!raw) throw new UnauthorizedError("Not authenticated");
  const token = await verifyCookie(raw, secret);
  if (!token) throw new UnauthorizedError("Invalid session");
  const session = await sessionService.validate(token);
  if (!session) throw new UnauthorizedError("Session expired");
  const codes = await db.recoveryCode.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "asc" } });
  return success({ total: codes.length, used: codes.filter((c) => c.usedAt).length, remaining: codes.filter((c) => !c.usedAt).length });
});

export const POST = apiHandler(async (req: NextRequest) => {
  const secret = getConfig().security.secretKey;
  const raw = req.cookies.get("__Host-eks_access")?.value;
  if (!raw) throw new UnauthorizedError("Not authenticated");
  const token = await verifyCookie(raw, secret);
  if (!token) throw new UnauthorizedError("Invalid session");
  const session = await sessionService.validate(token);
  if (!session) throw new UnauthorizedError("Session expired");
  const recovery = await mfa.generateRecoveryCodes(10);
  await db.recoveryCode.deleteMany({ where: { userId: session.userId } });
  for (const code of recovery) {
    await db.recoveryCode.create({ data: { userId: session.userId, codeHash: code.hash } });
  }
  return success({ recoveryCodes: recovery.map((c) => c.plaintext) });
});
