/**
 * @file contexts/marketplace/value-objects.ts
 * @package @eks-food/domain/contexts/marketplace
 *
 * Marketplace bounded context — value objects.
 */

export type {
  GeoPoint,
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';

import type {
  GeoPoint,
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for a Listing.
 */
export type ListingStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'PAUSED'
  | 'SOLD_OUT'
  | 'EXPIRED'
  | 'REMOVED';

/**
 * Lifecycle states for an Offer.
 */
export type OfferStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'WITHDRAWN';

/**
 * Branded primitive representing a listing category.
 */
export type ListingCategory = string & { readonly __brand: 'ListingCategory' };

/**
 * Pricing model for a listing.
 */
export interface ListingPricing {
  readonly askPrice: Money;
  readonly reservePrice: Money | null;
  readonly acceptsOffers: boolean;
  readonly currency: string;
}

/**
 * Listing-specific attributes (varies by category).
 */
export interface ListingAttributes {
  readonly pickupLocation: GeoPoint | null;
  readonly availableFrom: ISODateString;
  readonly availableUntil: ISODateString;
  readonly quantity: number;
  readonly unit: string;
}

/**
 * A single offer against a listing.
 */
export interface Offer {
  readonly id: UUID;
  readonly buyerId: UUID;
  readonly offeredAmount: Money;
  readonly message?: string;
  readonly submittedAt: ISODateString;
  readonly status: OfferStatus;
  readonly resolvedAt: ISODateString | null;
}
