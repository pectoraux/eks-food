/**
 * @file contexts/marketplace/repositories.ts
 * @package @eks-food/domain/contexts/marketplace
 *
 * Marketplace bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  GeoBounds,
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type { ListingAggregate, OfferAggregate } from './aggregates';
import type { ListingCategory, ListingStatus, OfferStatus } from './value-objects';

export interface ListingListFilter {
  readonly tenantId?: UUID;
  readonly sellerId?: UUID;
  readonly status?: ListingStatus;
  readonly category?: ListingCategory;
  readonly withinBounds?: GeoBounds;
  readonly availableBefore?: string;
}

export interface ListingRepository {
  findById(id: UUID): Promise<ListingAggregate | null>;
  list(filter: ListingListFilter, page: Page): Promise<PagedResult<ListingAggregate>>;
  save(agg: ListingAggregate): Promise<Result<void, DomainError>>;
}

export interface OfferRepository {
  findById(id: UUID): Promise<OfferAggregate | null>;
  listByListing(listingId: UUID): Promise<ReadonlyArray<OfferAggregate>>;
  listByBuyer(buyerId: UUID, page: Page): Promise<PagedResult<OfferAggregate>>;
  save(agg: OfferAggregate): Promise<Result<void, DomainError>>;
}

export type { OfferStatus };
