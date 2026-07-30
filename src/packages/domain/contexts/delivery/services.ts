/**
 * @file contexts/delivery/services.ts
 * @package @eks-food/domain/contexts/delivery
 *
 * Delivery bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  GeoPoint,
  ISODateString,
  Money,
} from '../../shared/value-objects';
import type { RouteAggregate } from './aggregates';
import type { DriverId, Stop } from './value-objects';

/**
 * Optimises the order of stops on a route to minimise distance /
 * duration. The implementation lives in the application layer (and
 * may call out to the optimization context for vehicle-routing
 * problems).
 */
export interface RouteOptimizer {
  optimise(stops: ReadonlyArray<Stop>): Promise<Result<RouteAggregate, DomainError>>;
  estimate(
    origin: GeoPoint,
    stops: ReadonlyArray<Stop>,
  ): Promise<Result<{ distanceKm: number; durationMinutes: number }, DomainError>>;
}

/**
 * Selects the best available driver for a delivery given the
 * driver's current location, capacity and SLA.
 */
export interface DriverAssignmentService {
  assign(
    pickupAt: ISODateString,
    pickupLocation: GeoPoint,
    estimatedEarning: Money,
  ): Promise<Result<DriverId, DomainError>>;
  release(driverId: DriverId): Promise<Result<void, DomainError>>;
}
