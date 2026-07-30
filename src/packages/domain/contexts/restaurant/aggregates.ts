/**
 * @file contexts/restaurant/aggregates.ts
 * @package @eks-food/domain/contexts/restaurant
 *
 * Restaurant bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  GeoPoint,
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  CuisineCode,
  MenuItem,
  MenuStatus,
  OperatingSchedule,
  RestaurantStatus,
} from './value-objects';

/**
 * Aggregate root representing a Restaurant (a physical food-service
 * venue operated by an organisation).
 */
export interface RestaurantAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'RestaurantAggregate';
  readonly tenantId: UUID;
  readonly name: string;
  readonly description: string;
  readonly status: RestaurantStatus;
  readonly cuisines: ReadonlyArray<CuisineCode>;
  readonly location: GeoPoint | null;
  readonly address: string;
  readonly schedule: OperatingSchedule | null;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;

  activate(): Result<void, DomainError>;
  pause(reason: string): Result<void, DomainError>;
  suspend(reason: string): Result<void, DomainError>;
  close(): Result<void, DomainError>;
  setSchedule(schedule: OperatingSchedule): Result<void, DomainError>;
  addCuisine(code: CuisineCode): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Restaurant's menu.
 */
export interface MenuAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'MenuAggregate';
  readonly restaurantId: UUID;
  readonly name: string;
  readonly status: MenuStatus;
  readonly items: ReadonlyArray<MenuItem>;
  readonly publishedAt: ISODateString | null;

  addItem(item: MenuItem): Result<void, DomainError>;
  updateItem(itemId: UUID, patch: Partial<MenuItem>): Result<void, DomainError>;
  removeItem(itemId: UUID): Result<void, DomainError>;
  publish(now: ISODateString): Result<void, DomainError>;
  archive(): Result<void, DomainError>;
}
