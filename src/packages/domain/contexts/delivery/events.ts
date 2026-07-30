/**
 * @file contexts/delivery/events.ts
 * @package @eks-food/domain/contexts/delivery
 *
 * Delivery bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for deliveries, their routes and stops.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface DeliveryCreatedEvent extends DomainEvent {
  readonly eventType: 'delivery.created.v1';
  readonly tenantId: UUID;
  readonly bookingId: UUID | null;
  readonly pickupAt: ISODateString;
  readonly createdAt: ISODateString;
}

export interface RouteOptimizedEvent extends DomainEvent {
  readonly eventType: 'delivery.route.optimized.v1';
  readonly stopCount: number;
  readonly estimatedDistanceKm: number;
  readonly estimatedDurationMinutes: number;
}

export interface StopArrivedEvent extends DomainEvent {
  readonly eventType: 'delivery.stop.arrived.v1';
  readonly stopId: UUID;
  readonly arrivedAt: ISODateString;
}

export interface DeliveryCompletedEvent extends DomainEvent {
  readonly eventType: 'delivery.completed.v1';
  readonly completedAt: ISODateString;
  readonly proofOfDelivery?: string;
}
