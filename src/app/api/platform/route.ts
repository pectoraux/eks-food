import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolvePrincipal } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/platform
 * Bootstrap payload: organisational context, feature flags, configurable
 * catalog (services, meal categories, regions, pricing rules) and headline KPIs.
 */
export async function GET(req: NextRequest) {
  const principal = resolvePrincipal(req.headers);
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  const [services, mealCategories, regions, pricingRules, flags, cooks, customers, bookings, payments, transfers] = await Promise.all([
    db.service.findMany({ where: { organizationId: org.id }, orderBy: { code: "asc" } }),
    db.mealCategory.findMany({ where: { organizationId: org.id }, orderBy: { sortOrder: "asc" } }),
    db.region.findMany({ where: { organizationId: org.id } }),
    db.pricingRule.findMany({ where: { organizationId: org.id, active: true } }),
    db.featureFlag.findMany({ where: { organizationId: org.id } }),
    db.cook.count({ where: { organizationId: org.id, verificationStatus: "APPROVED" } }),
    db.customer.count({ where: { organizationId: org.id } }),
    db.booking.count({ where: { organizationId: org.id } }),
    db.payswapPayment.aggregate({ where: { organizationId: org.id, status: "SUCCEEDED" }, _sum: { amount: true } }),
    db.payswapTransfer.aggregate({ where: { organizationId: org.id, status: "PAID" }, _sum: { amount: true } }),
  ]);

  const completedBookings = await db.booking.count({ where: { organizationId: org.id, status: "COMPLETED" } });

  return NextResponse.json({
    organization: { slug: org.slug, name: org.name, country: org.country, currency: org.baseCurrency },
    principal,
    services,
    mealCategories,
    regions,
    pricingRules: pricingRules.map((p) => ({ ...p, config: safeParse(p.config) })),
    featureFlags: flags.map((f) => ({ key: f.key, enabled: f.enabled, config: safeParse(f.config) })),
    kpis: {
      verifiedCooks: cooks,
      customers,
      totalBookings: bookings,
      completedBookings,
      grossPaymentVolume: payments._sum.amount ?? 0,
      workerPayouts: transfers._sum.amount ?? 0,
    },
  });
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return {}; }
}
