/**
 * @file contexts/inventory/aggregates.ts
 * @package @eks-food/domain/contexts/inventory
 *
 * Inventory bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  InventorySku,
  MovementDirection,
  MovementReason,
  StockLevel,
  StockMovement,
  WarehouseLocation,
  WarehouseStatus,
} from './value-objects';

/**
 * Aggregate root representing the stock level of a single SKU in a
 * single warehouse. All mutations go through this aggregate so
 * invariants (non-negative available, reserved ≤ quantity) are
 * enforced centrally.
 */
export interface StockAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'StockAggregate';
  readonly tenantId: UUID;
  readonly sku: InventorySku;
  readonly warehouseId: UUID;
  readonly quantity: number;
  readonly reserved: number;
  readonly available: number;
  readonly unit: string;
  readonly lowStockThreshold: number;
  readonly lastMovementId: UUID | null;
  readonly updatedAt: ISODateString;

  inbound(
    quantity: number,
    reason: MovementReason,
    reference: string,
    actor: UUID,
    now: ISODateString,
  ): Result<StockMovement, DomainError>;
  outbound(
    quantity: number,
    reason: MovementReason,
    reference: string,
    actor: UUID,
    now: ISODateString,
  ): Result<StockMovement, DomainError>;
  reserve(quantity: number, reference: string): Result<void, DomainError>;
  release(quantity: number, reference: string): Result<void, DomainError>;
  transfer(
    quantity: number,
    toWarehouseId: UUID,
    actor: UUID,
    now: ISODateString,
  ): Result<StockMovement, DomainError>;
  adjust(
    delta: number,
    reason: string,
    actor: UUID,
    now: ISODateString,
  ): Result<StockMovement, DomainError>;
  setLowStockThreshold(threshold: number): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Movement (an immutable audit record).
 * Carved out so movements can be queried/audited without loading the
 * StockAggregate.
 */
export interface MovementAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'MovementAggregate';
  readonly tenantId: UUID;
  readonly sku: InventorySku;
  readonly warehouseId: UUID;
  readonly direction: MovementDirection;
  readonly quantity: number;
  readonly reason: MovementReason;
  readonly reference: string;
  readonly occurredAt: ISODateString;
  readonly recordedBy: UUID;
}

/**
 * Aggregate root representing a Warehouse.
 */
export interface WarehouseAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'WarehouseAggregate';
  readonly tenantId: UUID;
  readonly name: string;
  readonly location: WarehouseLocation;
  readonly status: WarehouseStatus;
  readonly createdAt: ISODateString;

  open(): Result<void, DomainError>;
  startMaintenance(): Result<void, DomainError>;
  endMaintenance(): Result<void, DomainError>;
  close(): Result<void, DomainError>;
}

export type { StockLevel };
