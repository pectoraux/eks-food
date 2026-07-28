import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics
 * Aggregated, anonymised Food Intelligence metrics:
 *   - demand by region (heatmap)
 *   - demand by cuisine (trends)
 *   - demand by hour-of-day
 *   - demand by day (14d series)
 *   - avg price by cuisine
 *   - operational KPIs (bookings by status, GPV, payouts, completion rate)
 *
 * No PII is exposed — only aggregate counts and averages.
 */
export async function GET(req: NextRequest) {
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  const days = Math.min(30, Number(req.nextUrl.searchParams.get("days") ?? 14));

  // Fetch all signals in window (14d seed range)
  const signals = await db.demandSignal.findMany({ where: { organizationId: org.id } });

  // Aggregate by region (heatmap)
  const byRegion = new Map<string, { total: number; bookings: number; avgPrice: number }>();
  for (const s of signals) {
    const entry = byRegion.get(s.region) ?? { total: 0, bookings: 0, avgPrice: 0 };
    entry.total += s.demandScore;
    entry.bookings += s.bookings;
    entry.avgPrice += s.avgPrice;
    byRegion.set(s.region, entry);
  }
  const regionHeatmap = Array.from(byRegion.entries()).map(([region, v]) => ({
    region,
    avgDemand: Math.round((v.total / (signals.length / byRegion.size)) * 10) / 10,
    bookings: v.bookings,
    avgPrice: Math.round((v.avgPrice / (signals.length / byRegion.size)) * 100) / 100,
  })).sort((a, b) => b.avgDemand - a.avgDemand);

  // Aggregate by cuisine (trends)
  const byCuisine = new Map<string, { bookings: number; avgPrice: number; count: number }>();
  for (const s of signals) {
    const entry = byCuisine.get(s.cuisine) ?? { bookings: 0, avgPrice: 0, count: 0 };
    entry.bookings += s.bookings;
    entry.avgPrice += s.avgPrice;
    entry.count += 1;
    byCuisine.set(s.cuisine, entry);
  }
  const cuisineTrends = Array.from(byCuisine.entries()).map(([cuisine, v]) => ({
    cuisine,
    bookings: v.bookings,
    avgPrice: Math.round((v.avgPrice / v.count) * 100) / 100,
  })).sort((a, b) => b.bookings - a.bookings);

  // By hour
  const byHour = new Map<number, number>();
  for (const s of signals) byHour.set(s.hour, (byHour.get(s.hour) ?? 0) + s.bookings);
  const hourly = Array.from(byHour.entries()).sort((a, b) => a[0] - b[0]).map(([hour, bookings]) => ({ hour, bookings }));

  // By day (14d series, all cuisines summed)
  const byDay = new Map<string, number>();
  for (const s of signals) byDay.set(s.day, (byDay.get(s.day) ?? 0) + s.bookings);
  const daily = Array.from(byDay.entries()).sort().slice(-days).map(([day, bookings]) => ({ day, bookings }));

  // Operational KPIs
  const bookingsByStatus = await db.booking.groupBy({
    by: ["status"],
    where: { organizationId: org.id },
    _count: { status: true },
  });
  const gpv = await db.payswapPayment.aggregate({ where: { organizationId: org.id, status: "SUCCEEDED" }, _sum: { amount: true } });
  const payouts = await db.payswapTransfer.aggregate({ where: { organizationId: org.id, status: "PAID" }, _sum: { amount: true } });
  const totalBookings = await db.booking.count({ where: { organizationId: org.id } });
  const completed = await db.booking.count({ where: { organizationId: org.id, status: "COMPLETED" } });
  const cancelled = await db.booking.count({ where: { organizationId: org.id, status: "CANCELLED" } });

  return NextResponse.json({
    regionHeatmap,
    cuisineTrends,
    hourly,
    daily,
    operations: {
      byStatus: bookingsByStatus.map((b) => ({ status: b.status, count: b._count.status })),
      grossPaymentVolume: gpv._sum.amount ?? 0,
      workerPayouts: payouts._sum.amount ?? 0,
      completionRate: totalBookings > 0 ? Math.round((completed / totalBookings) * 1000) / 10 : 0,
      cancellationRate: totalBookings > 0 ? Math.round((cancelled / totalBookings) * 1000) / 10 : 0,
      totalBookings,
    },
  });
}
