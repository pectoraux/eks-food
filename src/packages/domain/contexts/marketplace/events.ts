/**
 * @file contexts/marketplace/events.ts
 * @package @eks-food/domain/contexts/marketplace
 *
 * Marketplace bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for marketplace listings (ready-meal
 *    SKUs, cook-offered experiences) and offers made against them.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface ListingPublishedEvent extends DomainEvent {
  readonly eventType: 'marketplace.listing.published.v1';
  readonly tenantId: UUID;
  readonly sellerId: UUID;
  readonly publishedAt: ISODateString;
}

export interface ListingUnpublishedEvent extends DomainEvent {
  readonly eventType: 'marketplace.listing.unpublished.v1';
  readonly reason: string;
}

export interface OfferSubmittedEvent extends DomainEvent {
  readonly eventType: 'marketplace.offer.submitted.v1';
  readonly buyerId: UUID;
  readonly offeredAmount: number;
  readonly submittedAt: ISODateString;
}

export interface OfferAcceptedEvent extends DomainEvent {
  readonly eventType: 'marketplace.offer.accepted.v1';
  readonly acceptedAt: ISODateString;
  readonly bookingId: UUID | null;
}
