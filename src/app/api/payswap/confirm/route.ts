import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { payswap } from "@/lib/payswap";

export const dynamic = "force-dynamic";

const ConfirmSchema = z.object({
  payswapId: z.string(),
  method: z.enum(["mobile_money", "card", "bank_transfer"]).default("mobile_money"),
  provider: z.string().optional(),
});

/**
 * POST /api/payswap/confirm
 * Confirms a Payswap payment intent. In production Payswap invokes the webhook
 * on success; for the reference deployment the hosted checkout page calls this
 * endpoint, mirroring the same state transitions.
 */
export async function POST(req: NextRequest) {
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed", issues: parsed.error.issues }, { status: 422 });
  const input = parsed.data;

  const intent = await payswap.confirmPayment(input.payswapId, {
    method: input.method,
    provider: input.provider ?? (input.method === "mobile_money" ? "mtn" : "visa"),
    ref: "MOCK-" + Math.floor(Math.random() * 1e6),
  });

  // Mark booking CONFIRMED + trigger worker payout (transfer via Payswap).
  // Look up the booking via the payment intent's payswapId first, then fall
  // back to the payment's bookingCode for robustness.
  let booking = await db.booking.findFirst({ where: { payswapPaymentId: input.payswapId, organizationId: org.id }, include: { cook: true, service: true } });
  if (!booking) {
    const payment = await db.payswapPayment.findUnique({ where: { payswapId: input.payswapId } });
    if (payment?.bookingCode) {
      booking = await db.booking.findFirst({ where: { code: payment.bookingCode, organizationId: org.id }, include: { cook: true, service: true } });
    }
  }
  if (booking) {
    await db.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } });
    if (booking.cookId && booking.cook) {
      const payoutAmount = Math.round(booking.quotedPrice * 0.8 * 100) / 100; // 80% cook share
      await payswap.createTransfer({
        organizationId: org.id,
        payeeUserId: booking.cook.userId,
        amount: payoutAmount,
        currency: booking.currency,
        idempotencyKey: `payout_${booking.code}`,
        metadata: { bookingCode: booking.code, service: booking.service.code },
      });
    }
  }

  return NextResponse.json({
    payswapId: intent.payswapId,
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
    bookingCode: booking?.code ?? null,
    payoutInitiated: !!booking?.cookId,
  });
}
