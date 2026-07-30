import { NextRequest } from "next/server";
import { logout, sessionService } from "@eks/auth";
import { verifyCookie } from "@eks/security";
import { getConfig } from "@eks/config";
import { success, noContent } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler(async (req: NextRequest) => {
  const secret = getConfig().security.secretKey;
  const raw = req.cookies.get("__Host-eks_access")?.value;
  if (raw) {
    const token = await verifyCookie(raw, secret);
    if (token) await logout(token);
  }
  const headers = new Headers();
  headers.append("set-cookie", "__Host-eks_access=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  headers.append("set-cookie", "__Host-eks_refresh=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  const res = noContent();
  headers.forEach((v, k) => res.headers.append(k, v));
  return res;
});

/** GET /api/v1/auth/me — current session user. */
export const GET = apiHandler(async (req: NextRequest) => {
  const secret = getConfig().security.secretKey;
  const raw = req.cookies.get("__Host-eks_access")?.value;
  if (!raw) return success({ user: null });
  const token = await verifyCookie(raw, secret);
  if (!token) return success({ user: null });
  const session = await sessionService.validate(token);
  if (!session) return success({ user: null });
  const { db } = await import("@/lib/db");
  const user = await db.user.findUnique({ where: { id: session.userId }, select: { id: true, email: true, name: true, organizationId: true, status: true, avatarUrl: true } });
  return success({ user, session });
});
