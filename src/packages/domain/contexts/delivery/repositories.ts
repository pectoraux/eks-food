/**
 * @file contexts/delivery/repositories.ts
 * @package @eks-food/domain/contexts/delivery
 *
 * Delivery bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  DeliveryAggregate,
  RouteAggregate,
  StopAggregate,
} from './aggregates';
import type { DeliveryStatus, DriverId, StopStatus } from './value-objects';

export interface DeliveryListFilter {
  readonly tenantId?: UUID;
  readonly bookingId?: UUID;
  readonly driverId?: DriverId;
  readonly status?: DeliveryStatus;
  readonly scheduledFrom?: string;
  readonly scheduledTo?: string;
}

export interface DeliveryRepository {
  findById(id: UUID): Promise<DeliveryAggregate | null>;
  findByBooking(bookingId: UUID): Promise<DeliveryAggregate | null>;
  list(filter: DeliveryListFilter, page: Page): Promise<PagedResult<DeliveryAggregate>>;
  save(agg: DeliveryAggregate): Promise<Result<void, DomainError>>;
}

export interface RouteRepository {
  findById(id: UUID): Promise<RouteAggregate | null>;
  findByDelivery(deliveryId: UUID): Promise<RouteAggregate | null>;
  save(agg: RouteAggregate): Promise<Result<void, DomainError>>;
}

export interface StopRepository {
  findById(id: UUID): Promise<StopAggregate | null>;
  listByDelivery(deliveryId: UUID): Promise<ReadonlyArray<StopAggregate>>;
  listByStatus(status: StopStatus, page: Page): Promise<PagedResult<StopAggregate>>;
  save(agg: StopAggregate): Promise<Result<void, DomainError>>;
}
