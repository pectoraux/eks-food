import { NextRequest } from "next/server";
import { healthRegistry } from "@eks/observability/health";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

/** GET /api/v1/health — aggregated liveness + readiness report. */
export const GET = apiHandler(async (req: NextRequest) => {
  const kind = req.nextUrl.searchParams.get("kind") as "liveness" | "readiness" | undefined;
  const report = await healthRegistry().run(kind ?? undefined);
  return success(report, { status: report.status === "healthy" ? 200 : 503 });
});
