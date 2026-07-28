import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { matchCooks } from "@/lib/matching";

export const dynamic = "force-dynamic";

/**
 * GET /api/cooks
 * Query: cuisine, region, maxRate, lat, lng, q, limit
 * When lat+lng are supplied the matching engine returns fully ranked
 * candidates with explainable score breakdowns.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  const cuisine = sp.get("cuisine");
  const region = sp.get("region");
  const maxRate = sp.get("maxRate") ? Number(sp.get("maxRate")) : undefined;
  const q = sp.get("q")?.toLowerCase();
  const lat = sp.get("lat") ? Number(sp.get("lat")) : undefined;
  const lng = sp.get("lng") ? Number(sp.get("lng")) : undefined;
  const limit = Math.min(50, Number(sp.get("limit") ?? 20));

  if (lat !== undefined && lng !== undefined) {
    const matched = await matchCooks({
      organizationId: org.id,
      lat,
      lng,
      cuisines: cuisine ? cuisine.split("|") : undefined,
      maxHourlyRate: maxRate,
    });
    let result = matched;
    if (region) result = result.filter((c) => c.homeRegion === region);
    if (q) result = result.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.bio.toLowerCase().includes(q) ||
      c.cuisines.some((x) => x.includes(q)) ||
      c.skills.some((x) => x.includes(q))
    );
    return NextResponse.json({ cooks: result.slice(0, limit), total: result.length, matched: true });
  }

  const cooks = await db.cook.findMany({
    where: {
      organizationId: org.id,
      verificationStatus: "APPROVED",
      ...(region ? { homeRegion: region } : {}),
      ...(maxRate ? { hourlyRate: { lte: maxRate } } : {}),
    },
    include: { user: true },
    take: limit,
    orderBy: { rating: "desc" },
  });

  let filtered = cooks;
  if (cuisine) {
    const wanted = cuisine.split("|");
    filtered = filtered.filter((c) => c.cuisines.split("|").some((x) => wanted.includes(x)));
  }
  if (q) {
    filtered = filtered.filter((c) =>
      c.user.name.toLowerCase().includes(q) ||
      c.bio.toLowerCase().includes(q) ||
      c.cuisines.toLowerCase().includes(q) ||
      c.skills.toLowerCase().includes(q)
    );
  }

  return NextResponse.json({
    cooks: filtered.map((c) => ({
      cookId: c.id,
      userId: c.userId,
      name: c.user.name,
      avatarUrl: c.avatarUrl,
      bio: c.bio,
      cuisines: c.cuisines.split("|").filter(Boolean),
      skills: c.skills.split("|").filter(Boolean),
      languages: c.languages.split("|").filter(Boolean),
      hourlyRate: c.hourlyRate,
      currency: c.currency,
      rating: c.rating,
      totalJobs: c.totalJobs,
      completedJobs: c.completedJobs,
      responseTimeMins: c.responseTimeMins,
      verificationStatus: c.verificationStatus,
      homeRegion: c.homeRegion,
    })),
    total: filtered.length,
    matched: false,
  });
}
