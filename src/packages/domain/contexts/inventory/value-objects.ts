/**
 * @file contexts/inventory/value-objects.ts
 * @package @eks-food/domain/contexts/inventory
 *
 * Inventory bounded context — value objects.
 */

export type {
  GeoPoint,
  ISODateString,
  UUID,
} from '../../shared/value-objects';

import type {
  GeoPoint,
  ISODateString,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for a Warehouse.
 */
export type WarehouseStatus = 'ACTIVE' | 'MAINTENANCE' | 'CLOSED';

/**
 * Movement direction.
 */
export type MovementDirection = 'INBOUND' | 'OUTBOUND' | 'TRANSFER';

/**
 * Branded primitive representing a movement reason code, e.g.
 * `"procurement.receipt"`, `"booking.consume"`, `"waste.expiry"`.
 */
export type MovementReason = string & { readonly __brand: 'MovementReason' };

/**
 * Branded primitive representing an SKU code (re-used from supplier
 * context's perspective but redefined here so the inventory context
 * does not depend on supplier).
 */
export type InventorySku = string & { readonly __brand: 'InventorySku' };

/**
 * Snapshot of a stock level for a single SKU in a single warehouse.
 */
export interface StockLevel {
  readonly sku: InventorySku;
  readonly warehouseId: UUID;
  readonly quantity: number;
  readonly unit: string;
  readonly reserved: number;
  readonly available: number;
  readonly lowStockThreshold: number;
  readonly updatedAt: ISODateString;
}

/**
 * A single stock movement (audit record).
 */
export interface StockMovement {
  readonly id: UUID;
  readonly sku: InventorySku;
  readonly warehouseId: UUID;
  readonly direction: MovementDirection;
  readonly quantity: number;
  readonly unit: string;
  readonly reason: MovementReason;
  readonly reference: string;
  readonly occurredAt: ISODateString;
  readonly recordedBy: UUID;
}

/**
 * Warehouse physical configuration.
 */
export interface WarehouseLocation {
  readonly name: string;
  readonly address: string;
  readonly coordinates: GeoPoint | null;
  readonly timezone: string;
}
