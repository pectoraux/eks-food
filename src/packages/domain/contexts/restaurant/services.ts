/**
 * @file contexts/restaurant/services.ts
 * @package @eks-food/domain/contexts/restaurant
 *
 * Restaurant bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { UUID } from '../../shared/value-objects';
import type { MenuAggregate, RestaurantAggregate } from './aggregates';

/**
 * Resolves the currently published menu for a restaurant. Returns a
 * domain error if the restaurant has no published menu.
 */
export interface MenuResolutionService {
  resolvePublished(restaurantId: UUID): Promise<Result<MenuAggregate, DomainError>>;
  ensureConsistentPricing(menu: MenuAggregate): Result<void, DomainError>;
}

/**
 * Computes whether a restaurant is currently open based on its
 * operating schedule and the current time in its timezone.
 */
export interface RestaurantOperatingService {
  isOpen(restaurant: RestaurantAggregate, now: Date): boolean;
  nextOpenTime(restaurant: RestaurantAggregate, now: Date): Date | null;
}
