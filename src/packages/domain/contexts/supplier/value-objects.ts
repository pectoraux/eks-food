/**
 * @file contexts/supplier/value-objects.ts
 * @package @eks-food/domain/contexts/supplier
 *
 * Supplier bounded context — value objects.
 */

export type {
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';

import type {
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for a Supplier.
 */
export type SupplierStatus =
  | 'ONBOARDING'
  | 'VERIFIED'
  | 'SUSPENDED'
  | 'TERMINATED';

/**
 * Lifecycle states for a Catalog.
 */
export type CatalogStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

/**
 * Branded primitive representing a stock-keeping unit code.
 */
export type Sku = string & { readonly __brand: 'Sku' };

/**
 * Branded primitive representing a unit of measure, e.g. `"kg"` or `"ea"`.
 */
export type UnitOfMeasure = string & { readonly __brand: 'UnitOfMeasure' };

/**
 * A single SKU listed in a supplier's catalog.
 */
export interface CatalogItem {
  readonly id: UUID;
  readonly sku: Sku;
  readonly name: string;
  readonly description: string;
  readonly unitPrice: Money;
  readonly unit: UnitOfMeasure;
  readonly minimumOrderQuantity: number;
  readonly available: boolean;
  readonly allergens: ReadonlyArray<string>;
  readonly updatedAt: ISODateString;
}

/**
 * Supplier's lead-time and delivery parameters.
 */
export interface SupplierDeliveryTerms {
  readonly leadTimeDays: number;
  readonly minimumOrderValue: Money;
  readonly deliveryZones: ReadonlyArray<string>;
  readonly paymentTermsDays: number;
}
