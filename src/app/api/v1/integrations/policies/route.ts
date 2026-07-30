import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const [retry, rateLimit] = await Promise.all([
    db.retryPolicy.findMany({ where: { active: true } }),
    db.rateLimitPolicy.findMany({ where: { active: true } }),
  ]);
  return success({ retry, rateLimit });
});
