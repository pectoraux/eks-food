import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolvePrincipal, authorize, safeActorId } from "@/lib/auth";
import { matchCooks, autoAssign } from "@/lib/matching";
import { payswap, genIdempotencyKey } from "@/lib/payswap";

export const dynamic = "force-dynamic";

const CreateBookingSchema = z.object({
  serviceCode: z.string(),
  bookingType: z.enum(["IMMEDIATE", "SCHEDULED", "RECURRING", "EVENT", "CORPORATE", "SUBSCRIPTION"]),
  scheduledFor: z.string(),
  durationMins: z.number().int().min(30).max(600),
  partySize: z.number().int().min(1).max(200),
  addressLine1: z.string().min(3),
  city: z.string(),
  region: z.string(),
  lat: z.number(),
  lng: z.number(),
  notes: z.string().optional(),
  cuisines: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  autoAssign: z.boolean().default(true),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
});

/**
 * POST /api/bookings
 * Creates a booking, runs the matching engine, auto-assigns when configured,
 * and creates a Payswap payment intent (no charge yet). Idempotent on booking
 * code generation is request-scoped.
 */
export async function POST(req: NextRequest) {
  const principal = resolvePrincipal(req.headers);
  authorize(principal, "booking.create");

  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = CreateBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", issues: parsed.error.issues }, { status: 422 });
  }
  const input = parsed.data;

  const service = await db.service.findFirst({ where: { organizationId: org.id, code: input.serviceCode } });
  if (!service) return NextResponse.json({ error: "unknown_service" }, { status: 422 });

  // Resolve or create a demo customer for the principal.
  let customer = await db.customer.findFirst({ where: { organizationId: org.id, userId: principal.userId } });
  if (!customer) {
    const email = input.customerEmail ?? `demo+${principal.userId}@eks.food`;
    const user = await db.user.upsert({
      where: { email },
      update: { name: input.customerName ?? principal.name, organizationId: org.id },
      create: {
        email,
        name: input.customerName ?? principal.name,
        organizationId: org.id,
        roles: "CUSTOMER",
        status: "ACTIVE",
      },
    });
    // Guard the unique(userId) constraint: a customer may already exist from a
    // prior partial run. Re-fetch before creating.
    customer = await db.customer.findFirst({ where: { userId: user.id } });
    if (!customer) {
      customer = await db.customer.create({ data: { organizationId: org.id, userId: user.id } });
    }
  }

  const scheduledFor = new Date(input.scheduledFor);
  // Quoted price: service base + hourly component for extra duration.
  const baseHours = service.estimatedMins / 60;
  const requestedHours = input.durationMins / 60;
  const extraHours = Math.max(0, requestedHours - baseHours);
  const quotedPrice = Math.round((service.basePrice + extraHours * 45) * 100) / 100;

  const code = `EKS-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.floor(Math.random() * 9)}`;

  const candidates = await matchCooks({
    organizationId: org.id,
    customerId: customer.userId,
    lat: input.lat,
    lng: input.lng,
    cuisines: input.cuisines,
    languages: input.languages,
    scheduledFor,
  });

  const booking = await db.booking.create({
    data: {
      organizationId: org.id,
      code,
      customerId: customer.id,
      serviceId: service.id,
      bookingType: input.bookingType,
      scheduledFor,
      durationMins: input.durationMins,
      partySize: input.partySize,
      addressLine1: input.addressLine1,
      city: input.city,
      region: input.region,
      lat: input.lat,
      lng: input.lng,
      notes: input.notes,
      status: "PENDING_MATCH",
      quotedPrice,
      currency: org.baseCurrency,
      matchDebug: JSON.stringify({ topCandidate: candidates[0] ? { name: candidates[0].name, score: candidates[0].score } : null }),
    },
  });

  let assignment: { assigned: boolean; cookId?: string; matchScore?: number; reason: string } | undefined;
  if (input.autoAssign) {
    assignment = await autoAssign(booking.id, candidates);
  }

  // Create Payswap payment intent (no charge yet — customer confirms on checkout).
  const intent = await payswap.createPaymentIntent({
    organizationId: org.id,
    bookingCode: code,
    customerId: customer.userId,
    amount: quotedPrice,
    currency: org.baseCurrency,
    idempotencyKey: genIdempotencyKey("pi"),
    description: `${service.name} — ${code}`,
  });

  await db.booking.update({ where: { id: booking.id }, data: { payswapPaymentId: intent.payswapId } });

  await db.auditLog.create({
    data: {
      organizationId: org.id,
      actorUserId: safeActorId(principal),
      action: "BOOKING_CREATED",
      entityType: "Booking",
      entityId: booking.id,
      metadata: JSON.stringify({ code, serviceCode: service.code, quotedPrice, candidates: candidates.length }),
    },
  });

  return NextResponse.json({
    code,
    bookingId: booking.id,
    status: assignment?.assigned ? "ASSIGNED" : "PENDING_MATCH",
    quotedPrice,
    currency: org.baseCurrency,
    service: { code: service.code, name: service.name },
    scheduledFor,
    assignment,
    candidates: candidates.slice(0, 5),
    payment: { payswapId: intent.payswapId, clientSecret: intent.clientSecret, status: intent.status },
  });
}

/** GET /api/bookings — list bookings for the current principal (customer or cook). */
export async function GET(req: NextRequest) {
  const principal = resolvePrincipal(req.headers);
  authorize(principal, "booking.read");
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  const bookings = await db.booking.findMany({
    where: { organizationId: org.id },
    include: { service: true, customer: { include: { user: true } }, cook: { include: { user: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    bookings: bookings.map((b) => ({
      code: b.code,
      bookingType: b.bookingType,
      status: b.status,
      scheduledFor: b.scheduledFor,
      durationMins: b.durationMins,
      partySize: b.partySize,
      region: b.region,
      quotedPrice: b.quotedPrice,
      currency: b.currency,
      matchScore: b.matchScore,
      service: { code: b.service.code, name: b.service.name },
      customer: { name: b.customer.user.name },
      cook: b.cook ? { name: b.cook.user.name, avatarUrl: b.cook.avatarUrl, rating: b.cook.rating } : null,
      paymentStatus: b.payswapPaymentId ? "REQUIRES_ACTION" : null,
    })),
  });
}
