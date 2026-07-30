import { describe, expect, it } from "vitest";

/**
 * Nutrition calculation — pure-logic reference implementation for the
 * FIMS nutrition-calculation service. Given a recipe (servings + a list
 * of ingredients, each with optional per-100g nutrition facts and an
 * optional list of allergens and dietary tags), it produces:
 *
 *  - total macronutrients (calories, protein, carbs, fat) summed across
 *    ingredients, treating missing nutrition fields as 0
 *  - per-serving macronutrients (total ÷ servings)
 *  - the union of every ingredient's allergens
 *  - a dietary classification derived from ingredient tags:
 *      • vegan      — no ingredient is an animal product
 *      • vegetarian — no ingredient is meat
 *      • glutenFree — no ingredient contains wheat
 *
 * This is the spec the production `@eks/fims` NutritionCalculator will
 * satisfy once it lands.
 */

/** Per-100-gram nutrition facts for a single ingredient. */
export interface NutritionFacts {
  /** kcal per 100 g of the ingredient. */
  readonly calories?: number;
  /** grams of protein per 100 g. */
  readonly protein?: number;
  /** grams of carbohydrate per 100 g. */
  readonly carbs?: number;
  /** grams of fat per 100 g. */
  readonly fat?: number;
}

/** Dietary / origin tags attached to an ingredient. */
export interface IngredientTags {
  /** True if the ingredient is derived from an animal (dairy, egg, meat, honey). */
  readonly animalProduct?: boolean;
  /** True if the ingredient is meat (including poultry and fish). */
  readonly meat?: boolean;
  /** True if the ingredient contains wheat / gluten. */
  readonly wheat?: boolean;
}

/** A recipe ingredient: amount in grams, nutrition, allergens, tags. */
export interface NutritionIngredient {
  readonly name: string;
  /** Amount in grams. */
  readonly amountG: number;
  readonly nutrition?: NutritionFacts;
  readonly allergens?: readonly string[];
  readonly tags?: IngredientTags;
}

/** A recipe: servings + ingredient list. */
export interface NutritionRecipe {
  readonly servings: number;
  readonly ingredients: readonly NutritionIngredient[];
}

/** Computed macronutrient totals. */
export interface MacroTotals {
  readonly calories: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
}

/** Full nutrition + classification result for a recipe. */
export interface NutritionResult {
  readonly totals: MacroTotals;
  readonly perServing: MacroTotals;
  readonly allergens: readonly string[];
  readonly dietary: DietaryClassification;
}

/** Boolean dietary classification. */
export interface DietaryClassification {
  readonly vegan: boolean;
  readonly vegetarian: boolean;
  readonly glutenFree: boolean;
}

/** Internal helper: read an optional numeric field, defaulting to 0. */
function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Calculates total + per-serving nutrition, aggregates allergens, and
 * derives a dietary classification from ingredient tags.
 */
export class NutritionCalculator {
  /** Computes the full {@link NutritionResult} for `recipe`. */
  calculate(recipe: NutritionRecipe): NutritionResult {
    if (recipe.servings <= 0) {
      throw new Error(`recipe.servings must be > 0, got: ${recipe.servings}`);
    }
    const totals = this.sumTotals(recipe.ingredients);
    const perServing: MacroTotals = {
      calories: totals.calories / recipe.servings,
      protein: totals.protein / recipe.servings,
      carbs: totals.carbs / recipe.servings,
      fat: totals.fat / recipe.servings,
    };
    const allergens = this.aggregateAllergens(recipe.ingredients);
    const dietary = this.classifyDiet(recipe.ingredients);
    return { totals, perServing, allergens, dietary };
  }

  /** Sums macronutrients across `ingredients` (missing fields → 0). */
  sumTotals(ingredients: readonly NutritionIngredient[]): MacroTotals {
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    for (const ing of ingredients) {
      const n = ing.nutrition;
      if (!n) continue;
      // amountG grams → (amountG / 100) × per-100g value
      const factor = ing.amountG / 100;
      calories += num(n.calories) * factor;
      protein += num(n.protein) * factor;
      carbs += num(n.carbs) * factor;
      fat += num(n.fat) * factor;
    }
    return {
      calories: this.round2(calories),
      protein: this.round2(protein),
      carbs: this.round2(carbs),
      fat: this.round2(fat),
    };
  }

