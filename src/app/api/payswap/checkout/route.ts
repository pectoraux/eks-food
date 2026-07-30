import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolvePrincipal, authorize, safeActorId } from "@/lib/auth";
import { payswap, genIdempotencyKey } from "@/lib/payswap";

export const dynamic = "force-dynamic";

const CheckoutSchema = z.object({
  bookingCode: z.string(),
  customerEmail: z.string().email().optional(),
});

/**
 * POST /api/payswap/checkout
 * Creates a Payswap-hosted Checkout Session for a booking. Eks-Food never sees
 * card / mobile money credentials — the customer authorises on Payswap.
 */
export async function POST(req: NextRequest) {
  const principal = resolvePrincipal(req.headers);
  authorize(principal, "payment.initiate");

  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed", issues: parsed.error.issues }, { status: 422 });

  const booking = await db.booking.findFirst({ where: { code: parsed.data.bookingCode, organizationId: org.id }, include: { service: true } });
  if (!booking) return NextResponse.json({ error: "booking_not_found" }, { status: 404 });

  // Reuse the payment intent already attached to the booking (created at booking
  // time). This keeps the booking ↔ payment linkage intact so the confirm step
  // can transition the booking to CONFIRMED. Only create a new intent if none
  // exists yet (defensive).
  let paymentId = booking.payswapPaymentId;
  let intent;
  if (paymentId) {
    intent = { payswapId: paymentId, clientSecret: `${paymentId}_secret`, status: "REQUIRES_ACTION", amount: booking.quotedPrice, currency: booking.currency };
  } else {
    intent = await payswap.createPaymentIntent({
      organizationId: org.id,
      bookingCode: booking.code,
      amount: booking.quotedPrice,
      currency: booking.currency,
      idempotencyKey: genIdempotencyKey("pi"),
      description: `${booking.service.name} — ${booking.code}`,
    });
    paymentId = intent.payswapId;
    await db.booking.update({ where: { id: booking.id }, data: { payswapPaymentId: paymentId } });
  }

  // In production this would be a signed Payswap-hosted URL.
  const resolvedPaymentId = paymentId ?? intent.payswapId;
  const url = `/checkout?session=${resolvedPaymentId}`;
  const session = {
    payswapId: `cs_${resolvedPaymentId.slice(3, 13)}`,
    url,
    paymentId: resolvedPaymentId,
    status: "REQUIRES_ACTION" as const,
  };

  await db.auditLog.create({
    data: {
      organizationId: org.id,
      actorUserId: safeActorId(principal),
      action: "CHECKOUT_SESSION_CREATED",
      entityType: "Booking",
      entityId: booking.id,
      metadata: JSON.stringify({ session: session.payswapId, paymentId: session.paymentId }),
    },
  });

  return NextResponse.json({
    sessionId: session.payswapId,
    paymentId: session.paymentId,
    url: session.url,
    amount: booking.quotedPrice,
    currency: booking.currency,
    status: session.status,
  });
}
