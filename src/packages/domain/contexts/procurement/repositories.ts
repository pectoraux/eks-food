/**
 * @file contexts/procurement/repositories.ts
 * @package @eks-food/domain/contexts/procurement
 *
 * Procurement bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type { OrderAggregate, RequisitionAggregate } from './aggregates';
import type { OrderStatus, RequisitionStatus } from './value-objects';

export interface RequisitionListFilter {
  readonly tenantId?: UUID;
  readonly requestedBy?: UUID;
  readonly status?: RequisitionStatus;
  readonly groupPurchasing?: boolean;
}

export interface RequisitionRepository {
  findById(id: UUID): Promise<RequisitionAggregate | null>;
  list(
    filter: RequisitionListFilter,
    page: Page,
  ): Promise<PagedResult<RequisitionAggregate>>;
  save(agg: RequisitionAggregate): Promise<Result<void, DomainError>>;
}

export interface OrderListFilter {
  readonly tenantId?: UUID;
  readonly supplierId?: UUID;
  readonly requisitionId?: UUID;
  readonly status?: OrderStatus;
}

export interface OrderRepository {
  findById(id: UUID): Promise<OrderAggregate | null>;
  list(filter: OrderListFilter, page: Page): Promise<PagedResult<OrderAggregate>>;
  save(agg: OrderAggregate): Promise<Result<void, DomainError>>;
}
