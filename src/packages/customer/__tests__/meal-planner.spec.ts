import { describe, expect, it } from "vitest";

/**
 * Meal planner — pure-logic reference implementation for the
 * Customer Platform meal-planning subsystem.
 *
 * Manages multiple meal plans per customer. Each plan is a typed,
 * date-scoped collection of meal entries. Each meal entry is a
 * (date, mealType, recipeId) tuple plus an optional scope and
 * metadata.
 *
 *  - createPlan(...)               — register a new meal plan
 *  - addMeal(planId, ...)          — append a meal to a plan
 *  - removeMeal(planId, mealId)    — drop a meal from a plan
 *  - getPlan(planId)               — snapshot of a plan
 *  - getMealsForDay(planId, date)  — meals scheduled for a specific day
 *
 * The 5 plan states are modelled after the M8 MEAL_PLANNING_GUIDE:
 *
 *   DRAFT → COMMITTED → ACTIVE → COMPLETED → ARCHIVED
 *                       ↘ CANCELLED
 */

/** Type of meal plan. */
export type MealPlanType =
  | "WEEKLY"
  | "MONTHLY"
  | "FAMILY"
  | "SPECIAL_OCCASION"
  | "HOLIDAY";

/** Type of meal entry. */
export type MealType =
  | "BREAKFAST"
  | "LUNCH"
  | "DINNER"
  | "SNACK"
  | "BRUNCH"
  | "TEA";

/** Status of a meal plan. */
export type MealPlanStatus =
  | "DRAFT"
  | "COMMITTED"
  | "ACTIVE"
  | "COMPLETED"
  | "ARCHIVED"
  | "CANCELLED";

/** Scope of a meal entry (which household members it applies to). */
export type MealScope = "HOUSEHOLD" | "SUBSET" | "SINGLE_MEMBER";

/** A single meal entry in a plan. */
export interface PlannedMeal {
  readonly mealId: string;
  readonly date: string; // YYYY-MM-DD
  readonly mealType: MealType;
  readonly recipeId: string;
  readonly servings: number;
  readonly scope: MealScope;
  readonly memberIds: readonly string[];
  notes: string | null;
  readonly addedAt: Date;
}

/** A meal plan. */
export interface MealPlan {
  readonly planId: string;
  name: string;
  readonly planType: MealPlanType;
  readonly householdId: string;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string; // YYYY-MM-DD
  status: MealPlanStatus;
  readonly createdAt: Date;
  committedAt: Date | null;
  completedAt: Date | null;
}

/** Options accepted by `addMeal`. */
export interface AddMealOptions {
  readonly mealId?: string;
  readonly scope?: MealScope;
  readonly memberIds?: readonly string[];
  readonly notes?: string;
}

class MealPlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MealPlannerError";
  }
}

function isPositive(q: number): boolean {
  return Number.isFinite(q) && q > 0;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDate(s: string, label: string): void {
  if (!DATE_RE.test(s)) {
    throw new MealPlannerError(
      `${label} must be YYYY-MM-DD, got: "${s}"`,
    );
  }
  // Round-trip through Date to catch invalid dates like 2024-13-40.
  const parsed = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new MealPlannerError(
      `${label} is not a valid calendar date: "${s}"`,
    );
  }
}

function assertDateRange(start: string, end: string): void {
  const s = new Date(`${start}T00:00:00.000Z`).getTime();
  const e = new Date(`${end}T00:00:00.000Z`).getTime();
  if (e < s) {
    throw new MealPlannerError(
      `endDate (${end}) must not precede startDate (${start})`,
    );
  }
}

let mealIdCounter = 0;
function nextMealId(): string {
  mealIdCounter += 1;
  return `meal-${mealIdCounter}`;
}

let planIdCounter = 0;
function nextPlanId(): string {
  planIdCounter += 1;
  return `plan-${planIdCounter}`;
}

/** Manages multiple meal plans. */
export class MealPlanner {
  private readonly plans = new Map<string, MealPlan>();
  private readonly meals = new Map<string, Map<string, PlannedMeal>>();

