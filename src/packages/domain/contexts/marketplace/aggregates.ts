/**
 * @file contexts/marketplace/aggregates.ts
 * @package @eks-food/domain/contexts/marketplace
 *
 * Marketplace bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  ListingAttributes,
  ListingCategory,
  ListingPricing,
  ListingStatus,
  Offer,
} from './value-objects';

/**
 * Aggregate root representing a marketplace listing (a ready meal, a
 * cook-offered experience, surplus inventory, etc.).
 */
export interface ListingAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'ListingAggregate';
  readonly tenantId: UUID;
  readonly sellerId: UUID;
  readonly title: string;
  readonly description: string;
  readonly category: ListingCategory;
  readonly status: ListingStatus;
  readonly pricing: ListingPricing;
  readonly attributes: ListingAttributes;
  readonly offers: ReadonlyArray<Offer>;
  readonly publishedAt: ISODateString | null;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;

  publish(now: ISODateString): Result<void, DomainError>;
  pause(reason: string): Result<void, DomainError>;
  unpublish(reason: string): Result<void, DomainError>;
  markSoldOut(): Result<void, DomainError>;
  updatePricing(patch: Partial<ListingPricing>): Result<void, DomainError>;
  receiveOffer(offer: Offer): Result<void, DomainError>;
}

/**
 * Aggregate root representing a single buyer's offer against a listing.
 * Carved out so offers can be acted on independently of the listing.
 */
export interface OfferAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'OfferAggregate';
  readonly listingId: UUID;
  readonly buyerId: UUID;
  readonly offeredAmount: Offer['offeredAmount'];
  readonly status: Offer['status'];
  readonly submittedAt: ISODateString;
  readonly resolvedAt: ISODateString | null;
  readonly bookingId: UUID | null;

  accept(now: ISODateString, bookingId?: UUID): Result<void, DomainError>;
  reject(reason: string, now: ISODateString): Result<void, DomainError>;
  withdraw(now: ISODateString): Result<void, DomainError>;
  expire(now: ISODateString): Result<void, DomainError>;
}
