/**
 * @file contexts/inventory/events.ts
 * @package @eks-food/domain/contexts/inventory
 *
 * Inventory bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for stock, movements and warehouses.
 *    The procurement context subscribes to low-stock signals to
 *    trigger requisitions; the safety context subscribes to expiry
 *    movements.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface StockAdjustedEvent extends DomainEvent {
  readonly eventType: 'inventory.stock.adjusted.v1';
  readonly sku: string;
  readonly warehouseId: UUID;
  readonly delta: number;
  readonly reason: string;
  readonly adjustedAt: ISODateString;
}

export interface MovementRecordedEvent extends DomainEvent {
  readonly eventType: 'inventory.movement.recorded.v1';
  readonly movementType: string;
  readonly quantity: number;
  readonly recordedAt: ISODateString;
}

export interface LowStockThresholdBreachedEvent extends DomainEvent {
  readonly eventType: 'inventory.low_stock.breached.v1';
  readonly sku: string;
  readonly warehouseId: UUID;
  readonly currentQuantity: number;
  readonly threshold: number;
}

export interface WarehouseOpenedEvent extends DomainEvent {
  readonly eventType: 'inventory.warehouse.opened.v1';
  readonly name: string;
  readonly openedAt: ISODateString;
}
