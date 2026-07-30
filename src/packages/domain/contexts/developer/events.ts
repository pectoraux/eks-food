/**
 * @file contexts/developer/events.ts
 * @package @eks-food/domain/contexts/developer
 *
 * Developer bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for API keys, webhooks and third-party
 *    integrations. The notifications context subscribes to webhook
 *    deliveries; the identity context subscribes to API key
 *    revocations.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface ApiKeyIssuedEvent extends DomainEvent {
  readonly eventType: 'developer.api_key.issued.v1';
  readonly issuedTo: UUID;
  readonly scopes: ReadonlyArray<string>;
  readonly issuedAt: ISODateString;
  readonly expiresAt: ISODateString | null;
}

export interface ApiKeyRevokedEvent extends DomainEvent {
  readonly eventType: 'developer.api_key.revoked.v1';
  readonly revokedBy: UUID;
  readonly revokedAt: ISODateString;
  readonly reason: string;
}

export interface WebhookRegisteredEvent extends DomainEvent {
  readonly eventType: 'developer.webhook.registered.v1';
  readonly url: string;
  readonly eventTypes: ReadonlyArray<string>;
  readonly registeredAt: ISODateString;
}

export interface WebhookDeliveryFailedEvent extends DomainEvent {
  readonly eventType: 'developer.webhook.delivery.failed.v1';
  readonly deliveryId: UUID;
  readonly attemptCount: number;
  readonly lastError: string;
  readonly failedAt: ISODateString;
}
