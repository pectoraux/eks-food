import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
  const { id } = await ctx.params;
  const config = await db.connectorConfigurationV2.findUnique({
    where: { id },
    include: { connectorDef: true, credential: true, schedules: true, pollingJobs: true, _count: { select: { executions: true, syncJobs: true, webhookEndpoints: true, health: true } } },
  });
  return success(config);
});
