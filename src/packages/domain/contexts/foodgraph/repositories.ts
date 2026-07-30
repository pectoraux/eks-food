/**
 * @file contexts/foodgraph/repositories.ts
 * @package @eks-food/domain/contexts/foodgraph
 *
 * Foodgraph bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  IngredientAggregate,
  MealAggregate,
  RecipeAggregate,
} from './aggregates';
import type {
  CuisineCode,
  IngredientCategory,
  MealCategory,
  RecipeStatus,
} from './value-objects';

export interface IngredientListFilter {
  readonly category?: IngredientCategory;
  readonly deprecated?: boolean;
  readonly allergen?: string;
}

export interface IngredientRepository {
  findById(id: UUID): Promise<IngredientAggregate | null>;
  list(
    filter: IngredientListFilter,
    page: Page,
  ): Promise<PagedResult<IngredientAggregate>>;
  searchByName(query: string, page: Page): Promise<PagedResult<IngredientAggregate>>;
  save(agg: IngredientAggregate): Promise<Result<void, DomainError>>;
}

export interface RecipeListFilter {
  readonly tenantId?: UUID | null;
  readonly cuisine?: CuisineCode;
  readonly status?: RecipeStatus;
  readonly containsIngredient?: UUID;
}

export interface RecipeRepository {
  findById(id: UUID): Promise<RecipeAggregate | null>;
  list(
    filter: RecipeListFilter,
    page: Page,
  ): Promise<PagedResult<RecipeAggregate>>;
  save(agg: RecipeAggregate): Promise<Result<void, DomainError>>;
}

export interface MealListFilter {
  readonly tenantId?: UUID;
  readonly cuisine?: CuisineCode;
  readonly category?: MealCategory;
  readonly active?: boolean;
}

export interface MealRepository {
  findById(id: UUID): Promise<MealAggregate | null>;
  list(
    filter: MealListFilter,
    page: Page,
  ): Promise<PagedResult<MealAggregate>>;
  save(agg: MealAggregate): Promise<Result<void, DomainError>>;
}
