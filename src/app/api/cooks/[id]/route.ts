import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/cooks/[id] — full cook profile incl. certifications & availability. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  const cook = await db.cook.findFirst({
    where: { id, organizationId: org.id },
    include: { user: true, certifications: true, availability: { orderBy: { weekday: "asc" } } },
  });
  if (!cook) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    cookId: cook.id,
    userId: cook.userId,
    name: cook.user.name,
    email: cook.user.email,
    phone: cook.user.phone,
    avatarUrl: cook.avatarUrl,
    bio: cook.bio,
    cuisines: cook.cuisines.split("|").filter(Boolean),
    skills: cook.skills.split("|").filter(Boolean),
    languages: cook.languages.split("|").filter(Boolean),
    hourlyRate: cook.hourlyRate,
    currency: cook.currency,
    rating: cook.rating,
    totalJobs: cook.totalJobs,
    completedJobs: cook.completedJobs,
    responseTimeMins: cook.responseTimeMins,
    verificationStatus: cook.verificationStatus,
    homeRegion: cook.homeRegion,
    availabilityMode: cook.availabilityMode,
    lat: cook.lat,
    lng: cook.lng,
    certifications: cook.certifications.map((c) => ({
      id: c.id,
      title: c.title,
      issuer: c.issuer,
      status: c.status,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      publicBadgeId: c.publicBadgeId,
    })),
    availability: cook.availability.map((a) => ({ weekday: a.weekday, startHour: a.startHour, endHour: a.endHour })),
  });
}
