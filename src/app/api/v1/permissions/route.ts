import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { PERMISSIONS, PermissionRegistry } from "@eks/authorization";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const perms = await db.permission.findMany({ include: { _count: { select: { rolePermissions: true, policies: true } } }, orderBy: { resource: "asc" } });
  return success(perms);
});
