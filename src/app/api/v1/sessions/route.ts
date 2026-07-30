import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sessionService } from "@eks/auth";
import { verifyCookie } from "@eks/security";
import { getConfig } from "@eks/config";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { UnauthorizedError } from "@eks/errors";

export const dynamic = "force-dynamic";

/** GET /api/v1/sessions — list sessions for the current user (or all, for admins). */
export const GET = apiHandler(async (req: NextRequest) => {
  const secret = getConfig().security.secretKey;
  const raw = req.cookies.get("__Host-eks_access")?.value;
  if (!raw) throw new UnauthorizedError("Not authenticated");
  const token = await verifyCookie(raw, secret);
  if (!token) throw new UnauthorizedError("Invalid session");
  const session = await sessionService.validate(token);
  if (!session) throw new UnauthorizedError("Session expired");
  const userId = req.nextUrl.searchParams.get("userId") ?? session.userId;
  return success(await sessionService.listForUser(userId));
});

/** DELETE /api/v1/sessions — revoke a session by id (or all for the user). */
export const DELETE = apiHandler(async (req: NextRequest) => {
  const sessionId = req.nextUrl.searchParams.get("id");
  const all = req.nextUrl.searchParams.get("all") === "1";
  if (all) {
    const secret = getConfig().security.secretKey;
    const raw = req.cookies.get("__Host-eks_access")?.value;
    if (!raw) throw new UnauthorizedError("Not authenticated");
    const token = await verifyCookie(raw, secret);
    if (token) {
      const session = await sessionService.validate(token);
      if (session) {
        const count = await sessionService.revokeAllForUser(session.userId, "REMOTE_LOGOUT");
        return success({ revoked: count });
      }
    }
    return success({ revoked: 0 });
  }
  if (sessionId) {
    await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date(), revokeReason: "ADMIN_REVOKE" } });
    return success({ revoked: 1 });
  }
  return success({ revoked: 0 });
});
