/**
 * @file contexts/supplier/events.ts
 * @package @eks-food/domain/contexts/supplier
 *
 * Supplier bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for ingredient/equipment suppliers and
 *    their product catalogs. The procurement context subscribes to
 *    catalog changes to refresh its requisition templates.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface SupplierOnboardedEvent extends DomainEvent {
  readonly eventType: 'supplier.onboarded.v1';
  readonly tenantId: UUID;
  readonly name: string;
  readonly onboardedAt: ISODateString;
}

export interface SupplierVerifiedEvent extends DomainEvent {
  readonly eventType: 'supplier.verified.v1';
  readonly verifiedBy: UUID;
  readonly verifiedAt: ISODateString;
}

export interface CatalogPublishedEvent extends DomainEvent {
  readonly eventType: 'supplier.catalog.published.v1';
  readonly catalogId: UUID;
  readonly skuCount: number;
}

export interface CatalogItemPriceChangedEvent extends DomainEvent {
  readonly eventType: 'supplier.catalog.item.price.changed.v1';
  readonly sku: string;
  readonly previousUnitPrice: number;
  readonly newUnitPrice: number;
  readonly effectiveAt: ISODateString;
}
