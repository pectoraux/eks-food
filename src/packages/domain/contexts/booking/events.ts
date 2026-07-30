/**
 * @file contexts/booking/events.ts
 * @package @eks-food/domain/contexts/booking
 *
 * Booking bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for bookings and reservations. Bookings
 *    orchestrate cook + customer + service + payment; reservations are
 *    the time-window hold placed before a booking is confirmed.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface BookingCreatedEvent extends DomainEvent {
  readonly eventType: 'booking.created.v1';
  readonly tenantId: UUID;
  readonly customerId: UUID;
  readonly cookId: UUID | null;
  readonly code: string;
  readonly scheduledFor: ISODateString;
  readonly createdAt: ISODateString;
}

export interface BookingCookAssignedEvent extends DomainEvent {
  readonly eventType: 'booking.cook.assigned.v1';
  readonly cookId: UUID;
  readonly assignedBy: UUID;
  readonly matchScore: number;
}

export interface BookingConfirmedEvent extends DomainEvent {
  readonly eventType: 'booking.confirmed.v1';
  readonly paymentReference: string;
  readonly confirmedAt: ISODateString;
}

export interface BookingCancelledEvent extends DomainEvent {
  readonly eventType: 'booking.cancelled.v1';
  readonly reason: string;
  readonly cancelledBy: UUID;
  readonly cancelledAt: ISODateString;
}
