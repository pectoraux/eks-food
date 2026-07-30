/**
 * @file contexts/developer/aggregates.ts
 * @package @eks-food/domain/contexts/developer
 *
 * Developer bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  ApiKeyPrefix,
  ApiKeyStatus,
  ApiScope,
  HashedApiKey,
  IntegrationCredentials,
  IntegrationStatus,
  WebhookConfig,
  WebhookDeliveryAttempt,
  WebhookDeliveryStatus,
  WebhookStatus,
} from './value-objects';

/**
 * Aggregate root representing an API Key issued to a principal. The
 * plaintext key is never stored; only the {@link HashedApiKey} and
 * the {@link ApiKeyPrefix} (visible identifier) are persisted.
 */
export interface ApiKeyAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'ApiKeyAggregate';
  readonly tenantId: UUID;
  readonly issuedTo: UUID;
  readonly name: string;
  readonly prefix: ApiKeyPrefix;
  readonly hash: HashedApiKey;
  readonly scopes: ReadonlyArray<ApiScope>;
  readonly status: ApiKeyStatus;
  readonly issuedAt: ISODateString;
  readonly expiresAt: ISODateString | null;
  readonly revokedAt: ISODateString | null;
  readonly revokedBy: UUID | null;
  readonly lastUsedAt: ISODateString | null;

  rotate(
    newHash: HashedApiKey,
    newPrefix: ApiKeyPrefix,
    rotatedBy: UUID,
    now: ISODateString,
  ): Result<void, DomainError>;
  revoke(reason: string, revokedBy: UUID, now: ISODateString): Result<void, DomainError>;
  touchUsed(now: ISODateString): Result<void, DomainError>;
  addScope(scope: ApiScope): Result<void, DomainError>;
  removeScope(scope: ApiScope): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Webhook subscription.
 */
export interface WebhookAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'WebhookAggregate';
  readonly tenantId: UUID;
  readonly name: string;
  readonly config: WebhookConfig;
  readonly status: WebhookStatus;
  readonly registeredAt: ISODateString;
  readonly lastDeliveryAt: ISODateString | null;
  readonly consecutiveFailures: number;

  pause(reason: string): Result<void, DomainError>;
  resume(): Result<void, DomainError>;
  disable(reason: string): Result<void, DomainError>;
  updateConfig(patch: Partial<WebhookConfig>): Result<void, DomainError>;
  recordDelivery(
    success: boolean,
    now: ISODateString,
  ): Result<void, DomainError>;
}

/**
 * Aggregate root representing a single WebhookDelivery (the
 * dispatch of one event to one webhook). Carved out for
 * high-frequency write access from the dispatcher worker.
 */
export interface WebhookDeliveryAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'WebhookDeliveryAggregate';
  readonly webhookId: UUID;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: WebhookDeliveryStatus;
  readonly attempts: ReadonlyArray<WebhookDeliveryAttempt>;
  readonly queuedAt: ISODateString;
  readonly deliveredAt: ISODateString | null;

  recordAttempt(attempt: WebhookDeliveryAttempt): Result<void, DomainError>;
  markDelivered(now: ISODateString): Result<void, DomainError>;
  markFailed(reason: string): Result<void, DomainError>;
  markSkipped(reason: string): Result<void, DomainError>;
}

/**
 * Aggregate root representing a third-party Integration (e.g. a
 * connected Payswap account, a Z.AI workspace).
 */
export interface IntegrationAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'IntegrationAggregate';
  readonly tenantId: UUID;
  readonly provider: IntegrationCredentials['provider'];
  readonly status: IntegrationStatus;
  readonly credentials: IntegrationCredentials | null;
  readonly connectedAt: ISODateString | null;
  readonly lastSyncedAt: ISODateString | null;
  readonly lastError: string | null;

  connect(credentials: IntegrationCredentials, now: ISODateString): Result<void, DomainError>;
  disconnect(reason: string): Result<void, DomainError>;
  suspend(reason: string): Result<void, DomainError>;
  markError(error: string): Result<void, DomainError>;
  markSynced(now: ISODateString): Result<void, DomainError>;
}
