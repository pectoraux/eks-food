/**
 * @file contexts/developer/repositories.ts
 * @package @eks-food/domain/contexts/developer
 *
 * Developer bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  ApiKeyAggregate,
  IntegrationAggregate,
  WebhookAggregate,
  WebhookDeliveryAggregate,
} from './aggregates';
import type {
  ApiKeyPrefix,
  ApiKeyStatus,
  IntegrationProvider,
  IntegrationStatus,
  WebhookStatus,
} from './value-objects';

export interface ApiKeyListFilter {
  readonly tenantId?: UUID;
  readonly issuedTo?: UUID;
  readonly status?: ApiKeyStatus;
}

export interface ApiKeyRepository {
  findById(id: UUID): Promise<ApiKeyAggregate | null>;
  findByPrefix(prefix: ApiKeyPrefix): Promise<ApiKeyAggregate | null>;
  list(
    filter: ApiKeyListFilter,
    page: Page,
  ): Promise<PagedResult<ApiKeyAggregate>>;
  save(agg: ApiKeyAggregate): Promise<Result<void, DomainError>>;
}

export interface WebhookListFilter {
  readonly tenantId?: UUID;
  readonly status?: WebhookStatus;
  readonly eventType?: string;
}

export interface WebhookRepository {
  findById(id: UUID): Promise<WebhookAggregate | null>;
  list(
    filter: WebhookListFilter,
    page: Page,
  ): Promise<PagedResult<WebhookAggregate>>;
  listByEventType(
    tenantId: UUID,
    eventType: string,
  ): Promise<ReadonlyArray<WebhookAggregate>>;
  save(agg: WebhookAggregate): Promise<Result<void, DomainError>>;
}

export interface WebhookDeliveryRepository {
  findById(id: UUID): Promise<WebhookDeliveryAggregate | null>;
  listPending(limit: number): Promise<ReadonlyArray<WebhookDeliveryAggregate>>;
  listByWebhook(
    webhookId: UUID,
    page: Page,
  ): Promise<PagedResult<WebhookDeliveryAggregate>>;
  save(agg: WebhookDeliveryAggregate): Promise<Result<void, DomainError>>;
}

export interface IntegrationListFilter {
  readonly tenantId?: UUID;
  readonly provider?: IntegrationProvider;
  readonly status?: IntegrationStatus;
}

export interface IntegrationRepository {
  findById(id: UUID): Promise<IntegrationAggregate | null>;
  findByProvider(
    tenantId: UUID,
    provider: IntegrationProvider,
  ): Promise<IntegrationAggregate | null>;
  list(
    filter: IntegrationListFilter,
    page: Page,
  ): Promise<PagedResult<IntegrationAggregate>>;
  save(agg: IntegrationAggregate): Promise<Result<void, DomainError>>;
}
