/**
 * @file contexts/delivery/aggregates.ts
 * @package @eks-food/domain/contexts/delivery
 *
 * Delivery bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  DeliveryPricing,
  DeliveryStatus,
  DriverId,
  ProofOfDelivery,
  Route,
  Stop,
  StopStatus,
} from './value-objects';

/**
 * Aggregate root representing a Delivery: a scheduled trip from a
 * pickup point through one or more stops.
 */
export interface DeliveryAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'DeliveryAggregate';
  readonly tenantId: UUID;
  readonly bookingId: UUID | null;
  readonly driverId: DriverId | null;
  readonly status: DeliveryStatus;
  readonly pickupAt: ISODateString;
  readonly route: Route | null;
  readonly pricing: DeliveryPricing | null;
  readonly proof: ProofOfDelivery | null;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;

  assignDriver(driverId: DriverId): Result<void, DomainError>;
  dispatch(now: ISODateString): Result<void, DomainError>;
  startTransit(now: ISODateString): Result<void, DomainError>;
  complete(proof: ProofOfDelivery, now: ISODateString): Result<void, DomainError>;
  fail(reason: string, now: ISODateString): Result<void, DomainError>;
  cancel(reason: string): Result<void, DomainError>;
  setRoute(route: Route): Result<void, DomainError>;
  setPricing(pricing: DeliveryPricing): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Route: the ordered list of stops with
 * metrics. Carved out so routes can be re-optimised independently of
 * the parent delivery.
 */
export interface RouteAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'RouteAggregate';
  readonly deliveryId: UUID;
  readonly stops: ReadonlyArray<Stop>;
  readonly estimatedDistanceKm: number;
  readonly estimatedDurationMinutes: number;

  optimise(): Result<void, DomainError>;
  addStop(stop: Stop): Result<void, DomainError>;
  removeStop(stopId: UUID): Result<void, DomainError>;
  reorderStops(orderedIds: ReadonlyArray<UUID>): Result<void, DomainError>;
}

/**
 * Aggregate root representing a single Stop. Carved out for
 * high-frequency status updates (driver app pings).
 */
export interface StopAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'StopAggregate';
  readonly deliveryId: UUID;
  readonly sequence: number;
  readonly status: StopStatus;
  readonly plannedArrival: ISODateString;
  readonly actualArrival: ISODateString | null;

  arrive(now: ISODateString): Result<void, DomainError>;
  complete(notes?: string): Result<void, DomainError>;
  skip(reason: string): Result<void, DomainError>;
  fail(reason: string): Result<void, DomainError>;
}
