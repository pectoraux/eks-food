import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

/** GET /api/v1/users — list users (admin) with filtering by org/status. */
export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const orgId = sp.get("organizationId");
  const status = sp.get("status");
  const q = sp.get("q")?.toLowerCase();
  const where: Record<string, unknown> = {};
  if (orgId) where.organizationId = orgId;
  if (status) where.status = status;
  if (q) where.email = { contains: q };
  const users = await db.user.findMany({
    where,
    select: { id: true, email: true, name: true, phone: true, status: true, organizationId: true, roles: true, lastLoginAt: true, createdAt: true, deletedAt: true, _count: { select: { memberships: true, sessions: true, identities: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return success(users);
});
