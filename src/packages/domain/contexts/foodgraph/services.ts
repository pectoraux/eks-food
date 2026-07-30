/**
 * @file contexts/foodgraph/services.ts
 * @package @eks-food/domain/contexts/foodgraph
 *
 * Foodgraph bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { UUID } from '../../shared/value-objects';
import type {
  IngredientAggregate,
  MealAggregate,
  RecipeAggregate,
} from './aggregates';
import type { NutritionProfile } from './value-objects';

/**
 * Computes a {@link NutritionProfile} for a recipe by aggregating
 * the per-ingredient profiles weighted by quantity. May delegate to
 * the ai context for ingredient-disambiguation.
 */
export interface NutritionCalculator {
  computeForRecipe(
    recipe: RecipeAggregate,
    ingredients: ReadonlyArray<IngredientAggregate>,
  ): Result<NutritionProfile, DomainError>;
  computeForMeal(
    meal: MealAggregate,
    recipes: ReadonlyArray<RecipeAggregate>,
  ): Result<NutritionProfile, DomainError>;
  scaleToServing(
    profile: NutritionProfile,
    servings: number,
  ): NutritionProfile;
}

/**
 * Suggests ingredient substitutions for a recipe given a customer's
 * dietary restrictions and allergens.
 */
export interface SubstitutionRecommender {
  recommend(
    recipe: RecipeAggregate,
    constraints: { readonly allergens: ReadonlyArray<string>; readonly preferences: ReadonlyArray<string> },
  ): Promise<Result<ReadonlyArray<{ ingredientId: UUID; substituteId: UUID; reason: string }>, DomainError>>;
}

/**
 * Recommends meals for a customer based on their food profile and the
 * active meal catalog. Used by the marketplace and the AI assistant.
 */
export interface MealRecommender {
  recommend(
    tenantId: UUID,
    customerFoodProfile: {
      readonly preferredCuisines: ReadonlyArray<string>;
      readonly dietaryRestrictions: ReadonlyArray<string>;
      readonly allergens: ReadonlyArray<string>;
    },
    limit: number,
  ): Promise<Result<ReadonlyArray<MealAggregate>, DomainError>>;
}
