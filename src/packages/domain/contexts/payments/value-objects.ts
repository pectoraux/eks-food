/**
 * @file contexts/payments/value-objects.ts
 * @package @eks-food/domain/contexts/payments
 *
 * Payments bounded context — value objects.
 *
 * NOTE: This file contains ONLY domain value objects. The Payswap
 * provider orchestration interface lives in the payments connector
 * package, not here.
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
 * Lifecycle states for a Payment.
 */
export type PaymentStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Lifecycle states for a Transfer (payout to a cook, vendor, supplier).
 */
export type TransferStatus =
  | 'SCHEDULED'
  | 'IN_TRANSIT'
  | 'COMPLETED'
  | 'FAILED'
  | 'REVERSED';

/**
 * Lifecycle states for a Refund.
 */
export type RefundStatus =
  | 'REQUESTED'
  | 'ISSUED'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';

/**
 * Lifecycle states for a Wallet.
 */
export type WalletStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

/**
 * Branded primitive representing a payment provider name, e.g.
 * `"payswap"` or `"stripe"`.
 */
export type PaymentProvider = string & { readonly __brand: 'PaymentProvider' };

/**
 * Branded primitive representing an opaque provider-side reference.
 */
export type ProviderReference = string & { readonly __brand: 'ProviderReference' };

/**
 * Branded primitive representing a payment method type, e.g. `"momo"`,
 * `"card"`, `"bank_transfer"`.
 */
export type PaymentMethod = string & { readonly __brand: 'PaymentMethod' };

/**
 * Ledger entry direction.
 */
export type LedgerDirection = 'DEBIT' | 'CREDIT';

/**
 * A single wallet ledger entry.
 */
export interface LedgerEntry {
  readonly id: UUID;
  readonly walletId: UUID;
  readonly direction: LedgerDirection;
  readonly amount: Money;
  readonly reference: string;
  readonly createdAt: ISODateString;
  readonly balanceAfter: Money;
}

/**
 * Split instruction for a multi-party payment (e.g. platform fee,
 * cook payout, tax).
 */
export interface SplitInstruction {
  readonly recipientId: UUID;
  readonly amount: Money;
  readonly purpose: string;
}
