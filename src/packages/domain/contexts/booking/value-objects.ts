/**
 * @file contexts/booking/value-objects.ts
 * @package @eks-food/domain/contexts/booking
 *
 * Booking bounded context — value objects.
 */

export type {
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';

import type {
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for a Booking.
 */
export type BookingStatus =
  | 'DRAFT'
  | 'PENDING_MATCH'
  | 'MATCHED'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

/**
 * Lifecycle states for a Reservation (time-window hold).
 */
export type ReservationStatus = 'HELD' | 'RELEASED' | 'CONSUMED' | 'EXPIRED';

/**
 * Branded primitive representing a human-readable booking code,
 * e.g. `"EKS-6GKD02"`.
 */
export type BookingCode = string & { readonly __brand: 'BookingCode' };

/**
 * A single line on a booking (a service, a meal, a surcharge, etc.).
 */
export interface BookingLine {
  readonly id: UUID;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly lineTotal: Money;
}

/**
 * Booking address (derived from the customer's address book at booking
 * time so historical bookings stay accurate even if the customer
 * later edits their addresses).
 */
export interface BookingAddress {
  readonly label: string;
  readonly line1: string;
  readonly city: string;
  readonly region?: string;
  readonly country: string;
}

/**
 * Booking pricing summary.
 */
export interface BookingPricing {
  readonly subtotal: Money;
  readonly fees: Money;
  readonly taxes: Money;
  readonly discount: Money;
  readonly total: Money;
  readonly currency: string;
}

/**
 * Reason metadata for cancellations.
 */
export interface CancellationRecord {
  readonly reason: string;
  readonly cancelledBy: UUID;
  readonly cancelledAt: ISODateString;
  readonly refundDue: Money | null;
}
