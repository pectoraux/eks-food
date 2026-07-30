/**
 * @file contexts/booking/aggregates.ts
 * @package @eks-food/domain/contexts/booking
 *
 * Booking bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';
import type {
  BookingAddress,
  BookingCode,
  BookingLine,
  BookingPricing,
  BookingStatus,
  CancellationRecord,
  ReservationStatus,
} from './value-objects';

/**
 * Aggregate root representing a Booking: the central transactional
 * artefact of Eks-Food that ties together a customer, a cook, a
 * service and a payment.
 */
export interface BookingAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'BookingAggregate';
  readonly tenantId: UUID;
  readonly code: BookingCode;
  readonly customerId: UUID;
  readonly cookId: UUID | null;
  readonly status: BookingStatus;
  readonly scheduledFor: ISODateString;
  readonly durationMinutes: number;
  readonly address: BookingAddress;
  readonly lines: ReadonlyArray<BookingLine>;
  readonly pricing: BookingPricing;
  readonly paymentReference: string | null;
  readonly matchScore: number | null;
  readonly cancellation: CancellationRecord | null;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;

  assignCook(cookId: UUID, matchScore: number, assignedBy: UUID): Result<void, DomainError>;
  unassignCook(reason: string): Result<void, DomainError>;
  requestPayment(): Result<void, DomainError>;
  confirm(paymentReference: string, now: ISODateString): Result<void, DomainError>;
  start(now: ISODateString): Result<void, DomainError>;
  complete(now: ISODateString): Result<void, DomainError>;
  cancel(reason: string, cancelledBy: UUID, now: ISODateString, refundDue?: Money): Result<void, DomainError>;
  markNoShow(now: ISODateString): Result<void, DomainError>;
  addLine(line: BookingLine): Result<void, DomainError>;
  reprice(pricing: BookingPricing): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Reservation: a short-lived hold on a
 * cook's time slot that guarantees exclusivity while the customer
 * completes checkout.
 */
export interface ReservationAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'ReservationAggregate';
  readonly tenantId: UUID;
  readonly cookId: UUID;
  readonly customerId: UUID;
  readonly status: ReservationStatus;
  readonly holdFrom: ISODateString;
  readonly holdUntil: ISODateString;
  readonly bookingId: UUID | null;

  release(reason: string): Result<void, DomainError>;
  consume(bookingId: UUID): Result<void, DomainError>;
  expire(): Result<void, DomainError>;
}
