import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolvePrincipal, authorize, safeActorId } from "@/lib/auth";

export const dynamic = "force-dynamic";

const FlagPatchSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
});

/**
 * PATCH /api/admin/flags
 * Toggles a feature flag. Flags gate every future capability (group purchasing,
 * shared cooking, restaurant marketplace, etc.) — enabling them is a config
 * change, never a code change.
 */
export async function PATCH(req: NextRequest) {
  const principal = resolvePrincipal(req.headers);
  authorize(principal, "admin.config");

  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = FlagPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 422 });

  const updated = await db.featureFlag.update({
    where: { organizationId_key: { organizationId: org.id, key: parsed.data.key } },
    data: { enabled: parsed.data.enabled },
  });

  await db.auditLog.create({
    data: {
      organizationId: org.id,
      actorUserId: safeActorId(principal),
      action: "FEATURE_FLAG_TOGGLED",
      entityType: "FeatureFlag",
      entityId: updated.id,
      metadata: JSON.stringify({ key: updated.key, enabled: updated.enabled }),
    },
  });

  return NextResponse.json({ key: updated.key, enabled: updated.enabled });
}
