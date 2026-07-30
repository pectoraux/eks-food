import { NextRequest } from "next/server";
import { z } from "zod";
import { MealPlanService } from "@eks/customer";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new MealPlanService();
export const GET = apiHandler(async (req: NextRequest) => {
  const householdId = req.nextUrl.searchParams.get("householdId");
  if (!householdId) return success([]);
  return success(await svc.listForHousehold(householdId));
});
const Schema = z.object({ householdId: z.string(), organizationId: z.string(), name: z.string(), type: z.string().default("WEEKLY"), startDate: z.string(), endDate: z.string() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await svc.createPlan(input.householdId, input.organizationId, input.name, input.type, new Date(input.startDate), new Date(input.endDate)), { status: 201 });
});
