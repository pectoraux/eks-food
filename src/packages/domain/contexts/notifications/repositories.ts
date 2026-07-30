/**
 * @file contexts/notifications/repositories.ts
 * @package @eks-food/domain/contexts/notifications
 *
 * Notifications bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  ChannelAggregate,
  NotificationAggregate,
  TemplateAggregate,
} from './aggregates';
import type {
  NotificationChannelType,
  NotificationStatus,
  TemplateKey,
} from './value-objects';

export interface NotificationListFilter {
  readonly tenantId?: UUID;
  readonly recipientId?: UUID;
  readonly templateKey?: TemplateKey;
  readonly channel?: NotificationChannelType;
  readonly status?: NotificationStatus;
  readonly from?: string;
  readonly to?: string;
}

export interface NotificationRepository {
  findById(id: UUID): Promise<NotificationAggregate | null>;
  list(
    filter: NotificationListFilter,
    page: Page,
  ): Promise<PagedResult<NotificationAggregate>>;
  save(agg: NotificationAggregate): Promise<Result<void, DomainError>>;
}

export interface ChannelRepository {
  findById(id: UUID): Promise<ChannelAggregate | null>;
  findByType(
    tenantId: UUID,
    type: NotificationChannelType,
  ): Promise<ChannelAggregate | null>;
  list(
    filter: { tenantId?: UUID; type?: NotificationChannelType },
    page: Page,
  ): Promise<PagedResult<ChannelAggregate>>;
  save(agg: ChannelAggregate): Promise<Result<void, DomainError>>;
}

export interface TemplateRepository {
  findById(id: UUID): Promise<TemplateAggregate | null>;
  findPublished(
    key: TemplateKey,
    channel: NotificationChannelType,
    locale: string,
  ): Promise<TemplateAggregate | null>;
  list(
    filter: { tenantId?: UUID | null; key?: TemplateKey; channel?: NotificationChannelType },
    page: Page,
  ): Promise<PagedResult<TemplateAggregate>>;
  save(agg: TemplateAggregate): Promise<Result<void, DomainError>>;
}
