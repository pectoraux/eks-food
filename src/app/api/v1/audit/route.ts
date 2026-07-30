import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

/** GET /api/v1/audit — paginated audit log with filtering. */
export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const orgId = sp.get("organizationId");
  const action = sp.get("action");
  const entityType = sp.get("entityType");
  const actorUserId = sp.get("actorUserId");
  const limit = Math.min(100, Number(sp.get("limit") ?? 50));
  const offset = Number(sp.get("offset") ?? 0);

  const where: Record<string, unknown> = {};
  if (orgId) where.organizationId = orgId;
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (actorUserId) where.actorUserId = actorUserId;

  const [entries, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    db.auditLog.count({ where }),
  ]);
  return success({ items: entries, total, limit, offset, hasMore: offset + entries.length < total });
});
