/**
 * @file contexts/cook/events.ts
 * @package @eks-food/domain/contexts/cook
 *
 * Cook bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for cooks: registration, activation,
 *    certification, availability changes. The booking and matching
 *    contexts subscribe to maintain the cook search index.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface CookRegisteredEvent extends DomainEvent {
  readonly eventType: 'cook.registered.v1';
  readonly tenantId: UUID;
  readonly userId: UUID;
  readonly displayName: string;
  readonly registeredAt: ISODateString;
}

export interface CookActivatedEvent extends DomainEvent {
  readonly eventType: 'cook.activated.v1';
  readonly activatedAt: ISODateString;
}

export interface CookCertificationAwardedEvent extends DomainEvent {
  readonly eventType: 'cook.certification.awarded.v1';
  readonly certificationType: string;
  readonly issuedBy: UUID;
  readonly expiresAt: ISODateString | null;
}

export interface CookAvailabilityChangedEvent extends DomainEvent {
  readonly eventType: 'cook.availability.changed.v1';
  readonly slotCount: number;
  readonly changedAt: ISODateString;
}
