/**
 * @file contexts/cook/repositories.ts
 * @package @eks-food/domain/contexts/cook
 *
 * Cook bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  GeoBounds,
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  AvailabilityAggregate,
  CertificationAggregate,
  CookAggregate,
} from './aggregates';
import type { CookStatus, CuisineCode } from './value-objects';

export interface CookListFilter {
  readonly tenantId?: UUID;
  readonly status?: CookStatus;
  readonly cuisines?: ReadonlyArray<CuisineCode>;
  readonly withinBounds?: GeoBounds;
  readonly minRating?: number;
}

export interface CookRepository {
  findById(id: UUID): Promise<CookAggregate | null>;
  findByUserId(userId: UUID): Promise<CookAggregate | null>;
  list(filter: CookListFilter, page: Page): Promise<PagedResult<CookAggregate>>;
  save(agg: CookAggregate): Promise<Result<void, DomainError>>;
}

export interface CertificationRepository {
  findById(id: UUID): Promise<CertificationAggregate | null>;
  listByCook(cookId: UUID): Promise<ReadonlyArray<CertificationAggregate>>;
  listExpiringBefore(date: string): Promise<ReadonlyArray<CertificationAggregate>>;
  save(agg: CertificationAggregate): Promise<Result<void, DomainError>>;
}

export interface AvailabilityRepository {
  findByCookId(cookId: UUID): Promise<AvailabilityAggregate | null>;
  save(agg: AvailabilityAggregate): Promise<Result<void, DomainError>>;
}
