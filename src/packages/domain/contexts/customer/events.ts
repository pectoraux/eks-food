/**
 * @file contexts/customer/events.ts
 * @package @eks-food/domain/contexts/customer
 *
 * Customer bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for customers and their addresses /
 *    preferences. Downstream contexts (booking, marketing, analytics)
 *    subscribe to personalise the experience.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface CustomerRegisteredEvent extends DomainEvent {
  readonly eventType: 'customer.registered.v1';
  readonly tenantId: UUID;
  readonly userId: UUID;
  readonly displayName: string;
  readonly registeredAt: ISODateString;
}

export interface CustomerPreferenceUpdatedEvent extends DomainEvent {
  readonly eventType: 'customer.preference.updated.v1';
  readonly key: string;
  readonly value: unknown;
}

export interface CustomerAddressAddedEvent extends DomainEvent {
  readonly eventType: 'customer.address.added.v1';
  readonly label: string;
  readonly isDefault: boolean;
}

export interface CustomerSuspendedEvent extends DomainEvent {
  readonly eventType: 'customer.suspended.v1';
  readonly reason: string;
  readonly suspendedAt: ISODateString;
}
