import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
  const { id } = await ctx.params;
  const job = await db.synchronizationJob.findUnique({
    where: { id },
    include: { checkpoints: true, config: { include: { connectorDef: true } } },
  });
  return success(job);
});
