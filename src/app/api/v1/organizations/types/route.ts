import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  return success(await db.organizationType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }));
});
