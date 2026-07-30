import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/cook-workspace?cookId=
 * Aggregated Cook Workspace view: profile, upcoming jobs, completed jobs,
 * income (retrieved from Payswap transfers), rating, performance analytics.
 */
export async function GET(req: NextRequest) {
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  const cookId = req.nextUrl.searchParams.get("cookId");
  if (!cookId) return NextResponse.json({ error: "cookId_required" }, { status: 422 });

  const cook = await db.cook.findFirst({
    where: { id: cookId, organizationId: org.id },
    include: { user: true, certifications: true },
  });
  if (!cook) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const bookings = await db.booking.findMany({
    where: { organizationId: org.id, cookId },
    include: { service: true, customer: { include: { user: true } } },
    orderBy: { scheduledFor: "desc" },
    take: 50,
  });

  const transfers = await db.payswapTransfer.findMany({
    where: { organizationId: org.id, payeeUserId: cook.userId, status: "PAID" },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const upcoming = bookings.filter((b) => new Date(b.scheduledFor) > now && b.status !== "CANCELLED").slice(0, 5);
  const completed = bookings.filter((b) => b.status === "COMPLETED").slice(0, 10);

  // Weekly earnings (last 8 weeks)
  const weekly: { week: string; earnings: number; jobs: number }[] = [];
  for (let w = 7; w >= 0; w--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - w * 7 - 6);
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() - w * 7);
    const weekTransfers = transfers.filter((t) => {
      const d = new Date(t.createdAt);
      return d >= weekStart && d <= weekEnd;
    });
    const weekJobs = bookings.filter((b) => {
      const d = new Date(b.scheduledFor);
      return d >= weekStart && d <= weekEnd && b.status === "COMPLETED";
    });
    weekly.push({
      week: `W${8 - w}`,
      earnings: Math.round(weekTransfers.reduce((sum, t) => sum + t.amount, 0) * 100) / 100,
      jobs: weekJobs.length,
    });
  }

  return NextResponse.json({
    profile: {
      cookId: cook.id,
      name: cook.user.name,
      avatarUrl: cook.avatarUrl,
      bio: cook.bio,
      cuisines: cook.cuisines.split("|").filter(Boolean),
      skills: cook.skills.split("|").filter(Boolean),
      languages: cook.languages.split("|").filter(Boolean),
      hourlyRate: cook.hourlyRate,
      rating: cook.rating,
      totalJobs: cook.totalJobs,
      completedJobs: cook.completedJobs,
      responseTimeMins: cook.responseTimeMins,
      verificationStatus: cook.verificationStatus,
      homeRegion: cook.homeRegion,
      availabilityMode: cook.availabilityMode,
      certifications: cook.certifications.map((c) => ({ title: c.title, issuer: c.issuer, status: c.status, expiresAt: c.expiresAt })),
    },
    upcoming: upcoming.map((b) => ({
      code: b.code,
      status: b.status,
      scheduledFor: b.scheduledFor,
      durationMins: b.durationMins,
      partySize: b.partySize,
      region: b.region,
      service: b.service.name,
      customerName: b.customer.user.name,
      quotedPrice: b.quotedPrice,
      matchScore: b.matchScore,
    })),
    completed: completed.map((b) => ({
      code: b.code,
      scheduledFor: b.scheduledFor,
      service: b.service.name,
      customerName: b.customer.user.name,
      quotedPrice: b.quotedPrice,
    })),
    income: {
      totalPaid: Math.round(transfers.reduce((s, t) => s + t.amount, 0) * 100) / 100,
      payoutCount: transfers.length,
      currency: org.baseCurrency,
      lastPayouts: transfers.slice(0, 5).map((t) => ({
        payswapId: t.payswapId,
        amount: t.amount,
        status: t.status,
        createdAt: t.createdAt,
        metadata: JSON.parse(t.metadata),
      })),
    },
    performance: {
      weekly,
      completionRate: cook.totalJobs > 0 ? Math.round((cook.completedJobs / cook.totalJobs) * 1000) / 10 : 0,
      rating: cook.rating,
      responseTimeMins: cook.responseTimeMins,
    },
  });
}
