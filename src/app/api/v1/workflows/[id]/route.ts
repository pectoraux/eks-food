import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
  const { id } = await ctx.params;
  const limit = Math.min(50, Number(req.nextUrl.searchParams.get("limit") ?? 20));
  const executions = await db.workflowExecution.findMany({
    where: { workflowDefId: id },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return success(executions);
});