  /** Create a new meal plan. Status starts at DRAFT. */
  createPlan(
    name: string,
    planType: MealPlanType,
    householdId: string,
    startDate: string,
    endDate: string,
    planId?: string,
  ): MealPlan {
    if (!name || name.trim().length === 0) {
      throw new MealPlannerError("plan name is required");
    }
    if (!householdId || householdId.trim().length === 0) {
      throw new MealPlannerError("householdId is required");
    }
    assertValidDate(startDate, "startDate");
    assertValidDate(endDate, "endDate");
    assertDateRange(startDate, endDate);
    const id = planId ?? nextPlanId();
    if (this.plans.has(id)) {
      throw new MealPlannerError(`plan already exists: ${id}`);
    }
    const plan: MealPlan = {
      planId: id,
      name: name.trim(),
      planType,
      householdId,
      startDate,
      endDate,
      status: "DRAFT",
      createdAt: new Date(),
      committedAt: null,
      completedAt: null,
    };
    this.plans.set(id, plan);
    this.meals.set(id, new Map());
    return plan;
  }

  /** Add a meal to a plan. The meal's date must fall in [start, end]. */
  addMeal(
    planId: string,
    date: string,
    mealType: MealType,
    recipeId: string,
    servings: number,
    opts: AddMealOptions = {},
  ): PlannedMeal {
    const plan = this.requirePlan(planId);
    assertValidDate(date, "date");
    if (!recipeId || recipeId.trim().length === 0) {
      throw new MealPlannerError("recipeId is required");
    }
    if (!isPositive(servings)) {
      throw new MealPlannerError(
        `servings must be > 0, got: ${servings}`,
      );
    }
    if (date < plan.startDate || date > plan.endDate) {
      throw new MealPlannerError(
        `meal date ${date} is outside plan window [${plan.startDate}, ${plan.endDate}]`,
      );
    }
    const mealId = opts.mealId ?? nextMealId();
    const meals = this.meals.get(planId);
    if (!meals) {
      throw new MealPlannerError(`plan not found: ${planId}`);
    }
    if (meals.has(mealId)) {
      throw new MealPlannerError(
        `meal already exists in plan ${planId}: ${mealId}`,
      );
    }
    const meal: PlannedMeal = {
      mealId,
      date,
      mealType,
      recipeId: recipeId.trim(),
      servings,
      scope: opts.scope ?? "HOUSEHOLD",
      memberIds: opts.memberIds ? [...opts.memberIds] : [],
      notes: opts.notes ?? null,
      addedAt: new Date(),
    };
    meals.set(mealId, meal);
    return meal;
  }

  /** Remove a meal from a plan. */
  removeMeal(planId: string, mealId: string): PlannedMeal {
    this.requirePlan(planId);
    const meals = this.meals.get(planId);
    if (!meals) {
      throw new MealPlannerError(`plan not found: ${planId}`);
    }
    const meal = meals.get(mealId);
    if (!meal) {
      throw new MealPlannerError(
        `meal not found in plan ${planId}: ${mealId}`,
      );
    }
    meals.delete(mealId);
    return meal;
  }

  /** Snapshot of a plan. */
  getPlan(planId: string): MealPlan | undefined {
    return this.plans.get(planId);
  }

