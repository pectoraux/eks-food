/**
 * @file contexts/vendor/events.ts
 * @package @eks-food/domain/contexts/vendor
 *
 * Vendor bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for vendors (shared-kitchen operators)
 *    and their stalls. A stall is a rentable workspace inside a
 *    vendor's kitchen.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface VendorOnboardedEvent extends DomainEvent {
  readonly eventType: 'vendor.onboarded.v1';
  readonly tenantId: UUID;
  readonly name: string;
  readonly onboardedAt: ISODateString;
}

export interface VendorActivatedEvent extends DomainEvent {
  readonly eventType: 'vendor.activated.v1';
  readonly activatedAt: ISODateString;
}

export interface StallListedEvent extends DomainEvent {
  readonly eventType: 'vendor.stall.listed.v1';
  readonly stallId: UUID;
  readonly hourlyRate: number;
}

export interface StallRentedEvent extends DomainEvent {
  readonly eventType: 'vendor.stall.rented.v1';
  readonly stallId: UUID;
  readonly cookId: UUID;
  readonly rentedFrom: ISODateString;
  readonly rentedTo: ISODateString;
}
