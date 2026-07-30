/**
 * @file contexts/inventory/services.ts
 * @package @eks-food/domain/contexts/inventory
 *
 * Inventory bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { ISODateString, UUID } from '../../shared/value-objects';
import type { StockAggregate } from './aggregates';
import type { InventorySku } from './value-objects';

/**
 * Reserves stock across multiple warehouses for a single booking or
 * order. Implements first-fit or best-fit allocation; the
 * implementation lives in the application layer.
 */
export interface StockReservationService {
  reserveAcrossWarehouses(
    tenantId: UUID,
    items: ReadonlyArray<{ sku: InventorySku; quantity: number }>,
    reference: string,
  ): Promise<Result<ReadonlyArray<{ warehouseId: UUID; reservation: StockAggregate }>, DomainError>>;
  releaseReservations(reference: string): Promise<Result<void, DomainError>>;
}

/**
 * Predicts stock-out dates from historical movement velocity and
 * current levels. Used by the procurement context to pre-empt
 * requisitions.
 */
export interface StockForecastService {
  predictStockOut(
    sku: InventorySku,
    warehouseId: UUID,
    horizonDays: number,
    now: ISODateString,
  ): Promise<Result<ISODateString | null, DomainError>>;
  recommendReorder(
    tenantId: UUID,
  ): Promise<Result<ReadonlyArray<{ sku: InventorySku; suggestedQuantity: number }>, DomainError>>;
}
