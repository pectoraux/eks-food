/**
 * @file contexts/payments/services.ts
 * @package @eks-food/domain/contexts/payments
 *
 * Payments bounded context — domain service interfaces.
 *
 * NOTE: The provider orchestration interface (Payswap abstraction
 * itself, Stripe/MoMo adapters, webhook signature verification, idempotency
 * key handling) lives in the payments connector package. This file
 * only declares domain services that operate purely on the local
 * aggregates.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';
import type {
  PaymentAggregate,
  TransferAggregate,
  WalletAggregate,
} from './aggregates';
import type { SplitInstruction } from './value-objects';

/**
 * Splits a successful payment into multiple transfer instructions
 * (platform fee, cook payout, tax, supplier payment). Pure domain
 * service — it computes the splits; the application layer executes
 * them via the payments connector.
 */
export interface PaymentSplitter {
  split(
    payment: PaymentAggregate,
    rules: ReadonlyArray<SplitRule>,
  ): Result<ReadonlyArray<SplitInstruction>, DomainError>;
}

/**
 * Rule used by {@link PaymentSplitter} to compute a single split.
 */
export interface SplitRule {
  readonly recipientId: UUID;
  readonly purpose: string;
  readonly kind: 'PERCENT' | 'FIXED' | 'RESIDUAL';
  readonly value: number;
}

/**
 * Settlement service: batches successful payments and creates
 * TransferAggregates for the payees at the end of each settlement
 * window. Implemented in the application layer.
 */
export interface SettlementService {
  settlePayment(
    payment: PaymentAggregate,
    splits: ReadonlyArray<SplitInstruction>,
    now: ISODateString,
  ): Promise<Result<ReadonlyArray<TransferAggregate>, DomainError>>;
  settleWallet(
    wallet: WalletAggregate,
    transfers: ReadonlyArray<TransferAggregate>,
  ): Promise<Result<void, DomainError>>;
}

/**
 * Reconciliation service: compares the local ledger against an
 * external statement (provided by the payments connector) and flags
 * discrepancies. Returns the list of unmatched references.
 */
export interface ReconciliationService {
  reconcile(
    walletId: UUID,
    statement: ReadonlyArray<{ reference: string; amount: Money; timestamp: ISODateString }>,
  ): Promise<Result<ReadonlyArray<string>, DomainError>>;
}
