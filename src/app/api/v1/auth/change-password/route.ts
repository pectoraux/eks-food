import { NextRequest } from "next/server";
import { z } from "zod";
import { changePassword } from "@eks/auth";
import { verifyCookie } from "@eks/security";
import { getConfig } from "@eks/config";
import { sessionService } from "@eks/auth";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { UnauthorizedError } from "@eks/errors";

export const dynamic = "force-dynamic";

const Schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

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
  await changePassword(session.userId, input.currentPassword, input.newPassword);
  return success({ ok: true });
});
