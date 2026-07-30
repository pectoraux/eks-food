/**
 * @file contexts/supplier/repositories.ts
 * @package @eks-food/domain/contexts/supplier
 *
 * Supplier bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type { CatalogAggregate, SupplierAggregate } from './aggregates';
import type { Sku, SupplierStatus } from './value-objects';

export interface SupplierListFilter {
  readonly tenantId?: UUID;
  readonly status?: SupplierStatus;
  readonly deliveryZone?: string;
}

export interface SupplierRepository {
  findById(id: UUID): Promise<SupplierAggregate | null>;
  list(filter: SupplierListFilter, page: Page): Promise<PagedResult<SupplierAggregate>>;
  save(agg: SupplierAggregate): Promise<Result<void, DomainError>>;
}

export interface CatalogRepository {
  findById(id: UUID): Promise<CatalogAggregate | null>;
  findBySupplier(supplierId: UUID): Promise<CatalogAggregate | null>;
  findBySku(sku: Sku): Promise<{ catalog: CatalogAggregate; item: CatalogAggregate['items'][number] } | null>;
  save(agg: CatalogAggregate): Promise<Result<void, DomainError>>;
}
