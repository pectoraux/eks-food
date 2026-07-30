import { NextRequest } from "next/server";
import { z } from "zod";
import { FavoriteService } from "@eks/customer";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new FavoriteService();
export const GET = apiHandler(async (req: NextRequest) => {
  const cpId = req.nextUrl.searchParams.get("customerProfileId")!;
  const et = req.nextUrl.searchParams.get("entityType") ?? undefined;
  return success(await svc.list(cpId, et));
});
const Schema = z.object({ customerProfileId: z.string(), entityType: z.string(), entityId: z.string(), collection: z.string().optional(), notes: z.string().optional() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await svc.add(input.customerProfileId, input.entityType, input.entityId, input.collection, input.notes), { status: 201 });
});
