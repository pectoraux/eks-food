import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const where = orgId ? { organizationId: orgId } : {};
  const workflows = await db.workflowDefinition.findMany({
    where,
    include: { _count: { select: { executions: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return success(workflows);
});
