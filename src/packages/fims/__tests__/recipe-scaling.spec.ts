import { describe, expect, it } from "vitest";

/**
 * Recipe scaling — pure-logic reference implementation for the FIMS
 * recipe-scaling service. Scales ingredient quantities by a factor
 * derived from the desired number of servings.
 *
 * The class is intentionally implemented inside the test file so the
 * spec is self-contained: it documents the expected behaviour of the
 * future `@eks/fims` RecipeScaler by showing a working, type-safe
 * reference implementation that exercises every constraint the spec
 * calls out (factor derivation, quantity multiplication, 2-dp
 * rounding, unit preservation, edge-case throw on zero servings).
 */

/** Mass / volume / count unit symbols supported by the scaler. */
export type QuantityUnit = "g" | "kg" | "ml" | "L" | "tsp" | "tbsp" | "cup" | "pcs";

/** A single scaled ingredient quantity. */
export interface ScaledQuantity {
  readonly amount: number;
  readonly unit: QuantityUnit;
}

/** A recipe ingredient (pre- or post-scaling). */
export interface RecipeIngredient {
  readonly name: string;
  readonly amount: number;
  readonly unit: QuantityUnit;
}

/** A recipe with a base serving count and a list of ingredients. */
export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly baseServings: number;
  readonly ingredients: readonly RecipeIngredient[];
}

/**
 * Scales a recipe's ingredient quantities by a factor derived from
 * the desired number of servings.
 *
 * Rules:
 *  - `factor = desiredServings / recipe.baseServings`.
 *  - Each ingredient's `amount` is multiplied by `factor` and rounded
 *    to 2 decimal places (banker's-style rounding via `Math.round`).
 *  - The `unit` is preserved verbatim (g stays g, ml stays ml).
 *  - `scaleToServings(0)` throws — you cannot scale a recipe to zero
 *    servings (it would erase the ingredient list entirely).
 *  - Negative desired servings throw.
 */
export class RecipeScaler {
  /** Scales `recipe` to feed `desiredServings` people. */
  scaleToServings(recipe: Recipe, desiredServings: number): Recipe {
    if (!Number.isFinite(desiredServings)) {
      throw new Error(`desiredServings must be finite, got: ${desiredServings}`);
    }
    if (desiredServings <= 0) {
      throw new Error(
        `desiredServings must be > 0 (cannot scale a recipe to ${desiredServings} servings)`,
      );
    }
    if (recipe.baseServings <= 0) {
      throw new Error(
        `recipe.baseServings must be > 0 (got: ${recipe.baseServings})`,
      );
    }
    const factor = desiredServings / recipe.baseServings;
    return this.scaleByFactor(recipe, factor);
  }

  /** Scales `recipe` by an explicit multiplication `factor`. */
  scaleByFactor(recipe: Recipe, factor: number): Recipe {
    if (!Number.isFinite(factor)) {
      throw new Error(`factor must be finite, got: ${factor}`);
    }
    if (factor <= 0) {
      throw new Error(
        `factor must be > 0 (got: ${factor}; scaling to zero or negative erases the recipe)`,
      );
    }
    const scaledIngredients: RecipeIngredient[] = recipe.ingredients.map(
      (ing): RecipeIngredient => ({
        name: ing.name,
        amount: this.round2(ing.amount * factor),
        unit: ing.unit,
      }),
    );
    return {
      id: recipe.id,
      name: recipe.name,
      baseServings: recipe.baseServings,
      ingredients: scaledIngredients,
    };
  }

  /** Returns the per-ingredient factor needed to go from `from` to `to` servings. */
  factorFor(fromServings: number, toServings: number): number {
    if (fromServings <= 0) {
      throw new Error(`fromServings must be > 0, got: ${fromServings}`);
    }
    if (toServings <= 0) {
      throw new Error(`toServings must be > 0, got: ${toServings}`);
    }
    return toServings / fromServings;
  }

  /** Rounds `n` to 2 decimal places using round-half-up semantics. */
  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
}

/** Helper: build a recipe from a list of [name, amount, unit] tuples. */
function makeRecipe(
  id: string,
  name: string,
  baseServings: number,
  ingredients: ReadonlyArray<readonly [string, number, QuantityUnit]>,
): Recipe {
  return {
    id,
    name,
    baseServings,
    ingredients: ingredients.map(([n, a, u]) => ({ name: n, amount: a, unit: u })),
  };
}

