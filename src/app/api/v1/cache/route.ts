import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const where = orgId ? { organizationId: orgId } : {};
  const entries = await db.connectorCache.findMany({ where, orderBy: { lastAccessedAt: "desc" }, take: 50 });
  return success(entries.map((e) => ({ ...e, value: undefined })));
});
