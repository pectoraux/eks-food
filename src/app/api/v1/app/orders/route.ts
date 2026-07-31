import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";

/** GET /api/v1/app/orders?userId=... — list user's orders */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const customer = await db.customer.findUnique({ where: { userId } }).catch(() => null);
  if (!customer) return success([]);

  const bookings = await db.booking.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  }).catch(() => []);

  return success(bookings.map((b) => ({
    id: b.id,
    code: b.code,
    status: b.status,
    bookingType: b.bookingType,
    scheduledFor: b.scheduledFor,
    partySize: b.partySize,
    city: b.city,
    region: b.region,
    quotedPrice: b.quotedPrice,
    currency: b.currency,
    createdAt: b.createdAt,
  })));
}

/** POST /api/v1/app/orders — create a new order */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId: string;
      cookId?: string;
      mealName: string;
      portions: number;
      scheduledFor: string;
      address: string;
      city: string;
      region: string;
    };

    const user = await db.user.findUnique({ where: { id: body.userId } });
    if (!user) return Response.json({ error: "User not found" }, { status: 404 });

    // Get or create Customer record
    let customer = await db.customer.findUnique({ where: { userId: body.userId } }).catch(() => null);
    if (!customer) {
      customer = await db.customer.create({
        data: {
          organizationId: user.organizationId,
          userId: body.userId,
          dietaryPrefs: "",
          favoriteCuisines: "",
        },
      });
    }

    // Get or create a Service record (required FK)
    let service = await db.service.findFirst().catch(() => null);
    if (!service) {
      service = await db.service.create({
        data: { organizationId: user.organizationId, code: "IN_HOME_COOKING", name: "In-Home Cooking", description: "Professional cook", basePrice: 50, currency: "GHS", estimatedMins: 120, active: true },
      });
    }

    const code = `EKS-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const booking = await db.booking.create({
      data: {
        organizationId: customer.organizationId,
        code,
        customerId: customer.id,
        cookId: body.cookId ?? null,
        serviceId: service.id,
        bookingType: "SCHEDULED",
        scheduledFor: new Date(body.scheduledFor),
        durationMins: 120,
        partySize: body.portions,
        addressLine1: body.address,
        city: body.city,
        region: body.region,
        lat: 5.55,
        lng: -0.19,
        quotedPrice: body.portions * 25, // Base price per portion
        currency: "GHS",
        status: "PENDING",
      },
    });

    return success({ ok: true, id: booking.id, code: booking.code, status: booking.status, quotedPrice: booking.quotedPrice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
