import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest) => {
  const configId = req.nextUrl.searchParams.get("configId");
  const where = configId ? { configId } : {};
  const jobs = await db.pollingJob.findMany({ where, include: { config: { include: { connectorDef: true } } }, orderBy: { lastPollAt: "desc" }, take: 50 });
  return success(jobs);
});
