import { NextRequest } from "next/server";
import { z } from "zod";
import { PantryService } from "@eks/customer";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new PantryService();
export const GET = apiHandler(async (req: NextRequest) => {
  const householdId = req.nextUrl.searchParams.get("householdId");
  if (!householdId) return success([]);
  const orgId = req.nextUrl.searchParams.get("organizationId") ?? "";
  const pantryId = await svc.ensurePantry(householdId, orgId);
  return success(await svc.listItems(pantryId));
});
const Schema = z.object({ householdId: z.string(), organizationId: z.string(), name: z.string(), ingredientCode: z.string().optional(), quantity: z.number().optional(), unit: z.string().optional(), expirationDate: z.string().optional(), addedById: z.string() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  const pantryId = await svc.ensurePantry(input.householdId, input.organizationId);
  return success(await svc.addItem({ pantryId, name: input.name, ingredientCode: input.ingredientCode, quantity: input.quantity, unit: input.unit, expirationDate: input.expirationDate ? new Date(input.expirationDate) : undefined, addedById: input.addedById }), { status: 201 });
});
