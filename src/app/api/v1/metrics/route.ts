import { NextRequest, NextResponse } from "next/server";
import { metrics } from "@eks/observability/metrics";

export const dynamic = "force-dynamic";

/** GET /api/v1/metrics — OpenMetrics/Prometheus text export. */
export function GET(_req: NextRequest) {
  const text = metrics().toPrometheusText();
  return new NextResponse(text, {
    headers: { "content-type": "text/plain; version=0.0.4" },
  });
}
