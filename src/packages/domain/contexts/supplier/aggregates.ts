/**
 * @file contexts/supplier/aggregates.ts
 * @package @eks-food/domain/contexts/supplier
 *
 * Supplier bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  CatalogItem,
  CatalogStatus,
  SupplierDeliveryTerms,
  SupplierStatus,
} from './value-objects';

/**
 * Aggregate root representing a Supplier of ingredients or equipment.
 */
export interface SupplierAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'SupplierAggregate';
  readonly tenantId: UUID;
  readonly name: string;
  readonly status: SupplierStatus;
  readonly deliveryTerms: SupplierDeliveryTerms;
  readonly verifiedAt: ISODateString | null;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;

  verify(verifiedBy: UUID, now: ISODateString): Result<void, DomainError>;
  suspend(reason: string): Result<void, DomainError>;
  terminate(): Result<void, DomainError>;
  updateDeliveryTerms(patch: Partial<SupplierDeliveryTerms>): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Supplier's product catalog.
 */
export interface CatalogAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'CatalogAggregate';
  readonly supplierId: UUID;
  readonly name: string;
  readonly status: CatalogStatus;
  readonly items: ReadonlyArray<CatalogItem>;
  readonly publishedAt: ISODateString | null;

  addItem(item: CatalogItem): Result<void, DomainError>;
  updateItem(itemId: UUID, patch: Partial<CatalogItem>): Result<void, DomainError>;
  removeItem(itemId: UUID): Result<void, DomainError>;
  publish(now: ISODateString): Result<void, DomainError>;
  archive(): Result<void, DomainError>;
}