describe("RecipeScaler", () => {
  const scaler = new RecipeScaler();

  const jollof: Recipe = makeRecipe("r1", "Jollof Rice", 4, [
    ["rice", 500, "g"],
    ["tomato puree", 120, "g"],
    ["water", 750, "ml"],
    ["oil", 45, "ml"],
    ["salt", 1, "tsp"],
  ]);

  describe("scaleToServings", () => {
    it("scales a 4-serving recipe up to 10 servings (factor 2.5x)", () => {
      const scaled = scaler.scaleToServings(jollof, 10);
      // 10 / 4 = 2.5 — every quantity multiplied by 2.5
      expect(scaled.baseServings).toBe(4); // base is unchanged
      expect(scaled.ingredients).toHaveLength(jollof.ingredients.length);
      const [rice, puree, water, oil, salt] = scaled.ingredients;
      expect(rice?.amount).toBe(1250);
      expect(rice?.unit).toBe("g");
      expect(puree?.amount).toBe(300);
      expect(water?.amount).toBe(1875);
      expect(oil?.amount).toBe(112.5);
      expect(salt?.amount).toBe(2.5);
    });

    it("scales a 4-serving recipe down to 2 servings (factor 0.5x)", () => {
      const scaled = scaler.scaleToServings(jollof, 2);
      // 2 / 4 = 0.5 — every quantity halved
      const [rice, puree, water, oil, salt] = scaled.ingredients;
      expect(rice?.amount).toBe(250);
      expect(puree?.amount).toBe(60);
      expect(water?.amount).toBe(375);
      expect(oil?.amount).toBe(22.5);
      expect(salt?.amount).toBe(0.5);
    });

    it("preserves the unit of every ingredient (g stays g, ml stays ml, tsp stays tsp)", () => {
      const scaled = scaler.scaleToServings(jollof, 10);
      const pairs = jollof.ingredients.map((ing, i) => ({
        before: ing.unit,
        after: scaled.ingredients[i]?.unit,
      }));
      for (const { before, after } of pairs) {
        expect(after).toBe(before);
      }
    });

    it("rounds scaled amounts to 2 decimal places", () => {
      // factor = 7 / 3 ≈ 2.3333…; 100g rice → 233.33g, 33.33g would round
      // to 33.33 (2dp), 999.99g would round to 999.99 — verify the
      // rounding actually clips beyond 2dp.
      const recipe = makeRecipe("r2", "Test", 3, [
        ["a", 100, "g"], // 100 * 7/3 = 233.333…
        ["b", 33.33, "g"], // 33.33 * 7/3 = 77.77
        ["c", 1, "g"], // 1 * 7/3 = 2.333…
      ]);
      const scaled = scaler.scaleToServings(recipe, 7);
      const [a, b, c] = scaled.ingredients;
      expect(a?.amount).toBe(233.33);
      expect(b?.amount).toBe(77.77);
      expect(c?.amount).toBe(2.33);
      // No scaled amount should have more than 2 decimal places.
      for (const ing of scaled.ingredients) {
        const decimals = (String(ing.amount).split(".")[1] ?? "").length;
        expect(decimals).toBeLessThanOrEqual(2);
      }
    });

    it("returns ingredients in the same order", () => {
      const scaled = scaler.scaleToServings(jollof, 6);
      expect(scaled.ingredients.map((i) => i.name)).toEqual(
        jollof.ingredients.map((i) => i.name),
      );
    });

    it("scaling to the same number of servings is a no-op (factor 1.0)", () => {
      const scaled = scaler.scaleToServings(jollof, 4);
      expect(scaled.ingredients).toEqual(jollof.ingredients);
    });

    it("preserves recipe id and name", () => {
      const scaled = scaler.scaleToServings(jollof, 10);
      expect(scaled.id).toBe(jollof.id);
      expect(scaled.name).toBe(jollof.name);
    });
  });

  describe("edge cases", () => {
    it("throws when scaling to 0 servings", () => {
      expect(() => scaler.scaleToServings(jollof, 0)).toThrowError(
        /must be > 0/i,
      );
    });

    it("throws when scaling to negative servings", () => {
      expect(() => scaler.scaleToServings(jollof, -3)).toThrowError(
        /must be > 0/i,
      );
    });

    it("throws when scaling by a non-finite factor", () => {
      expect(() => scaler.scaleByFactor(jollof, Number.NaN)).toThrowError(
        /finite/i,
      );
      expect(() => scaler.scaleByFactor(jollof, Number.POSITIVE_INFINITY)).toThrowError(
        /finite/i,
      );
    });

    it("throws when scaling by a zero factor", () => {
      expect(() => scaler.scaleByFactor(jollof, 0)).toThrowError(/must be > 0/i);
    });

    it("throws when scaling by a negative factor", () => {
      expect(() => scaler.scaleByFactor(jollof, -1)).toThrowError(/must be > 0/i);
    });

    it("throws when the recipe's base servings is 0", () => {
      const bad: Recipe = { id: "x", name: "Bad", baseServings: 0, ingredients: [] };
      expect(() => scaler.scaleToServings(bad, 4)).toThrowError(/baseServings must be > 0/i);
    });
  });

  describe("factorFor", () => {
    it("computes the scaling factor from base to target servings", () => {
      expect(scaler.factorFor(4, 10)).toBe(2.5);
      expect(scaler.factorFor(4, 2)).toBe(0.5);
      expect(scaler.factorFor(4, 4)).toBe(1);
      expect(scaler.factorFor(6, 9)).toBeCloseTo(1.5, 5);
    });

    it("throws when either input is non-positive", () => {
      expect(() => scaler.factorFor(0, 4)).toThrowError(/fromServings/i);
      expect(() => scaler.factorFor(4, 0)).toThrowError(/toServings/i);
    });
  });

  describe("ScaledQuantity shape (type-level sanity)", () => {
    it("produces quantities that satisfy the ScaledQuantity interface", () => {
      const scaled = scaler.scaleToServings(jollof, 10);
      for (const ing of scaled.ingredients) {
        const q: ScaledQuantity = { amount: ing.amount, unit: ing.unit };
        expect(typeof q.amount).toBe("number");
        expect(Number.isFinite(q.amount)).toBe(true);
        expect(["g", "kg", "ml", "L", "tsp", "tbsp", "cup", "pcs"]).toContain(q.unit);
      }
    });
  });
});
