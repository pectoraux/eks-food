import { NextRequest, NextResponse } from "next/server";
import { seedDatabase } from "@/lib/seed";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST /api/seed — idempotently seed the reference deployment. */
export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = await seedDatabase(force);
  return NextResponse.json({ ok: true, ...result });
}

/** GET /api/seed — report current seed counts without mutating. */
export async function GET() {
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ seeded: false });
  return NextResponse.json({
    seeded: true,
    organization: org.slug,
    cooks: await db.cook.count({ where: { organizationId: org.id } }),
    customers: await db.customer.count({ where: { organizationId: org.id } }),
    services: await db.service.count({ where: { organizationId: org.id } }),
    bookings: await db.booking.count({ where: { organizationId: org.id } }),
    demandSignals: await db.demandSignal.count({ where: { organizationId: org.id } }),
  });
}
