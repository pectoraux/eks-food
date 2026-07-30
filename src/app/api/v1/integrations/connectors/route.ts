import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const where = orgId ? { organizationId: orgId } : {};
  const configs = await db.connectorConfigurationV2.findMany({
    where,
    include: { connectorDef: true, credential: true, _count: { select: { executions: true, syncJobs: true, webhookEndpoints: true, pollingJobs: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return success(configs);
});
