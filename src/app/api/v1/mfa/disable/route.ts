import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sessionService } from "@eks/auth";
import { verifyCookie } from "@eks/security";
import { getConfig } from "@eks/config";
import { buildIdentityEvent } from "@eks/identity";
import { outbox } from "@eks/events";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { UnauthorizedError } from "@eks/errors";
import { asUUID } from "@eks/common";

export const dynamic = "force-dynamic";

export const POST = apiHandler(async (req: NextRequest) => {
  const secret = getConfig().security.secretKey;
  const raw = req.cookies.get("__Host-eks_access")?.value;
  if (!raw) throw new UnauthorizedError("Not authenticated");
  const token = await verifyCookie(raw, secret);
  if (!token) throw new UnauthorizedError("Invalid session");
  const session = await sessionService.validate(token);
  if (!session) throw new UnauthorizedError("Session expired");
  await db.mFAConfiguration.updateMany({ where: { userId: session.userId }, data: { enabled: false } });
  const event = buildIdentityEvent("MFADisabled", asUUID(session.userId), {});
  await outbox().stage(event);
  return success({ enabled: false });
});
