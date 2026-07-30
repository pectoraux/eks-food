/**
 * @file contexts/payments/aggregates.ts
 * @package @eks-food/domain/contexts/payments
 *
 * Payments bounded context — aggregate root interfaces.
 *
 * NOTE: This context owns only domain aggregates. The provider
 * orchestration (Payswap abstraction, Stripe/MoMo adapters, webhook
 * handling) lives in the payments connector package, which calls
 * into these aggregates to apply state transitions.
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
  LedgerEntry,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  ProviderReference,
  RefundStatus,
  SplitInstruction,
  TransferStatus,
  WalletStatus,
} from './value-objects';

/**
 * Aggregate root representing a Payment from a payer to a payee.
 */
export interface PaymentAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'PaymentAggregate';
  readonly tenantId: UUID;
  readonly payerId: UUID;
  readonly payeeId: UUID;
  readonly amount: Money;
  readonly status: PaymentStatus;
  readonly method: PaymentMethod | null;
  readonly provider: PaymentProvider;
  readonly providerReference: ProviderReference | null;
  readonly splits: ReadonlyArray<SplitInstruction>;
  readonly initiatedAt: ISODateString;
  readonly settledAt: ISODateString | null;
  readonly failureReason: string | null;

  pend(method: PaymentMethod): Result<void, DomainError>;
  startProcessing(): Result<void, DomainError>;
  succeed(providerReference: ProviderReference, now: ISODateString): Result<void, DomainError>;
  fail(reason: string, now: ISODateString): Result<void, DomainError>;
  cancel(reason: string): Result<void, DomainError>;
  setSplits(splits: ReadonlyArray<SplitInstruction>): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Transfer of funds from the platform
 * to an external recipient (a cook payout, a supplier payment, etc.).
 */
export interface TransferAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'TransferAggregate';
  readonly tenantId: UUID;
  readonly recipientId: UUID;
  readonly amount: Money;
  readonly status: TransferStatus;
  readonly sourcePaymentId: UUID | null;
  readonly provider: PaymentProvider;
  readonly providerReference: ProviderReference | null;
  readonly scheduledFor: ISODateString | null;
  readonly executedAt: ISODateString | null;

  schedule(forDate: ISODateString): Result<void, DomainError>;
  startTransit(): Result<void, DomainError>;
  complete(providerReference: ProviderReference, now: ISODateString): Result<void, DomainError>;
  fail(reason: string): Result<void, DomainError>;
  reverse(reason: string): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Refund against a previously
 * successful Payment.
 */
export interface RefundAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'RefundAggregate';
  readonly paymentId: UUID;
  readonly amount: Money;
  readonly status: RefundStatus;
  readonly reason: string;
  readonly requestedBy: UUID;
  readonly requestedAt: ISODateString;
  readonly issuedAt: ISODateString | null;
  readonly completedAt: ISODateString | null;

  issue(now: ISODateString): Result<void, DomainError>;
  complete(now: ISODateString): Result<void, DomainError>;
  fail(reason: string): Result<void, DomainError>;
  reject(reason: string): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Wallet: an internal ledger for a
 * tenant or principal. Balances are derived from {@link LedgerEntry}
 * records.
 */
export interface WalletAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'WalletAggregate';
  readonly tenantId: UUID;
  readonly ownerId: UUID;
  readonly currency: string;
  readonly status: WalletStatus;
  readonly balance: Money;
  readonly ledger: ReadonlyArray<LedgerEntry>;
  readonly createdAt: ISODateString;

  debit(amount: Money, reference: string, now: ISODateString): Result<LedgerEntry, DomainError>;
  credit(amount: Money, reference: string, now: ISODateString): Result<LedgerEntry, DomainError>;
  freeze(reason: string): Result<void, DomainError>;
  unfreeze(): Result<void, DomainError>;
  close(): Result<void, DomainError>;
}
