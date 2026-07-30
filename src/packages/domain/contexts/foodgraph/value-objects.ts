/**
 * @file contexts/foodgraph/value-objects.ts
 * @package @eks-food/domain/contexts/foodgraph
 *
 * Foodgraph bounded context — value objects.
 */

export type {
  ISODateString,
  LocalizedText,
  UUID,
} from '../../shared/value-objects';

import type {
  ISODateString,
  LocalizedText,
  UUID,
} from '../../shared/value-objects';

/**
 * Branded primitive representing an ingredient category, e.g.
 * `"grain"`, `"protein"`, `"spice"`.
 */
export type IngredientCategory = string & { readonly __brand: 'IngredientCategory' };

/**
 * Branded primitive representing a cuisine code, e.g.
 * `"west-african"`, `"levantine"`.
 */
export type CuisineCode = string & { readonly __brand: 'CuisineCode' };

/**
 * Branded primitive representing a meal category, e.g.
 * `"breakfast"`, `"one-pot"`.
 */
export type MealCategory = string & { readonly __brand: 'MealCategory' };

/**
 * Lifecycle states for a Recipe.
 */
export type RecipeStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED';

/**
 * A single ingredient with quantity in a recipe.
 */
export interface RecipeIngredient {
  readonly ingredientId: UUID;
  readonly quantity: number;
  readonly unit: string;
  readonly preparation?: string;
  readonly optional: boolean;
}

/**
 * A single step in a recipe.
 */
export interface RecipeStep {
  readonly sequence: number;
  readonly instruction: LocalizedText;
  readonly durationMinutes: number;
  readonly equipment?: ReadonlyArray<string>;
}

/**
 * Per-100g (or per-serving) nutrition profile.
 */
export interface NutritionProfile {
  readonly energyKcal: number;
  readonly proteinG: number;
  readonly carbohydrateG: number;
  readonly fatG: number;
  readonly fibreG: number;
  readonly sugarG: number;
  readonly sodiumMg: number;
  readonly micronutrients: Readonly<Record<string, number>>;
  readonly allergens: ReadonlyArray<string>;
  readonly source: string;
  readonly sourceVersion: string;
}

/**
 * Substitution suggestion for an ingredient (allergen-friendly
 * alternatives, regional swaps).
 */
export interface IngredientSubstitution {
  readonly fromIngredientId: UUID;
  readonly toIngredientId: UUID;
  readonly ratio: number;
  readonly reason: string;
}