  /** Per-serving macros = totals ÷ servings. */
  perServing(totals: MacroTotals, servings: number): MacroTotals {
    if (servings <= 0) {
      throw new Error(`servings must be > 0, got: ${servings}`);
    }
    return {
      calories: this.round2(totals.calories / servings),
      protein: this.round2(totals.protein / servings),
      carbs: this.round2(totals.carbs / servings),
      fat: this.round2(totals.fat / servings),
    };
  }

  /** Returns the union (deduplicated) of every ingredient's allergens. */
  aggregateAllergens(ingredients: readonly NutritionIngredient[]): readonly string[] {
    const set = new Set<string>();
    for (const ing of ingredients) {
      if (!ing.allergens) continue;
      for (const a of ing.allergens) {
        set.add(a);
      }
    }
    // Sorted for determinism.
    return Array.from(set).sort();
  }

  /**
   * Classifies a recipe's diet from ingredient tags:
   *  - vegan: no ingredient has `animalProduct: true`
   *  - vegetarian: no ingredient has `meat: true`
   *  - glutenFree: no ingredient has `wheat: true`
   */
  classifyDiet(ingredients: readonly NutritionIngredient[]): DietaryClassification {
    let vegan = true;
    let vegetarian = true;
    let glutenFree = true;
    for (const ing of ingredients) {
      const t = ing.tags;
      if (!t) continue;
      if (t.animalProduct) vegan = false;
      if (t.meat) {
        vegetarian = false;
        vegan = false; // meat is also an animal product
      }
      if (t.wheat) glutenFree = false;
    }
    return { vegan, vegetarian, glutenFree };
  }

  /** Rounds to 2 decimal places. */
  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
}

/** Helper: build a recipe ingredient. */
function ing(
  name: string,
  amountG: number,
  nutrition: NutritionFacts,
  allergens: readonly string[] = [],
  tags: IngredientTags = {},
): NutritionIngredient {
  return { name, amountG, nutrition, allergens, tags };
}

