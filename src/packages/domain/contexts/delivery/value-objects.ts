/**
 * @file contexts/delivery/value-objects.ts
 * @package @eks-food/domain/contexts/delivery
 *
 * Delivery bounded context — value objects.
 */

export type {
  GeoPoint,
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';

import type {
  GeoPoint,
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for a Delivery.
 */
export type DeliveryStatus =
  | 'SCHEDULED'
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Lifecycle states for a Stop on a route.
 */
export type StopStatus =
  | 'PENDING'
  | 'ARRIVED'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'FAILED';

/**
 * Branded primitive representing a driver/courier id.
 */
export type DriverId = UUID & { readonly __brand: 'DriverId' };

/**
 * A single stop on a delivery route.
 */
export interface Stop {
  readonly id: UUID;
  readonly sequence: number;
  readonly location: GeoPoint;
  readonly address: string;
  readonly contactName: string;
  readonly contactPhone?: string;
  readonly status: StopStatus;
  readonly plannedArrival: ISODateString;
  readonly actualArrival: ISODateString | null;
  readonly notes?: string;
}

/**
 * Optimised route geometry and metrics.
 */
export interface Route {
  readonly stops: ReadonlyArray<Stop>;
  readonly estimatedDistanceKm: number;
  readonly estimatedDurationMinutes: number;
  readonly polyline?: string;
}

/**
 * Proof of delivery captured at the final stop.
 */
export interface ProofOfDelivery {
  readonly signatureUrl?: string;
  readonly photoUrl?: string;
  readonly recipientName: string;
  readonly capturedAt: ISODateString;
  readonly geolocation: GeoPoint | null;
}

/**
 * Delivery charge breakdown.
 */
export interface DeliveryPricing {
  readonly baseFee: Money;
  readonly distanceFee: Money;
  readonly surgeFee: Money;
  readonly total: Money;
}
