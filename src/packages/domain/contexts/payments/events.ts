/**
 * @file contexts/payments/events.ts
 * @package @eks-food/domain/contexts/payments
 *
 * Payments bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for the four payment aggregates owned
 *    here: Payment, Transfer, Refund, Wallet.
 *
 * NOTE: The provider orchestration interface (Payswap abstraction,
 * Stripe/MoMo adapters, webhook handlers) lives in the payments
 * connector package, NOT in this domain context. This context only
 * owns the domain types and aggregates.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface PaymentInitiatedEvent extends DomainEvent {
  readonly eventType: 'payments.payment.initiated.v1';
  readonly payerId: UUID;
  readonly payeeId: UUID;
  readonly amount: number;
  readonly currency: string;
  readonly initiatedAt: ISODateString;
}

export interface PaymentSucceededEvent extends DomainEvent {
  readonly eventType: 'payments.payment.succeeded.v1';
  readonly providerReference: string;
  readonly succeededAt: ISODateString;
}

export interface TransferExecutedEvent extends DomainEvent {
  readonly eventType: 'payments.transfer.executed.v1';
  readonly recipientId: UUID;
  readonly amount: number;
  readonly currency: string;
  readonly executedAt: ISODateString;
}

export interface RefundIssuedEvent extends DomainEvent {
  readonly eventType: 'payments.refund.issued.v1';
  readonly paymentId: UUID;
  readonly amount: number;
  readonly currency: string;
  readonly issuedAt: ISODateString;
}
