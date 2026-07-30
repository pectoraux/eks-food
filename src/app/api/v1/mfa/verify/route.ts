import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { MFAService, sessionService } from "@eks/auth";
import { verifyCookie } from "@eks/security";
import { getConfig } from "@eks/config";
import { buildIdentityEvent } from "@eks/identity";
import { outbox } from "@eks/events";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { UnauthorizedError, ValidationError } from "@eks/errors";
import { asUUID } from "@eks/common";

export const dynamic = "force-dynamic";

const mfa = new MFAService();
const Schema = z.object({ token: z.string().length(6) });

export const POST = apiHandler(async (req: NextRequest) => {
  const secret = getConfig().security.secretKey;
  const raw = req.cookies.get("__Host-eks_access")?.value;
  if (!raw) throw new UnauthorizedError("Not authenticated");
  const token = await verifyCookie(raw, secret);
  if (!token) throw new UnauthorizedError("Invalid session");
  const session = await sessionService.validate(token);
  if (!session) throw new UnauthorizedError("Session expired");
  const body = await req.json();
  const input = Schema.parse(body);
  const config = await db.mFAConfiguration.findUnique({ where: { userId_method: { userId: session.userId, method: "TOTP" } } });
  if (!config) throw new ValidationError("No MFA enrollment found");
  const valid = mfa.verifyTOTP(input.token, config.secret);
  if (!valid) throw new UnauthorizedError("Invalid TOTP code");
  await db.mFAConfiguration.update({ where: { id: config.id }, data: { enabled: true, enrolledAt: new Date() } });
  const event = buildIdentityEvent("MFAEnabled", asUUID(session.userId), { method: "TOTP" });
  await outbox().stage(event);
  return success({ enabled: true });
});
