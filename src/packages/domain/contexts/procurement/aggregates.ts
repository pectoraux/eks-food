/**
 * @file contexts/procurement/aggregates.ts
 * @package @eks-food/domain/contexts/procurement
 *
 * Procurement bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';
import type {
  OrderLine,
  OrderStatus,
  RequisitionLine,
  RequisitionStatus,
} from './value-objects';

/**
 * Aggregate root representing a requisition: a tenant-internal request
 * to procure goods. May be converted into one or more supplier Orders.
 */
export interface RequisitionAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'RequisitionAggregate';
  readonly tenantId: UUID;
  readonly requestedBy: UUID;
  readonly status: RequisitionStatus;
  readonly lines: ReadonlyArray<RequisitionLine>;
  readonly groupPurchasing: boolean;
  readonly createdAt: ISODateString;
  readonly approvedBy: UUID | null;
  readonly approvedAt: ISODateString | null;

  submit(): Result<void, DomainError>;
  approve(approverId: UUID, now: ISODateString): Result<void, DomainError>;
  reject(reason: string): Result<void, DomainError>;
  markConverted(): Result<void, DomainError>;
  addLine(line: RequisitionLine): Result<void, DomainError>;
  removeLine(lineId: UUID): Result<void, DomainError>;
}

/**
 * Aggregate root representing a placed procurement order with a single
 * supplier.
 */
export interface OrderAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'OrderAggregate';
  readonly tenantId: UUID;
  readonly requisitionId: UUID | null;
  readonly supplierId: UUID;
  readonly status: OrderStatus;
  readonly lines: ReadonlyArray<OrderLine>;
  readonly totalAmount: Money;
  readonly placedAt: ISODateString | null;
  readonly fulfilledAt: ISODateString | null;

  place(now: ISODateString): Result<void, DomainError>;
  confirm(now: ISODateString): Result<void, DomainError>;
  recordFulfilment(
    lineId: UUID,
    receivedQuantity: number,
    now: ISODateString,
  ): Result<void, DomainError>;
  cancel(reason: string): Result<void, DomainError>;
}
