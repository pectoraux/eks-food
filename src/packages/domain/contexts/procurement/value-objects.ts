/**
 * @file contexts/procurement/value-objects.ts
 * @package @eks-food/domain/contexts/procurement
 *
 * Procurement bounded context — value objects.
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
 * Lifecycle states for a Requisition.
 */
export type RequisitionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CONVERTED';

/**
 * Lifecycle states for a procurement Order.
 */
export type OrderStatus =
  | 'PENDING'
  | 'PLACED'
  | 'CONFIRMED'
  | 'PARTIALLY_FULFILLED'
  | 'FULFILLED'
  | 'CANCELLED';

/**
 * A single line on a requisition.
 */
export interface RequisitionLine {
  readonly id: UUID;
  readonly sku: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly desiredBy: ISODateString;
}

/**
 * A single line on a placed order (resolved against a supplier catalog).
 */
export interface OrderLine {
  readonly id: UUID;
  readonly sku: string;
  readonly supplierSku: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPrice: Money;
  readonly lineTotal: Money;
  readonly fulfilledQuantity: number;
}
