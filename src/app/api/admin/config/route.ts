import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolvePrincipal, authorize } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/config
 * Returns the full configurable catalog for the Admin Console:
 * services, meal categories, regions, pricing rules, feature flags, KPIs.
 */
export async function GET(req: NextRequest) {
  const principal = resolvePrincipal(req.headers);
  authorize(principal, "admin.config");

  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  const [services, mealCategories, regions, pricingRules, flags] = await Promise.all([
    db.service.findMany({ where: { organizationId: org.id }, orderBy: { code: "asc" } }),
    db.mealCategory.findMany({ where: { organizationId: org.id }, orderBy: { sortOrder: "asc" } }),
    db.region.findMany({ where: { organizationId: org.id } }),
    db.pricingRule.findMany({ where: { organizationId: org.id } }),
    db.featureFlag.findMany({ where: { organizationId: org.id }, orderBy: { key: "asc" } }),
  ]);

  return NextResponse.json({
    services: services.map((s) => ({ ...s, config: safeParse(s.config) })),
    mealCategories,
    regions: regions.map((r) => ({ ...r, bounds: safeParse(r.bounds) })),
    pricingRules: pricingRules.map((p) => ({ ...p, config: safeParse(p.config) })),
    featureFlags: flags.map((f) => ({ ...f, config: safeParse(f.config) })),
  });
}

function safeParse(s: string | null) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
