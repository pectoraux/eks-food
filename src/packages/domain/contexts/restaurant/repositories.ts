/**
 * @file contexts/restaurant/repositories.ts
 * @package @eks-food/domain/contexts/restaurant
 *
 * Restaurant bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  GeoBounds,
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  MenuAggregate,
  RestaurantAggregate,
} from './aggregates';
import type { CuisineCode, RestaurantStatus } from './value-objects';

export interface RestaurantListFilter {
  readonly tenantId?: UUID;
  readonly status?: RestaurantStatus;
  readonly cuisines?: ReadonlyArray<CuisineCode>;
  readonly withinBounds?: GeoBounds;
}

export interface RestaurantRepository {
  findById(id: UUID): Promise<RestaurantAggregate | null>;
  list(
    filter: RestaurantListFilter,
    page: Page,
  ): Promise<PagedResult<RestaurantAggregate>>;
  save(agg: RestaurantAggregate): Promise<Result<void, DomainError>>;
}

export interface MenuRepository {
  findById(id: UUID): Promise<MenuAggregate | null>;
  findByRestaurant(restaurantId: UUID): Promise<MenuAggregate | null>;
  save(agg: MenuAggregate): Promise<Result<void, DomainError>>;
}
