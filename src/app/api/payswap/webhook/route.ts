import { NextRequest, NextResponse } from "next/server";
import { payswap } from "@/lib/payswap";

export const dynamic = "force-dynamic";

/**
 * POST /api/payswap/webhook
 * In production this verifies the Payswap signature header and dispatches the
 * event to a BullMQ queue. The handler is idempotent: re-deliveries are safe.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const result = await payswap.handleWebhook(body as any);
  return NextResponse.json(result);
}
