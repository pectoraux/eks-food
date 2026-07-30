/**
 * @file contexts/foodgraph/aggregates.ts
 * @package @eks-food/domain/contexts/foodgraph
 *
 * Foodgraph bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  CuisineCode,
  IngredientCategory,
  IngredientSubstitution,
  LocalizedText,
  MealCategory,
  NutritionProfile,
  RecipeIngredient,
  RecipeStatus,
  RecipeStep,
} from './value-objects';

/**
 * Aggregate root representing an Ingredient (a node in the food
 * knowledge graph).
 */
export interface IngredientAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'IngredientAggregate';
  readonly name: LocalizedText;
  readonly category: IngredientCategory;
  readonly aliases: ReadonlyArray<string>;
  readonly nutrition: NutritionProfile | null;
  readonly substitutions: ReadonlyArray<IngredientSubstitution>;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  readonly deprecated: boolean;

  updateNutrition(profile: NutritionProfile): Result<void, DomainError>;
  addSubstitution(substitution: IngredientSubstitution): Result<void, DomainError>;
  addAlias(alias: string): Result<void, DomainError>;
  deprecate(): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Recipe: an ordered list of steps with
 * ingredients and yield.
 */
export interface RecipeAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'RecipeAggregate';
  readonly tenantId: UUID | null;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly cuisine: CuisineCode;
  readonly status: RecipeStatus;
  readonly ingredients: ReadonlyArray<RecipeIngredient>;
  readonly steps: ReadonlyArray<RecipeStep>;
  readonly servings: number;
  readonly totalDurationMinutes: number;
  readonly nutritionPerServing: NutritionProfile | null;
  readonly publishedAt: ISODateString | null;
  readonly updatedAt: ISODateString;

  addIngredient(ingredient: RecipeIngredient): Result<void, DomainError>;
  removeIngredient(ingredientId: UUID): Result<void, DomainError>;
  addStep(step: RecipeStep): Result<void, DomainError>;
  reorderSteps(orderedSequences: ReadonlyArray<number>): Result<void, DomainError>;
  publish(now: ISODateString): Result<void, DomainError>;
  deprecate(): Result<void, DomainError>;
  setNutrition(profile: NutritionProfile): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Meal: a marketable, bookable food
 * offering derived from one or more recipes.
 */
export interface MealAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'MealAggregate';
  readonly tenantId: UUID;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly cuisine: CuisineCode;
  readonly categories: ReadonlyArray<MealCategory>;
  readonly recipeIds: ReadonlyArray<UUID>;
  readonly nutrition: NutritionProfile | null;
  readonly imageUrl: string | null;
  readonly active: boolean;
  readonly onboardedAt: ISODateString;

  addRecipe(recipeId: UUID): Result<void, DomainError>;
  removeRecipe(recipeId: UUID): Result<void, DomainError>;
  addCategory(category: MealCategory): Result<void, DomainError>;
  setNutrition(profile: NutritionProfile): Result<void, DomainError>;
  activate(): Result<void, DomainError>;
  deactivate(): Result<void, DomainError>;
}
