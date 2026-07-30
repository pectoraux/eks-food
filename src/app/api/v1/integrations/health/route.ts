import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { HealthMonitor } from "@eks/integration";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

const monitor = new HealthMonitor();

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  if (!orgId) return success([]);
  return success(await monitor.dashboard(orgId));
});
