/**
 * @file contexts/notifications/aggregates.ts
 * @package @eks-food/domain/contexts/notifications
 *
 * Notifications bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  NotificationChannelType,
  NotificationRecipient,
  NotificationStatus,
  RenderedNotification,
  TemplateKey,
  TemplateStatus,
  TemplateVariables,
  ChannelStatus,
} from './value-objects';

/**
 * Aggregate root representing a single Notification instance addressed
 * to one recipient.
 */
export interface NotificationAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'NotificationAggregate';
  readonly tenantId: UUID;
  readonly recipient: NotificationRecipient;
  readonly templateKey: TemplateKey;
  readonly variables: TemplateVariables;
  readonly channel: NotificationChannelType;
  readonly status: NotificationStatus;
  readonly rendered: RenderedNotification | null;
  readonly dispatchedAt: ISODateString | null;
  readonly deliveredAt: ISODateString | null;
  readonly failedAt: ISODateString | null;
  readonly failureReason: string | null;
  readonly correlationId: UUID;

  dispatch(rendered: RenderedNotification, now: ISODateString): Result<void, DomainError>;
  markDelivered(providerMessageId: string | null, now: ISODateString): Result<void, DomainError>;
  markFailed(reason: string, now: ISODateString): Result<void, DomainError>;
  markOpened(now: ISODateString): Result<void, DomainError>;
  markClicked(now: ISODateString): Result<void, DomainError>;
  suppress(reason: string): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Channel (a configured integration
 * with a delivery provider — SMTP, Twilio, FCM, etc.).
 */
export interface ChannelAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'ChannelAggregate';
  readonly tenantId: UUID;
  readonly type: NotificationChannelType;
  readonly name: string;
  readonly status: ChannelStatus;
  readonly config: Readonly<Record<string, unknown>>;
  readonly rateLimitPerMinute: number;

  enable(): Result<void, DomainError>;
  disable(reason: string): Result<void, DomainError>;
  rateLimit(): Result<void, DomainError>;
  updateConfig(patch: Readonly<Record<string, unknown>>): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Template (versioned, localized body
 * for a notification type).
 */
export interface TemplateAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'TemplateAggregate';
  readonly tenantId: UUID | null;
  readonly key: TemplateKey;
  readonly templateVersion: number;
  readonly status: TemplateStatus;
  readonly channel: NotificationChannelType;
  readonly locale: string;
  readonly subject: string;
  readonly body: string;
  readonly variableSchema: Readonly<Record<string, string>>;
  readonly publishedAt: ISODateString | null;

  publish(now: ISODateString): Result<void, DomainError>;
  deprecate(): Result<void, DomainError>;
}
