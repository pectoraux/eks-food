/** Meal Plan Service — weekly/monthly meal planning. */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

export interface MealSlotInput {
  mealPlanId: string;
  dayOfWeek: number; // 1-7
  mealType: string;  // BREAKFAST | LUNCH | DINNER | SNACK
  recipeId?: string;
  menuItemId?: string;
  mealName: string;
}

export class MealPlanService {
  async createPlan(householdId: string, organizationId: string, name: string, type: string, startDate: Date, endDate: Date): Promise<{ planId: string }> {
    const plan = await db.mealPlan.create({
      data: { id: uuid(), householdId, organizationId, name, type, startDate, endDate, status: "DRAFT" },
    });
    return { planId: plan.id };
  }

  async addMeal(input: MealSlotInput): Promise<{ mealId: string }> {
    const meal = await db.mealCalendar.upsert({
      where: { mealPlanId_dayOfWeek_mealType: { mealPlanId: input.mealPlanId, dayOfWeek: input.dayOfWeek, mealType: input.mealType } },
      update: { recipeId: input.recipeId, menuItemId: input.menuItemId, mealName: input.mealName },
      create: { id: uuid(), ...input },
    });
    return { mealId: meal.id };
  }

  async removeMeal(mealPlanId: string, dayOfWeek: number, mealType: string): Promise<void> {
    await db.mealCalendar.delete({
      where: { mealPlanId_dayOfWeek_mealType: { mealPlanId, dayOfWeek, mealType } },
    }).catch(() => null);
  }

  async getPlan(planId: string): Promise<unknown> {
    return db.mealPlan.findUnique({ where: { id: planId }, include: { calendar: { orderBy: { dayOfWeek: "asc" } } } });
  }

  async getMealsForDay(planId: string, dayOfWeek: number): Promise<readonly unknown[]> {
    return db.mealCalendar.findMany({ where: { mealPlanId: planId, dayOfWeek }, orderBy: { mealType: "asc" } });
  }

  async listForHousehold(householdId: string): Promise<readonly unknown[]> {
    return db.mealPlan.findMany({ where: { householdId }, orderBy: { startDate: "desc" }, include: { _count: { select: { calendar: true } } } });
  }
}

export { uuid };
