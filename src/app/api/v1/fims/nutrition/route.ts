import { NextRequest } from "next/server";
import { z } from "zod";
import { NutritionCalculator } from "@eks/fims";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const calc = new NutritionCalculator();
const Schema = z.object({
  ingredients: z.array(z.object({
    ingredientId: z.string(), name: z.string(), quantity: z.number(), unit: z.string(),
    nutritionPer100g: z.object({
      calories: z.number(), protein: z.number(), carbohydrates: z.number(), fat: z.number(),
      fiber: z.number(), sugar: z.number(), sodium: z.number(),
    }),
    allergens: z.array(z.string()).default([]), dietaryTags: z.array(z.string()).default([]),
  })),
  servings: z.number().int().positive(),
});
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(calc.calculate(input.ingredients, input.servings));
});
