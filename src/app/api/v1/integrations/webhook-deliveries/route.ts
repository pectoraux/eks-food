import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest) => {
  const endpointId = req.nextUrl.searchParams.get("endpointId");
  const status = req.nextUrl.searchParams.get("status");
  const where: Record<string, unknown> = {};
  if (endpointId) where.endpointId = endpointId;
  if (status) where.status = status;
  const deliveries = await db.webhookDelivery.findMany({ where, orderBy: { firstAttemptAt: "desc" }, take: 100 });
  return success(deliveries);
});
