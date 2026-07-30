/**
 * @file contexts/marketplace/services.ts
 * @package @eks-food/domain/contexts/marketplace
 *
 * Marketplace bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { Money, UUID } from '../../shared/value-objects';
import type { ListingAggregate, OfferAggregate } from './aggregates';

/**
 * Suggests a counter-offer price for a buyer based on the listing's
 * ask price, recent accepted offers in the same category, and the
 * buyer's history.
 */
export interface OfferPricingAdvisor {
  suggest(
    listing: ListingAggregate,
    buyerId: UUID,
  ): Promise<Result<Money, DomainError>>;
  evaluate(
    listing: ListingAggregate,
    offer: OfferAggregate,
  ): Result<{ score: number; recommendation: 'accept' | 'counter' | 'reject' }, DomainError>;
}

/**
 * Matches buyers to relevant listings. Used by the marketplace UI to
 * render personalised feeds.
 */
export interface ListingMatcher {
  recommendForBuyer(
    buyerId: UUID,
    page: { limit: number; cursor: string | null },
  ): Promise<{ items: ReadonlyArray<ListingAggregate>; nextCursor: string | null }>;
}
