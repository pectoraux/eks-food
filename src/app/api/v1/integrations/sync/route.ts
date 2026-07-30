import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const configId = req.nextUrl.searchParams.get("configId");
  const where: Record<string, unknown> = {};
  if (orgId) where.organizationId = orgId;
  if (configId) where.configId = configId;
  const jobs = await db.synchronizationJob.findMany({
    where,
    include: { _count: { select: { checkpoints: true } }, config: { include: { connectorDef: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return success(jobs);
});
