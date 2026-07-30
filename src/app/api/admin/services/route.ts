import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolvePrincipal, authorize, safeActorId } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ServiceSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  description: z.string(),
  basePrice: z.number().min(0),
  estimatedMins: z.number().int().min(15),
  active: z.boolean().default(true),
});

/**
 * POST /api/admin/services
 * Creates a new configurable service in the catalog. New service types are a
 * data change, not a deployment.
 */
export async function POST(req: NextRequest) {
  const principal = resolvePrincipal(req.headers);
  authorize(principal, "admin.config");

  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = ServiceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed", issues: parsed.error.issues }, { status: 422 });

  const existing = await db.service.findUnique({ where: { organizationId_code: { organizationId: org.id, code: parsed.data.code } } });
  if (existing) return NextResponse.json({ error: "service_code_exists" }, { status: 409 });

  const service = await db.service.create({
    data: {
      organizationId: org.id,
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description,
      basePrice: parsed.data.basePrice,
      estimatedMins: parsed.data.estimatedMins,
      active: parsed.data.active,
      currency: org.baseCurrency,
      config: "{}",
    },
  });

  await db.auditLog.create({
    data: {
      organizationId: org.id,
      actorUserId: safeActorId(principal),
      action: "SERVICE_CREATED",
      entityType: "Service",
      entityId: service.id,
      metadata: JSON.stringify({ code: service.code, name: service.name }),
    },
  });

  return NextResponse.json(service);
}