describe("NutritionCalculator", () => {
  const calc = new NutritionCalculator();

  describe("sumTotals", () => {
    it("sums calories/protein/carbs/fat across ingredients (per-100g basis)", () => {
      // Rice: 100g, 130 kcal, 2.7g protein, 28g carbs, 0.3g fat per 100g
      // Tomato: 50g, 18 kcal, 0.9g protein, 3.9g carbs, 0.2g fat per 100g
      const recipe: NutritionRecipe = {
        servings: 4,
        ingredients: [
          ing("rice", 100, { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 }),
          ing("tomato", 50, { calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2 }),
        ],
      };
      const totals = calc.sumTotals(recipe.ingredients);
      // Rice contributes its full per-100g values (100g used).
      // Tomato contributes half its per-100g values (50g used).
      expect(totals.calories).toBe(130 + 9); // 130 + 18×0.5
      expect(totals.protein).toBeCloseTo(2.7 + 0.45, 5); // 2.7 + 0.9×0.5
      expect(totals.carbs).toBeCloseTo(28 + 1.95, 5); // 28 + 3.9×0.5
      expect(totals.fat).toBeCloseTo(0.3 + 0.1, 5); // 0.3 + 0.2×0.5
    });

    it("returns 0 for every macro when no ingredient has nutrition", () => {
      const recipe: NutritionRecipe = {
        servings: 4,
        ingredients: [
          { name: "mystery", amountG: 100 },
          { name: "other", amountG: 50 },
        ],
      };
      const totals = calc.sumTotals(recipe.ingredients);
      expect(totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    });

    it("treats missing nutrition fields as 0", () => {
      const recipe: NutritionRecipe = {
        servings: 2,
        ingredients: [
          // Only calories is set; protein/carbs/fat should default to 0.
          ing("a", 100, { calories: 50 }),
          // Only protein is set.
          ing("b", 100, { protein: 10 }),
        ],
      };
      const totals = calc.sumTotals(recipe.ingredients);
      expect(totals.calories).toBe(50); // from a only
      expect(totals.protein).toBe(10); // from b only
      expect(totals.carbs).toBe(0); // missing everywhere
      expect(totals.fat).toBe(0); // missing everywhere
    });

    it("handles a single ingredient with full nutrition", () => {
      const recipe: NutritionRecipe = {
        servings: 1,
        ingredients: [
          ing("chicken", 200, { calories: 165, protein: 31, carbs: 0, fat: 3.6 }),
        ],
      };
      const totals = calc.sumTotals(recipe.ingredients);
      // 200g of chicken → 2× the per-100g values
      expect(totals.calories).toBe(330);
      expect(totals.protein).toBe(62);
      expect(totals.carbs).toBe(0);
      expect(totals.fat).toBe(7.2);
    });

    it("rounds totals to 2 decimal places", () => {
      const recipe: NutritionRecipe = {
        servings: 3,
        ingredients: [
          // 33.33g of a 100 kcal/100g ingredient → 33.33 kcal
          ing("a", 33.33, { calories: 100, protein: 1.111, carbs: 0, fat: 0 }),
        ],
      };
      const totals = calc.sumTotals(recipe.ingredients);
      const decimals = (String(totals.calories).split(".")[1] ?? "").length;
      expect(decimals).toBeLessThanOrEqual(2);
    });
  });

  describe("perServing", () => {
    it("divides each total by the number of servings", () => {
      const totals: MacroTotals = { calories: 800, protein: 40, carbs: 100, fat: 20 };
      const ps = calc.perServing(totals, 4);
      expect(ps.calories).toBe(200);
      expect(ps.protein).toBe(10);
      expect(ps.carbs).toBe(25);
      expect(ps.fat).toBe(5);
    });

    it("throws when servings is zero", () => {
      const totals: MacroTotals = { calories: 100, protein: 1, carbs: 1, fat: 1 };
      expect(() => calc.perServing(totals, 0)).toThrowError(/servings must be > 0/i);
    });
  });

  describe("calculate (full pipeline)", () => {
    it("produces totals, perServing, allergens and dietary classification", () => {
      const recipe: NutritionRecipe = {
        servings: 4,
        ingredients: [
          ing(
            "rice",
            400,
            { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
            [],
            { animalProduct: false, meat: false, wheat: false },
          ),
          ing(
            "tomato",
            200,
            { calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2 },
            [],
            { animalProduct: false, meat: false, wheat: false },
          ),
        ],
      };
      const result = calc.calculate(recipe);
      // Totals: rice 4× per-100g, tomato 2× per-100g
      expect(result.totals.calories).toBe(130 * 4 + 18 * 2);
      expect(result.totals.protein).toBeCloseTo(2.7 * 4 + 0.9 * 2, 5);
      // Per serving: divide by 4
      expect(result.perServing.calories).toBe((130 * 4 + 18 * 2) / 4);
      // No allergens declared
      expect(result.allergens).toEqual([]);
      // No animal products, no meat, no wheat → fully vegan + glutenFree
      expect(result.dietary).toEqual({ vegan: true, vegetarian: true, glutenFree: true });
    });

    it("throws when servings is zero", () => {
      const recipe: NutritionRecipe = {
        servings: 0,
        ingredients: [ing("a", 100, { calories: 100 })],
      };
      expect(() => calc.calculate(recipe)).toThrowError(/servings must be > 0/i);
    });
  });

  describe("aggregateAllergens", () => {
    it("returns the union of every ingredient's allergens (deduplicated)", () => {
      const ingredients: readonly NutritionIngredient[] = [
        ing("a", 100, { calories: 100 }, ["gluten", "soy"]),
        ing("b", 100, { calories: 100 }, ["soy", "milk"]),
        ing("c", 100, { calories: 100 }, ["peanut"]),
      ];
      const allergens = calc.aggregateAllergens(ingredients);
      expect(allergens).toEqual(["gluten", "milk", "peanut", "soy"]);
    });

    it("returns an empty array when no ingredient declares allergens", () => {
      const ingredients: readonly NutritionIngredient[] = [
        ing("a", 100, { calories: 100 }),
        { name: "b", amountG: 100 },
      ];
      expect(calc.aggregateAllergens(ingredients)).toEqual([]);
    });

    it("does not mutate the input ingredient arrays", () => {
      const a = ["gluten"];
      const ingredients: readonly NutritionIngredient[] = [
        ing("a", 100, { calories: 100 }, a),
      ];
      calc.aggregateAllergens(ingredients);
      expect(a).toEqual(["gluten"]); // untouched
    });
  });

  describe("classifyDiet", () => {
    it("classifies a fully plant-based recipe as vegan + vegetarian + glutenFree", () => {
      const ingredients: readonly NutritionIngredient[] = [
        ing("rice", 100, { calories: 130 }, [], { animalProduct: false, meat: false, wheat: false }),
        ing("lentils", 50, { calories: 116 }, [], { animalProduct: false, meat: false, wheat: false }),
      ];
      expect(calc.classifyDiet(ingredients)).toEqual({
        vegan: true,
        vegetarian: true,
        glutenFree: true,
      });
    });

    it("classifies a recipe with dairy as vegetarian but NOT vegan", () => {
      const ingredients: readonly NutritionIngredient[] = [
        ing("rice", 100, { calories: 130 }, [], { animalProduct: false, meat: false, wheat: false }),
        ing("milk", 100, { calories: 42 }, ["milk"], { animalProduct: true, meat: false, wheat: false }),
      ];
      const d = calc.classifyDiet(ingredients);
      expect(d.vegan).toBe(false); // dairy present
      expect(d.vegetarian).toBe(true); // no meat
      expect(d.glutenFree).toBe(true); // no wheat
    });

    it("classifies a recipe with meat as non-vegetarian (and therefore non-vegan)", () => {
      const ingredients: readonly NutritionIngredient[] = [
        ing("chicken", 100, { calories: 165 }, [], { animalProduct: true, meat: true, wheat: false }),
        ing("rice", 100, { calories: 130 }, [], { animalProduct: false, meat: false, wheat: false }),
      ];
      const d = calc.classifyDiet(ingredients);
      expect(d.vegan).toBe(false);
      expect(d.vegetarian).toBe(false);
      expect(d.glutenFree).toBe(true);
    });

    it("classifies a recipe with wheat as NOT glutenFree", () => {
      const ingredients: readonly NutritionIngredient[] = [
        ing("flour", 100, { calories: 364 }, ["gluten"], { animalProduct: false, meat: false, wheat: true }),
        ing("water", 100, { calories: 0 }, [], { animalProduct: false, meat: false, wheat: false }),
      ];
      const d = calc.classifyDiet(ingredients);
      expect(d.vegan).toBe(true);
      expect(d.vegetarian).toBe(true);
      expect(d.glutenFree).toBe(false);
    });

    it("treats ingredients without tags as diet-neutral (all defaults true)", () => {
      const ingredients: readonly NutritionIngredient[] = [
        { name: "salt", amountG: 5 },
        { name: "water", amountG: 100 },
      ];
      const d = calc.classifyDiet(ingredients);
      expect(d).toEqual({ vegan: true, vegetarian: true, glutenFree: true });
    });

    it("classifies a complex recipe with multiple dietary conflicts", () => {
      // Wheat flour (wheat), chicken (meat), milk (animal) — neither vegan
      // nor vegetarian nor glutenFree.
      const ingredients: readonly NutritionIngredient[] = [
        ing("flour", 100, { calories: 364 }, ["gluten"], { wheat: true }),
        ing("chicken", 100, { calories: 165 }, [], { animalProduct: true, meat: true }),
        ing("milk", 50, { calories: 42 }, ["milk"], { animalProduct: true }),
      ];
      const d = calc.classifyDiet(ingredients);
      expect(d).toEqual({ vegan: false, vegetarian: false, glutenFree: false });
    });
  });
});
