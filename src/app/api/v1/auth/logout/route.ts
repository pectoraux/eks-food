import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success, noContent } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Logout — clears the session cookie and revokes the session in the DB.
 * Works on both localhost (eks_access) and production (__Host-eks_access).
 */
export async function POST(req: NextRequest) {
  const isProduction = process.env.NODE_ENV === "production";
  const cookieName = isProduction ? "__Host-eks_access" : "eks_access";

  const raw = req.cookies.get(cookieName)?.value;
  if (raw) {
    // Revoke the session in the DB
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    try {
      await db.session.updateMany({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Best-effort — the cookie is cleared regardless
    }
  }

  const headers = new Headers();
  const secureFlag = isProduction ? "; Secure" : "";
  headers.append(
    "set-cookie",
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
  );
  // Also clear the other cookie name in case of environment mismatch
  const otherCookie = isProduction ? "eks_access" : "__Host-eks_access";
  headers.append(
    "set-cookie",
    `${otherCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
  );

  const res = success({ ok: true, message: "Logged out successfully" });
  headers.forEach((v, k) => res.headers.append(k, v));
  return res;
}

/** GET /api/v1/auth/logout — returns current session user (for the app shell). */
export const GET = apiHandler(async (req: NextRequest) => {
  const isProduction = process.env.NODE_ENV === "production";
  const cookieName = isProduction ? "__Host-eks_access" : "eks_access";
  const raw = req.cookies.get(cookieName)?.value;

  if (!raw) return success({ user: null });

  const tokenHash = createHash("sha256").update(raw).digest("hex");

  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return success({ user: null });
  }

  return success({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      roles: session.user.roles,
      organizationId: session.user.organizationId,
    },
  });
});
