import { NextRequest } from "next/server";
import { z } from "zod";
import { ShoppingListService } from "@eks/customer";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new ShoppingListService();
export const GET = apiHandler(async (req: NextRequest) => {
  const householdId = req.nextUrl.searchParams.get("householdId");
  if (!householdId) return success([]);
  return success(await svc.listForHousehold(householdId));
});
const Schema = z.object({ householdId: z.string(), organizationId: z.string(), name: z.string(), createdById: z.string() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await svc.createList(input.householdId, input.organizationId, input.name, input.createdById), { status: 201 });
});
