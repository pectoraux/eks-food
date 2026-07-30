import { NextRequest } from "next/server";
import { z } from "zod";
import { HouseholdService } from "@eks/customer";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new HouseholdService();
const Schema = z.object({ householdId: z.string(), customerProfileId: z.string(), role: z.string().optional(), ageGroup: z.string().optional(), isDependent: z.boolean().optional(), addedById: z.string() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await svc.addMember(input, input.addedById), { status: 201 });
});
export const GET = apiHandler(async (req: NextRequest) => {
  const householdId = req.nextUrl.searchParams.get("householdId")!;
  return success(await svc.listMembers(householdId));
});
