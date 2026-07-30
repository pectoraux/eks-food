import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const where = orgId ? { organizationId: orgId } : {};
  return success(await db.connectorCredential.findMany({ where, select: { id: true, name: true, authType: true, active: true, expiresAt: true, lastRotatedAt: true, lastUsedAt: true, createdAt: true, organizationId: true, connectorDefId: true }, orderBy: { createdAt: "desc" } }));
});
