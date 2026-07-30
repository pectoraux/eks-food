import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest) => {
  const extId = req.nextUrl.searchParams.get("extensionId");
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const level = req.nextUrl.searchParams.get("level");
  const where: Record<string, unknown> = {};
  if (extId) where.extensionId = extId;
  if (orgId) where.organizationId = orgId;
  if (level) where.level = level;
  const logs = await db.extensionLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  return success(logs);
});
