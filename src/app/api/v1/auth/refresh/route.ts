import { NextRequest } from "next/server";
import { sessionService } from "@eks/auth";
import { verifyCookie, signCookie } from "@eks/security";
import { getConfig } from "@eks/config";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { UnauthorizedError } from "@eks/errors";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/refresh — rotate the refresh token, issue new access+refresh. */
export const POST = apiHandler(async (req: NextRequest) => {
  const secret = getConfig().security.secretKey;
  const raw = req.cookies.get("__Host-eks_refresh")?.value;
  if (!raw) throw new UnauthorizedError("No refresh token");
  const token = await verifyCookie(raw, secret);
  if (!token) throw new UnauthorizedError("Invalid refresh token");
  const result = await sessionService.refresh(token);
  if (!result) throw new UnauthorizedError("Session expired or revoked");

  const accessCookie = await signCookie(result.accessToken.token, secret);
  const refreshCookie = await signCookie(result.refreshToken.token, secret);
  const headers = new Headers();
  headers.append("set-cookie", `__Host-eks_access=${accessCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);
  headers.append("set-cookie", `__Host-eks_refresh=${refreshCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  const res = success({ session: result.session });
  headers.forEach((v, k) => res.headers.append(k, v));
  return res;
});
