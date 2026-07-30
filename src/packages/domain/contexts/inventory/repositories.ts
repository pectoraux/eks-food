/**
 * @file contexts/inventory/repositories.ts
 * @package @eks-food/domain/contexts/inventory
 *
 * Inventory bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  MovementAggregate,
  StockAggregate,
  WarehouseAggregate,
} from './aggregates';
import type { InventorySku, WarehouseStatus } from './value-objects';

export interface StockRepository {
  findById(id: UUID): Promise<StockAggregate | null>;
  findBySkuAndWarehouse(
    sku: InventorySku,
    warehouseId: UUID,
  ): Promise<StockAggregate | null>;
  listByWarehouse(warehouseId: UUID): Promise<ReadonlyArray<StockAggregate>>;
  listLowStock(
    tenantId: UUID,
  ): Promise<ReadonlyArray<StockAggregate>>;
  save(agg: StockAggregate): Promise<Result<void, DomainError>>;
}

export interface MovementRepository {
  findById(id: UUID): Promise<MovementAggregate | null>;
  list(
    filter: {
      tenantId?: UUID;
      sku?: InventorySku;
      warehouseId?: UUID;
      from?: string;
      to?: string;
    },
    page: Page,
  ): Promise<PagedResult<MovementAggregate>>;
  save(agg: MovementAggregate): Promise<Result<void, DomainError>>;
}

export interface WarehouseRepository {
  findById(id: UUID): Promise<WarehouseAggregate | null>;
  list(
    filter: { tenantId?: UUID; status?: WarehouseStatus },
    page: Page,
  ): Promise<PagedResult<WarehouseAggregate>>;
  save(agg: WarehouseAggregate): Promise<Result<void, DomainError>>;
}
