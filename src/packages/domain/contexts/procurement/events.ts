/**
 * @file contexts/procurement/events.ts
 * @package @eks-food/domain/contexts/procurement
 *
 * Procurement bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for procurement orders and requisitions
 *    (group-purchasing workflows).
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface RequisitionCreatedEvent extends DomainEvent {
  readonly eventType: 'procurement.requisition.created.v1';
  readonly tenantId: UUID;
  readonly requestedBy: UUID;
  readonly lineCount: number;
  readonly createdAt: ISODateString;
}

export interface RequisitionApprovedEvent extends DomainEvent {
  readonly eventType: 'procurement.requisition.approved.v1';
  readonly approvedBy: UUID;
  readonly approvedAt: ISODateString;
}

export interface OrderPlacedEvent extends DomainEvent {
  readonly eventType: 'procurement.order.placed.v1';
  readonly supplierId: UUID;
  readonly totalAmount: number;
  readonly currency: string;
}

export interface OrderFulfilledEvent extends DomainEvent {
  readonly eventType: 'procurement.order.fulfilled.v1';
  readonly fulfilledAt: ISODateString;
  readonly receivedBy: UUID;
}
