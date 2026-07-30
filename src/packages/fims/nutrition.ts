/**
 * Nutritional Intelligence — calculates recipe nutrition from ingredient nutrition.
 *
 * Sums macros (calories, protein, carbs, fat, fiber, sugar, sodium) across
 * ingredients, calculates per-serving values, detects allergens, and classifies
 * dietary tags (vegan, vegetarian, gluten-free, etc.).
 */

export interface IngredientNutrition {
  readonly ingredientId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unit: string;
  readonly nutritionPer100g: {
    readonly calories: number;
    readonly protein: number;
    readonly carbohydrates: number;
    readonly fat: number;
    readonly fiber: number;
    readonly sugar: number;
    readonly sodium: number;
  };
  readonly allergens: readonly string[];
  readonly dietaryTags: readonly string[];
}

export interface RecipeNutrition {
  readonly totalCalories: number;
  readonly totalProtein: number;
  readonly totalCarbs: number;
  readonly totalFat: number;
  readonly totalFiber: number;
  readonly totalSugar: number;
  readonly totalSodium: number;
  readonly perServingCalories: number;
  readonly perServingProtein: number;
  readonly allergens: readonly string[];
  readonly dietaryTags: readonly string[];
  readonly servings: number;
}

// Dietary classification rules
const DIETARY_RULES: Record<string, { forbiddenAllergens: string[]; forbiddenTags: string[] }> = {
  VEGAN: { forbiddenAllergens: ["DAIRY", "EGGS", "HONEY"], forbiddenTags: ["meat", "fish", "poultry", "animal"] },
  VEGETARIAN: { forbiddenAllergens: [], forbiddenTags: ["meat", "fish", "poultry"] },
  GLUTEN_FREE: { forbiddenAllergens: ["GLUTEN", "WHEAT"], forbiddenTags: [] },
  DAIRY_FREE: { forbiddenAllergens: ["DAIRY", "MILK"], forbiddenTags: [] },
  KETO: { forbiddenAllergens: [], forbiddenTags: ["grain", "sugar", "starch"] },
  PALEO: { forbiddenAllergens: ["DAIRY"], forbiddenTags: ["grain", "legume", "sugar"] },
  LOW_SODIUM: { forbiddenAllergens: [], forbiddenTags: [] },
  HALAL: { forbiddenAllergens: [], forbiddenTags: ["pork", "alcohol"] },
  KOSHER: { forbiddenAllergens: [], forbiddenTags: ["pork", "shellfish"] },
};

export class NutritionCalculator {
  /** Calculate total + per-serving nutrition for a recipe. */
  calculate(ingredients: readonly IngredientNutrition[], servings: number): RecipeNutrition {
    let totalCalories = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0;
    let totalFiber = 0, totalSugar = 0, totalSodium = 0;
    const allergenSet = new Set<string>();
    const dietaryTagSet = new Set<string>();

    for (const ing of ingredients) {
      // Scale nutrition from per-100g to the actual quantity (assuming grams).
      const scale = ing.quantity / 100;
      totalCalories += ing.nutritionPer100g.calories * scale;
      totalProtein += ing.nutritionPer100g.protein * scale;
      totalCarbs += ing.nutritionPer100g.carbohydrates * scale;
      totalFat += ing.nutritionPer100g.fat * scale;
      totalFiber += ing.nutritionPer100g.fiber * scale;
      totalSugar += ing.nutritionPer100g.sugar * scale;
      totalSodium += ing.nutritionPer100g.sodium * scale;
      ing.allergens.forEach((a) => allergenSet.add(a));
      ing.dietaryTags.forEach((t) => dietaryTagSet.add(t));
    }

    const allergens = Array.from(allergenSet);
    const ingredientTags = Array.from(dietaryTagSet);
    // Classify dietary tags based on allergens + ingredient tags.
    const dietaryTags = this.classifyDietary(allergens, ingredientTags);

    return {
      totalCalories: this.round(totalCalories),
      totalProtein: this.round(totalProtein),
      totalCarbs: this.round(totalCarbs),
      totalFat: this.round(totalFat),
      totalFiber: this.round(totalFiber),
      totalSugar: this.round(totalSugar),
      totalSodium: this.round(totalSodium),
      perServingCalories: this.round(totalCalories / servings),
      perServingProtein: this.round(totalProtein / servings),
      allergens,
      dietaryTags,
      servings,
    };
  }

  /** Classify dietary tags from allergens + ingredient tags. */
  classifyDietary(allergens: readonly string[], ingredientTags: readonly string[]): string[] {
    const result: string[] = [];
    for (const [diet, rule] of Object.entries(DIETARY_RULES)) {
      const hasForbiddenAllergen = rule.forbiddenAllergens.some((a) => allergens.includes(a));
      const hasForbiddenTag = rule.forbiddenTags.some((t) => ingredientTags.includes(t));
      if (!hasForbiddenAllergen && !hasForbiddenTag) {
        result.push(diet);
      }
    }
    return result;
  }

  /** Detect allergens from ingredient list. */
  detectAllergens(ingredients: readonly { allergens: readonly string[] }[]): readonly string[] {
    const set = new Set<string>();
    for (const ing of ingredients) {
      ing.allergens.forEach((a) => set.add(a));
    }
    return Array.from(set);
  }

  /** Generate allergen warnings. */
  generateWarnings(allergens: readonly string[]): readonly string[] {
    const warnings: string[] = [];
    if (allergens.includes("PEANUTS")) warnings.push("Contains peanuts — may cause severe allergic reactions.");
    if (allergens.includes("GLUTEN") || allergens.includes("WHEAT")) warnings.push("Contains gluten — not suitable for celiac disease.");
    if (allergens.includes("DAIRY")) warnings.push("Contains dairy — not suitable for lactose intolerance.");
    if (allergens.includes("EGGS")) warnings.push("Contains eggs.");
    if (allergens.includes("SOY")) warnings.push("Contains soy.");
    if (allergens.includes("FISH") || allergens.includes("SHELLFISH")) warnings.push("Contains fish/shellfish — may cause severe allergic reactions.");
    if (allergens.includes("TREE_NUTS")) warnings.push("Contains tree nuts.");
    return warnings;
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
