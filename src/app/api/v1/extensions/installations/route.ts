import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { LifecycleManager } from "@eks/runtime";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { z } from "zod";

export const dynamic = "force-dynamic";

const lifecycle = new LifecycleManager();

const InstallSchema = z.object({
  extensionId: z.string(),
  versionId: z.string(),
  organizationId: z.string(),
  installedById: z.string(),
  grantedPermissions: z.array(z.string()).default([]),
  configuration: z.record(z.string(), z.unknown()).default({}),
});

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const where = orgId ? { organizationId: orgId } : {};
  const installations = await db.extensionInstallation.findMany({
    where,
    include: { extension: { include: { publisher: true } }, version: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return success(installations);
});

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = InstallSchema.parse(body);
  const result = await lifecycle.install(input);
  return success(result, { status: 201 });
});
