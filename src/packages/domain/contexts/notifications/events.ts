/**
 * @file contexts/notifications/events.ts
 * @package @eks-food/domain/contexts/notifications
 *
 * Notifications bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for notifications, channels and
 *    templates. The notifications context is a subscriber to most
 *    other contexts and emits its own events for delivery tracking.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface NotificationDispatchedEvent extends DomainEvent {
  readonly eventType: 'notifications.dispatched.v1';
  readonly recipientId: UUID;
  readonly channel: string;
  readonly dispatchedAt: ISODateString;
}

export interface NotificationDeliveredEvent extends DomainEvent {
  readonly eventType: 'notifications.delivered.v1';
  readonly deliveredAt: ISODateString;
  readonly providerMessageId?: string;
}

export interface NotificationFailedEvent extends DomainEvent {
  readonly eventType: 'notifications.failed.v1';
  readonly reason: string;
  readonly failedAt: ISODateString;
}

export interface TemplatePublishedEvent extends DomainEvent {
  readonly eventType: 'notifications.template.published.v1';
  readonly templateKey: string;
  readonly templateVersion: number;
}
