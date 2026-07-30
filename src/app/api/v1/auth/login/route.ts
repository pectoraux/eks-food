import { NextRequest } from "next/server";
import { z } from "zod";
import { login } from "@eks/auth";
import { signCookie } from "@eks/security";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { getConfig } from "@eks/config";

export const dynamic = "force-dynamic";

const Schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationId: z.string().optional(),
  mfaToken: z.string().optional(),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const ua = req.headers.get("user-agent") ?? undefined;
  const result = await login({ ...input, ipAddress: ip, userAgent: ua });

  if ("mfaRequired" in result && result.mfaRequired) {
    return success({ mfaRequired: true, challengeToken: result.challengeToken });
  }

  // Set secure session cookies.
  const secret = getConfig().security.secretKey;
  const accessCookie = await signCookie(result.accessToken.token, secret);
  const refreshCookie = await signCookie(result.refreshToken.token, secret);
  const headers = new Headers();
  headers.append("set-cookie", `__Host-eks_access=${accessCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);
  headers.append("set-cookie", `__Host-eks_refresh=${refreshCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);

  const res = success({ user: result.user, session: result.session, mfaRequired: false });
  res.headers.delete("set-cookie");
  headers.forEach((v, k) => res.headers.append(k, v));
  return res;
});
