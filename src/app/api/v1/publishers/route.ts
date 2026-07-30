import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const publishers = await db.publisher.findMany({ include: { _count: { select: { extensions: true, packages: true } } }, orderBy: { createdAt: "desc" } });
  return success(publishers);
});
