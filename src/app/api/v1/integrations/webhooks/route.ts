import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const where = orgId ? { organizationId: orgId } : {};
  const endpoints = await db.webhookEndpoint.findMany({
    where,
    include: { _count: { select: { deliveries: true } }, config: { include: { connectorDef: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return success(endpoints);
});
