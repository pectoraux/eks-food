/**
 * @file contexts/vendor/repositories.ts
 * @package @eks-food/domain/contexts/vendor
 *
 * Vendor bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type { StallAggregate, VendorAggregate } from './aggregates';
import type { StallStatus, VendorStatus } from './value-objects';

export interface VendorListFilter {
  readonly tenantId?: UUID;
  readonly status?: VendorStatus;
}

export interface VendorRepository {
  findById(id: UUID): Promise<VendorAggregate | null>;
  list(filter: VendorListFilter, page: Page): Promise<PagedResult<VendorAggregate>>;
  save(agg: VendorAggregate): Promise<Result<void, DomainError>>;
}

export interface StallListFilter {
  readonly vendorId?: UUID;
  readonly status?: StallStatus;
  readonly availableFrom?: string;
}

export interface StallRepository {
  findById(id: UUID): Promise<StallAggregate | null>;
  listByVendor(vendorId: UUID): Promise<ReadonlyArray<StallAggregate>>;
  list(filter: StallListFilter, page: Page): Promise<PagedResult<StallAggregate>>;
  save(agg: StallAggregate): Promise<Result<void, DomainError>>;
}