  /** All meals in a plan, sorted by date then mealType. */
  getMeals(planId: string): readonly PlannedMeal[] {
    this.requirePlan(planId);
    const meals = this.meals.get(planId);
    if (!meals) return [];
    return Array.from(meals.values()).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.mealType.localeCompare(b.mealType);
    });
  }

  /** Meals scheduled for a specific YYYY-MM-DD day. */
  getMealsForDay(planId: string, date: string): readonly PlannedMeal[] {
    this.requirePlan(planId);
    assertValidDate(date, "date");
    const meals = this.meals.get(planId);
    if (!meals) return [];
    return Array.from(meals.values())
      .filter((m) => m.date === date)
      .sort((a, b) => a.mealType.localeCompare(b.mealType));
  }

  /** Transition the plan's status. */
  setStatus(planId: string, status: MealPlanStatus): MealPlan {
    const plan = this.requirePlan(planId);
    if (!isValidTransition(plan.status, status)) {
      throw new MealPlannerError(
        `invalid status transition: ${plan.status} → ${status}`,
      );
    }
    const now = new Date();
    const updated: MealPlan = {
      ...plan,
      status,
      committedAt:
        status === "COMMITTED" || plan.committedAt
          ? (plan.committedAt ?? now)
          : null,
      completedAt:
        status === "COMPLETED" ? now : plan.completedAt,
    };
    this.plans.set(planId, updated);
    return updated;
  }

  /** Count of meals in a plan. */
  mealCount(planId: string): number {
    return this.meals.get(planId)?.size ?? 0;
  }

  /** All plans managed by this planner. */
  listPlans(): readonly MealPlan[] {
    return Array.from(this.plans.values());
  }

  private requirePlan(planId: string): MealPlan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new MealPlannerError(`plan not found: ${planId}`);
    }
    return plan;
  }
}

/**
 * Allowed plan-state transitions. DRAFT can move to COMMITTED or
 * CANCELLED. COMMITTED can move to ACTIVE or CANCELLED. ACTIVE can
 * move to COMPLETED or CANCELLED. COMPLETED can move to ARCHIVED.
 * CANCELLED is terminal. ARCHIVED is terminal.
 */
function isValidTransition(from: MealPlanStatus, to: MealPlanStatus): boolean {
  if (from === to) return true; // idempotent
  const allowed: Record<MealPlanStatus, readonly MealPlanStatus[]> = {
    DRAFT: ["COMMITTED", "CANCELLED"],
    COMMITTED: ["ACTIVE", "CANCELLED", "DRAFT"],
    ACTIVE: ["COMPLETED", "CANCELLED", "COMMITTED"],
    COMPLETED: ["ARCHIVED", "ACTIVE"],
    ARCHIVED: [],
    CANCELLED: [],
  };
  return allowed[from].includes(to);
}

