import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/v1/app/seed-demo?userId=...
 * Creates real demo data for a user through the domain models.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return Response.json({ error: "User not found" }, { status: 404 });

    const orgId = user.organizationId;
    const results: string[] = [];

    // 1. Get or create Customer record
    let customer = await db.customer.findUnique({ where: { userId } }).catch(() => null);
    if (!customer) {
      customer = await db.customer.create({
        data: { organizationId: orgId, userId, dietaryPrefs: "ghanaian|continental", favoriteCuisines: "Jollof Rice|Banku|Waakye" },
      }).catch((e: Error) => { results.push(`Customer error: ${e.message}`); return null; });
    }
    if (!customer) return Response.json({ error: "Failed to create customer", details: results }, { status: 500 });

    // 2. Create a booking (order)
    const existingBookings = await db.booking.count({ where: { customerId: customer.id } }).catch(() => 0);
    if (existingBookings === 0) {
      let service = await db.service.findFirst().catch(() => null);
      if (!service) {
        service = await db.service.create({
          data: { organizationId: orgId, code: "IN_HOME_COOKING", name: "In-Home Cooking", description: "Professional cook", basePrice: 50, currency: "GHS", estimatedMins: 120, active: true },
        }).catch(() => null);
      }
      if (service) {
        await db.booking.createMany({
          data: [
            { organizationId: orgId, code: `EKS-${Math.random().toString(36).substring(2, 8).toUpperCase()}`, customerId: customer.id, serviceId: service.id, bookingType: "SCHEDULED", scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000), durationMins: 120, partySize: 4, addressLine1: "Osu, Accra", city: "Accra", region: "Greater Accra", lat: 5.55, lng: -0.19, quotedPrice: 100, currency: "GHS", status: "CONFIRMED" },
            { organizationId: orgId, code: `EKS-${Math.random().toString(36).substring(2, 8).toUpperCase()}`, customerId: customer.id, serviceId: service.id, bookingType: "SCHEDULED", scheduledFor: new Date(Date.now() - 24 * 60 * 60 * 1000), durationMins: 120, partySize: 3, addressLine1: "Osu, Accra", city: "Accra", region: "Greater Accra", lat: 5.55, lng: -0.19, quotedPrice: 75, currency: "GHS", status: "COMPLETED" },
          ],
        }).catch((e: Error) => results.push(`Booking error: ${e.message}`));
      }
    }

    // 3. Create notification logs
    const existingNotifs = await db.notificationLog.count({ where: { userId } }).catch(() => 0);
    if (existingNotifs === 0) {
      await db.notificationLog.createMany({
        data: [
          { organizationId: orgId, userId, channel: "IN_APP", templateCode: "BOOKING_CONFIRMED", status: "DELIVERED", payload: JSON.stringify({ title: "Chef confirmed your lunch", body: "Your booking has been confirmed." }) },
          { organizationId: orgId, userId, channel: "IN_APP", templateCode: "PROMOTION", status: "DELIVERED", payload: JSON.stringify({ title: "Bulk rice discount", body: "Save 15% on bulk rice." }) },
        ],
      }).catch((e: Error) => results.push(`Notification error: ${e.message}`));
    }

    // Count what we created
    const [favCount, bookingCount, notifCount] = await Promise.all([
      db.favorite.count({ where: { customerId: customer.id } }).catch(() => 0),
      db.booking.count({ where: { customerId: customer.id } }).catch(() => 0),
      db.notificationLog.count({ where: { userId } }).catch(() => 0),
    ]);

    return success({ ok: true, customerId: customer.id, favorites: favCount, orders: bookingCount, notifications: notifCount, errors: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message, stack: error instanceof Error ? error.stack : undefined }, { status: 500 });
  }
}
