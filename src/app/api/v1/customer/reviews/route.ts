import { NextRequest } from "next/server";
import { z } from "zod";
import { ReviewService } from "@eks/customer";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new ReviewService();
export const GET = apiHandler(async (req: NextRequest) => {
  const et = req.nextUrl.searchParams.get("entityType");
  const ei = req.nextUrl.searchParams.get("entityId");
  if (et && ei) return success(await svc.listForEntity(et, ei));
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const { db } = await import("@/lib/db");
  return success(await db.review.findMany({ where: orgId ? { organizationId: orgId } : {}, orderBy: { createdAt: "desc" }, take: 50 }));
});
const Schema = z.object({ organizationId: z.string(), customerProfileId: z.string(), entityType: z.string(), entityId: z.string(), rating: z.number().int().min(1).max(5), title: z.string().optional(), comment: z.string().optional() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await svc.submit(input), { status: 201 });
});
