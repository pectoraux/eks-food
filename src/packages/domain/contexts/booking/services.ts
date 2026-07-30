/**
 * @file contexts/booking/services.ts
 * @package @eks-food/domain/contexts/booking
 *
 * Booking bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { ISODateString, UUID } from '../../shared/value-objects';
import type {
  BookingAggregate,
  ReservationAggregate,
} from './aggregates';

/**
 * Booking matcher interface (canonical). The implementation lives in
 * the application layer and delegates cook scoring to the cook context's
 * {@link import('../cook/services').CookMatcher}.
 */
export interface BookingMatcher {
  match(query: BookingQuery): Promise<ReadonlyArray<CookMatch>>;
  autoAssign(booking: BookingAggregate): Promise<Result<BookingAggregate, DomainError>>;
}

/**
 * Query shape consumed by {@link BookingMatcher}.
 */
export interface BookingQuery {
  readonly tenantId: UUID;
  readonly bookingId: UUID;
  readonly scheduledFor: ISODateString;
  readonly durationMinutes: number;
  readonly cuisines?: ReadonlyArray<string>;
  readonly languages?: ReadonlyArray<string>;
  readonly serviceArea?: { readonly lat: number; readonly lng: number };
  readonly maxDistanceKm?: number;
  readonly budget?: { readonly amount: number; readonly currency: string };
  readonly limit?: number;
}

/**
 * Single match candidate.
 */
export interface CookMatch {
  readonly cookId: UUID;
  readonly score: number;
  readonly breakdown: Readonly<Record<string, number>>;
}

/**
 * Reservation manager: places a hold on a cook's slot and returns the
 * resulting reservation. Used by the booking flow before checkout.
 */
export interface ReservationManager {
  holdSlot(
    cookId: UUID,
    customerId: UUID,
    from: ISODateString,
    until: ISODateString,
  ): Promise<Result<ReservationAggregate, DomainError>>;
  release(reservationId: UUID): Promise<Result<void, DomainError>>;
}
