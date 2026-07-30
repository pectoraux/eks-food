/**
 * @file contexts/procurement/services.ts
 * @package @eks-food/domain/contexts/procurement
 *
 * Procurement bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { UUID } from '../../shared/value-objects';
import type { OrderAggregate, RequisitionAggregate } from './aggregates';

/**
 * Converts an approved requisition into one or more supplier orders,
 * splitting lines across the best-priced suppliers via the supplier
 * context's CatalogSearchService.
 */
export interface RequisitionFulfilmentPlanner {
  planOrders(
    requisition: RequisitionAggregate,
  ): Promise<Result<ReadonlyArray<OrderAggregate>, DomainError>>;
  splitBySupplier(
    requisition: RequisitionAggregate,
  ): Promise<
    Result<ReadonlyMap<UUID, ReadonlyArray<{ sku: string; quantity: number }>>, DomainError>
  >;
}

/**
 * Aggregates demand across multiple tenants for the same SKU to unlock
 * group-purchasing discounts. Returns the consolidated quantities that
 * the planner then places as a single bulk order.
 */
export interface GroupPurchasingAggregator {
  consolidate(
    requisitions: ReadonlyArray<RequisitionAggregate>,
  ): ReadonlyMap<string, number>;
  estimateSavings(
    consolidated: ReadonlyMap<string, number>,
  ): Promise<Result<number, DomainError>>;
}
