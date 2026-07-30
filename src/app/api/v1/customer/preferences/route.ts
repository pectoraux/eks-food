import { NextRequest } from "next/server";
import { z } from "zod";
import { PreferenceService } from "@eks/customer";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new PreferenceService();
export const GET = apiHandler(async (req: NextRequest) => {
  const cpId = req.nextUrl.searchParams.get("customerProfileId")!;
  return success(await svc.getPreferences(cpId));
});
const Schema = z.object({ customerProfileId: z.string(), cuisine: z.string().optional(), ingredientCode: z.string().optional(), sentiment: z.enum(["LIKE","DISLIKE","NEUTRAL"]).default("LIKE") });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  if (input.cuisine) await svc.setCuisinePreference(input.customerProfileId, input.cuisine, input.sentiment);
  if (input.ingredientCode) await svc.setIngredientPreference(input.customerProfileId, input.ingredientCode, input.sentiment);
  return success({ ok: true });
});