describe("MealPlanner", () => {
  describe("createPlan", () => {
    it("creates a new meal plan in DRAFT status", () => {
      const planner = new MealPlanner();
      const plan = planner.createPlan(
        "Week of Mar 4",
        "WEEKLY",
        "h-1",
        "2024-03-04",
        "2024-03-10",
      );
      expect(plan.planId).toBeDefined();
      expect(plan.name).toBe("Week of Mar 4");
      expect(plan.planType).toBe("WEEKLY");
      expect(plan.householdId).toBe("h-1");
      expect(plan.startDate).toBe("2024-03-04");
      expect(plan.endDate).toBe("2024-03-10");
      expect(plan.status).toBe("DRAFT");
      expect(plan.committedAt).toBeNull();
      expect(plan.completedAt).toBeNull();
    });

    it("accepts a custom planId", () => {
      const planner = new MealPlanner();
      const plan = planner.createPlan(
        "Birthday",
        "SPECIAL_OCCASION",
        "h-1",
        "2024-05-01",
        "2024-05-01",
        "custom-plan-1",
      );
      expect(plan.planId).toBe("custom-plan-1");
    });

    it("rejects an empty name", () => {
      const planner = new MealPlanner();
      expect(() =>
        planner.createPlan("  ", "WEEKLY", "h-1", "2024-03-04", "2024-03-10"),
      ).toThrow(/name/);
    });

    it("rejects an empty householdId", () => {
      const planner = new MealPlanner();
      expect(() =>
        planner.createPlan("P", "WEEKLY", "", "2024-03-04", "2024-03-10"),
      ).toThrow(/householdId/);
    });

    it("rejects malformed dates", () => {
      const planner = new MealPlanner();
      expect(() =>
        planner.createPlan("P", "WEEKLY", "h-1", "03-04-2024", "2024-03-10"),
      ).toThrow(/YYYY-MM-DD/);
    });

    it("rejects a start date after the end date", () => {
      const planner = new MealPlanner();
      expect(() =>
        planner.createPlan("P", "WEEKLY", "h-1", "2024-03-10", "2024-03-04"),
      ).toThrow(/endDate/);
    });

    it("rejects a duplicate planId", () => {
      const planner = new MealPlanner();
      planner.createPlan(
        "P1",
        "WEEKLY",
        "h-1",
        "2024-03-04",
        "2024-03-10",
        "dup-1",
      );
      expect(() =>
        planner.createPlan(
          "P2",
          "WEEKLY",
          "h-1",
          "2024-03-04",
          "2024-03-10",
          "dup-1",
        ),
      ).toThrow(/already exists/);
    });

    it("allows a single-day plan (startDate === endDate)", () => {
      const planner = new MealPlanner();
      const plan = planner.createPlan(
        "Birthday",
        "SPECIAL_OCCASION",
        "h-1",
        "2024-05-01",
        "2024-05-01",
      );
      expect(plan.startDate).toBe(plan.endDate);
    });
  });

  describe("addMeal", () => {
    it("adds a meal to a plan", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      const meal = planner.addMeal("p-1", "2024-03-04", "BREAKFAST", "r-jollof", 4);
      expect(meal.mealId).toBeDefined();
      expect(meal.date).toBe("2024-03-04");
      expect(meal.mealType).toBe("BREAKFAST");
      expect(meal.recipeId).toBe("r-jollof");
      expect(meal.servings).toBe(4);
      expect(meal.scope).toBe("HOUSEHOLD");
      expect(meal.memberIds).toEqual([]);
      expect(meal.notes).toBeNull();
    });

    it("honours scope, memberIds, and notes options", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      const meal = planner.addMeal("p-1", "2024-03-05", "LUNCH", "r-salad", 2, {
        scope: "SINGLE_MEMBER",
        memberIds: ["u-1"],
        notes: "no onions",
      });
      expect(meal.scope).toBe("SINGLE_MEMBER");
      expect(meal.memberIds).toEqual(["u-1"]);
      expect(meal.notes).toBe("no onions");
    });

    it("rejects a meal date outside the plan window", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      expect(() =>
        planner.addMeal("p-1", "2024-03-11", "BREAKFAST", "r-1", 1),
      ).toThrow(/outside plan window/);
      expect(() =>
        planner.addMeal("p-1", "2024-03-03", "BREAKFAST", "r-1", 1),
      ).toThrow(/outside plan window/);
    });

    it("rejects a non-positive servings value", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      expect(() =>
        planner.addMeal("p-1", "2024-03-04", "BREAKFAST", "r-1", 0),
      ).toThrow(/servings/);
      expect(() =>
        planner.addMeal("p-1", "2024-03-04", "BREAKFAST", "r-1", -3),
      ).toThrow(/servings/);
    });

    it("rejects an empty recipeId", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      expect(() =>
        planner.addMeal("p-1", "2024-03-04", "BREAKFAST", "", 1),
      ).toThrow(/recipeId/);
    });

    it("throws when the plan does not exist", () => {
      const planner = new MealPlanner();
      expect(() =>
        planner.addMeal("no-such-plan", "2024-03-04", "BREAKFAST", "r-1", 1),
      ).toThrow(/plan not found/);
    });

    it("rejects a duplicate mealId in the same plan", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.addMeal("p-1", "2024-03-04", "BREAKFAST", "r-1", 1, {
        mealId: "dup-1",
      });
      expect(() =>
        planner.addMeal("p-1", "2024-03-04", "LUNCH", "r-2", 1, {
          mealId: "dup-1",
        }),
      ).toThrow(/already exists/);
    });
  });

  describe("removeMeal", () => {
    it("removes a meal from a plan", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.addMeal("p-1", "2024-03-04", "BREAKFAST", "r-1", 1, {
        mealId: "m-1",
      });
      const removed = planner.removeMeal("p-1", "m-1");
      expect(removed.mealId).toBe("m-1");
      expect(planner.mealCount("p-1")).toBe(0);
    });

    it("throws when the meal does not exist", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      expect(() => planner.removeMeal("p-1", "no-such-meal")).toThrow(
        /not found/,
      );
    });

    it("throws when the plan does not exist", () => {
      const planner = new MealPlanner();
      expect(() => planner.removeMeal("no-such-plan", "m-1")).toThrow(
        /plan not found/,
      );
    });
  });

  describe("getPlan + getMeals", () => {
    it("getPlan returns the named plan or undefined", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      expect(planner.getPlan("p-1")?.name).toBe("P");
      expect(planner.getPlan("missing")).toBeUndefined();
    });

    it("getMeals returns meals sorted by date then mealType", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.addMeal("p-1", "2024-03-05", "DINNER", "r-1", 1, { mealId: "m-3" });
      planner.addMeal("p-1", "2024-03-04", "LUNCH", "r-2", 1, { mealId: "m-2" });
      planner.addMeal("p-1", "2024-03-04", "BREAKFAST", "r-3", 1, { mealId: "m-1" });
      const meals = planner.getMeals("p-1");
      expect(meals.map((m) => m.mealId)).toEqual(["m-1", "m-2", "m-3"]);
    });

    it("getMeals returns an empty array for a plan with no meals", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      expect(planner.getMeals("p-1")).toEqual([]);
    });
  });

  describe("getMealsForDay", () => {
    it("returns only the meals scheduled for the given day", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.addMeal("p-1", "2024-03-04", "BREAKFAST", "r-1", 1, { mealId: "m-1" });
      planner.addMeal("p-1", "2024-03-04", "DINNER", "r-2", 1, { mealId: "m-2" });
      planner.addMeal("p-1", "2024-03-05", "LUNCH", "r-3", 1, { mealId: "m-3" });
      const day1 = planner.getMealsForDay("p-1", "2024-03-04");
      expect(day1).toHaveLength(2);
      expect(day1.map((m) => m.mealType)).toEqual(["BREAKFAST", "DINNER"]);
      const day2 = planner.getMealsForDay("p-1", "2024-03-05");
      expect(day2).toHaveLength(1);
      expect(day2[0]?.mealId).toBe("m-3");
    });

    it("returns an empty array for a day with no meals", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.addMeal("p-1", "2024-03-04", "BREAKFAST", "r-1", 1);
      expect(planner.getMealsForDay("p-1", "2024-03-09")).toEqual([]);
    });

    it("rejects a malformed date argument", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      expect(() => planner.getMealsForDay("p-1", "March 4")).toThrow(
        /YYYY-MM-DD/,
      );
    });
  });

  describe("setStatus — plan state machine", () => {
    it("DRAFT → COMMITTED → ACTIVE → COMPLETED → ARCHIVED", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      expect(planner.getPlan("p-1")?.status).toBe("DRAFT");

      planner.setStatus("p-1", "COMMITTED");
      expect(planner.getPlan("p-1")?.status).toBe("COMMITTED");
      expect(planner.getPlan("p-1")?.committedAt).not.toBeNull();

      planner.setStatus("p-1", "ACTIVE");
      expect(planner.getPlan("p-1")?.status).toBe("ACTIVE");

      planner.setStatus("p-1", "COMPLETED");
      expect(planner.getPlan("p-1")?.status).toBe("COMPLETED");
      expect(planner.getPlan("p-1")?.completedAt).not.toBeNull();

      planner.setStatus("p-1", "ARCHIVED");
      expect(planner.getPlan("p-1")?.status).toBe("ARCHIVED");
    });

    it("DRAFT → CANCELLED is allowed", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.setStatus("p-1", "CANCELLED");
      expect(planner.getPlan("p-1")?.status).toBe("CANCELLED");
    });

    it("DRAFT → ACTIVE is rejected (must commit first)", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      expect(() => planner.setStatus("p-1", "ACTIVE")).toThrow(
        /invalid status transition/,
      );
    });

    it("COMPLETED → DRAFT is rejected", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.setStatus("p-1", "COMMITTED");
      planner.setStatus("p-1", "ACTIVE");
      planner.setStatus("p-1", "COMPLETED");
      expect(() => planner.setStatus("p-1", "DRAFT")).toThrow(
        /invalid status transition/,
      );
    });

    it("CANCELLED is terminal", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.setStatus("p-1", "CANCELLED");
      expect(() => planner.setStatus("p-1", "DRAFT")).toThrow(
        /invalid status transition/,
      );
      expect(() => planner.setStatus("p-1", "ACTIVE")).toThrow(
        /invalid status transition/,
      );
    });

    it("ARCHIVED is terminal", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.setStatus("p-1", "COMMITTED");
      planner.setStatus("p-1", "ACTIVE");
      planner.setStatus("p-1", "COMPLETED");
      planner.setStatus("p-1", "ARCHIVED");
      expect(() => planner.setStatus("p-1", "ACTIVE")).toThrow(
        /invalid status transition/,
      );
    });

    it("idempotent setStatus (same → same) is allowed", () => {
      const planner = new MealPlanner();
      planner.createPlan("P", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.setStatus("p-1", "COMMITTED");
      planner.setStatus("p-1", "COMMITTED");
      expect(planner.getPlan("p-1")?.status).toBe("COMMITTED");
    });
  });

  describe("listPlans + multi-plan isolation", () => {
    it("listPlans returns all registered plans", () => {
      const planner = new MealPlanner();
      planner.createPlan("A", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.createPlan("B", "MONTHLY", "h-1", "2024-03-01", "2024-03-31", "p-2");
      const all = planner.listPlans();
      expect(all).toHaveLength(2);
      expect(all.map((p) => p.planId).sort()).toEqual(["p-1", "p-2"]);
    });

    it("adding a meal to one plan does not affect another", () => {
      const planner = new MealPlanner();
      planner.createPlan("A", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-1");
      planner.createPlan("B", "WEEKLY", "h-1", "2024-03-04", "2024-03-10", "p-2");
      planner.addMeal("p-1", "2024-03-04", "BREAKFAST", "r-1", 1, {
        mealId: "shared-id",
      });
      planner.addMeal("p-2", "2024-03-04", "BREAKFAST", "r-2", 1, {
        mealId: "shared-id",
      });
      expect(planner.mealCount("p-1")).toBe(1);
      expect(planner.mealCount("p-2")).toBe(1);
      expect(planner.getMeals("p-1")[0]?.recipeId).toBe("r-1");
      expect(planner.getMeals("p-2")[0]?.recipeId).toBe("r-2");
    });
  });

  describe("end-to-end weekly plan lifecycle", () => {
    it("creates a week-long plan, fills 7 breakfasts + 7 dinners, then completes", () => {
      const planner = new MealPlanner();
      const plan = planner.createPlan(
        "Week of Mar 4",
        "WEEKLY",
        "h-1",
        "2024-03-04",
        "2024-03-10",
        "p-1",
      );
      // 7 breakfasts and 7 dinners across the week.
      const days = [
        "2024-03-04",
        "2024-03-05",
        "2024-03-06",
        "2024-03-07",
        "2024-03-08",
        "2024-03-09",
        "2024-03-10",
      ];
      days.forEach((d, i) => {
        planner.addMeal("p-1", d, "BREAKFAST", "r-oats", 4, {
          mealId: `b-${i}`,
        });
        planner.addMeal("p-1", d, "DINNER", "r-jollof", 4, {
          mealId: `d-${i}`,
        });
      });
      expect(planner.mealCount("p-1")).toBe(14);
      // Verify getMealsForDay returns exactly 2 meals for any day.
      expect(planner.getMealsForDay("p-1", "2024-03-06")).toHaveLength(2);

      // Commit and activate.
      planner.setStatus("p-1", "COMMITTED");
      planner.setStatus("p-1", "ACTIVE");
      expect(planner.getPlan("p-1")?.status).toBe("ACTIVE");

      // Mark complete and archive.
      planner.setStatus("p-1", "COMPLETED");
      planner.setStatus("p-1", "ARCHIVED");
      expect(planner.getPlan("p-1")?.status).toBe("ARCHIVED");
      expect(planner.getPlan("p-1")?.completedAt).not.toBeNull();
    });
  });
});
