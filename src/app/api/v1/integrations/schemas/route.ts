import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const schemas = await db.schemaDefinition.findMany({ include: { latestVersion: true, _count: { select: { versions: true } } }, orderBy: { createdAt: "desc" } });
  return success(schemas);
});
