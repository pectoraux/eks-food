import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/bookings/[code] — single booking with full dispatch + payment context. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  const booking = await db.booking.findFirst({
    where: { code, organizationId: org.id },
    include: { service: true, customer: { include: { user: true } }, cook: { include: { user: true } } },
  });
  if (!booking) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const payment = booking.payswapPaymentId
    ? await db.payswapPayment.findUnique({ where: { payswapId: booking.payswapPaymentId } })
    : null;

  return NextResponse.json({
    code: booking.code,
    bookingType: booking.bookingType,
    status: booking.status,
    scheduledFor: booking.scheduledFor,
    durationMins: booking.durationMins,
    partySize: booking.partySize,
    address: { line1: booking.addressLine1, city: booking.city, region: booking.region, lat: booking.lat, lng: booking.lng },
    notes: booking.notes,
    quotedPrice: booking.quotedPrice,
    currency: booking.currency,
    matchScore: booking.matchScore,
    matchDebug: booking.matchDebug ? JSON.parse(booking.matchDebug) : null,
    service: { code: booking.service.code, name: booking.service.name, description: booking.service.description },
    customer: { name: booking.customer.user.name },
    cook: booking.cook ? {
      cookId: booking.cook.id,
      name: booking.cook.user.name,
      avatarUrl: booking.cook.avatarUrl,
      rating: booking.cook.rating,
      cuisines: booking.cook.cuisines.split("|").filter(Boolean),
    } : null,
    payment: payment ? {
      payswapId: payment.payswapId,
      status: payment.status,
      amount: payment.amount,
      methodSummary: JSON.parse(payment.methodSummary),
    } : null,
  });
}
