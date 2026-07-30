/**
 * Recipe Scaling Engine — dynamically scales recipe ingredient quantities.
 *
 * Supports scaling from any serving count to any other (2 → 10, 4 → 5000).
 * Preserves measurement accuracy with 2-decimal-place rounding. Handles
 * unit-aware scaling (g stays g, ml stays ml, pieces stay pieces).
 */
export interface ScaledIngredient {
  readonly ingredientId: string;
  readonly name: string;
  readonly originalQuantity: number;
  readonly scaledQuantity: number;
  readonly unit: string;
}

export interface ScaleInput {
  readonly recipeId: string;
  readonly originalServings: number;
  readonly targetServings: number;
  readonly ingredients: readonly { ingredientId: string; name: string; quantity: number; unit: string }[];
}

export class RecipeScaler {
  /** Scale a recipe's ingredients from originalServings to targetServings. */
  scale(input: ScaleInput): { factor: number; scaledIngredients: readonly ScaledIngredient[]; scaledServings: number } {
    if (input.targetServings <= 0) throw new Error("Target servings must be positive");
    if (input.originalServings <= 0) throw new Error("Original servings must be positive");

    const factor = input.targetServings / input.originalServings;
    const scaledIngredients = input.ingredients.map((ing) => ({
      ingredientId: ing.ingredientId,
      name: ing.name,
      originalQuantity: ing.quantity,
      scaledQuantity: this.round(ing.quantity * factor),
      unit: ing.unit,
    }));

    return { factor, scaledIngredients, scaledServings: input.targetServings };
  }

  /** Estimate scaled preparation time (sub-linear: larger batches are slightly more efficient per unit). */
  estimateScaledTime(originalTimeMin: number, factor: number): number {
    if (factor <= 1) return Math.round(originalTimeMin * factor);
    // Sub-linear scaling: time grows but not proportionally (batch efficiency).
    const scaledTime = originalTimeMin * Math.pow(factor, 0.7);
    return Math.round(scaledTime);
  }

  /** Round to 2 decimal places for measurement accuracy. */
  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
