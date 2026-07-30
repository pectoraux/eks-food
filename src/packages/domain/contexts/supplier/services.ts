/**
 * @file contexts/supplier/services.ts
 * @package @eks-food/domain/contexts/supplier
 *
 * Supplier bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { Money, UUID } from '../../shared/value-objects';
import type { CatalogAggregate, SupplierAggregate } from './aggregates';
import type { Sku } from './value-objects';

/**
 * Resolves a SKU across all supplier catalogs in a tenant and returns
 * the best unit price (by lead time, then by price). Used by the
 * procurement context during requisition planning.
 */
export interface CatalogSearchService {
  findSku(tenantId: UUID, sku: Sku): Promise<
    | {
        supplier: SupplierAggregate;
        catalog: CatalogAggregate;
        unitPrice: Money;
      }
    | null
  >;
  bestPriceForQuantities(
    tenantId: UUID,
    quantities: ReadonlyArray<{ sku: Sku; quantity: number }>,
  ): Promise<
    Result<
      ReadonlyArray<{
        sku: Sku;
        supplierId: UUID;
        unitPrice: Money;
        lineTotal: Money;
      }>,
      DomainError
    >
  >;
}
