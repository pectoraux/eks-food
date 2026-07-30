import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { ImportService } from "@eks/fims";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new ImportService();
const Schema = z.object({
  organizationId: z.string(), format: z.string(), source: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())), columnMapping: z.record(z.string(), z.string()).optional(),
  performedById: z.string(),
});
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await svc.start(input));
});
export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const where = orgId ? { organizationId: orgId } : {};
  return success(await db.catalogImport.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, include: { _count: { select: { rows: true } } } }));
});
