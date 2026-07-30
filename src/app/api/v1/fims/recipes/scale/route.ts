import { NextRequest } from "next/server";
import { z } from "zod";
import { RecipeScaler } from "@eks/fims";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const scaler = new RecipeScaler();
const Schema = z.object({
  recipeId: z.string(), originalServings: z.number().int().positive(), targetServings: z.number().int().positive(),
  ingredients: z.array(z.object({ ingredientId: z.string(), name: z.string(), quantity: z.number(), unit: z.string() })),
});
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(scaler.scale(input));
});
