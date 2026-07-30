/**
 * @file contexts/payments/repositories.ts
 * @package @eks-food/domain/contexts/payments
 *
 * Payments bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  PaymentAggregate,
  RefundAggregate,
  TransferAggregate,
  WalletAggregate,
} from './aggregates';
import type {
  PaymentStatus,
  ProviderReference,
  TransferStatus,
} from './value-objects';

export interface PaymentListFilter {
  readonly tenantId?: UUID;
  readonly payerId?: UUID;
  readonly payeeId?: UUID;
  readonly status?: PaymentStatus;
  readonly from?: string;
  readonly to?: string;
}

export interface PaymentRepository {
  findById(id: UUID): Promise<PaymentAggregate | null>;
  findByProviderReference(ref: ProviderReference): Promise<PaymentAggregate | null>;
  list(filter: PaymentListFilter, page: Page): Promise<PagedResult<PaymentAggregate>>;
  save(agg: PaymentAggregate): Promise<Result<void, DomainError>>;
}

export interface TransferListFilter {
  readonly tenantId?: UUID;
  readonly recipientId?: UUID;
  readonly sourcePaymentId?: UUID;
  readonly status?: TransferStatus;
}

export interface TransferRepository {
  findById(id: UUID): Promise<TransferAggregate | null>;
  list(filter: TransferListFilter, page: Page): Promise<PagedResult<TransferAggregate>>;
  save(agg: TransferAggregate): Promise<Result<void, DomainError>>;
}

export interface RefundRepository {
  findById(id: UUID): Promise<RefundAggregate | null>;
  listByPayment(paymentId: UUID): Promise<ReadonlyArray<RefundAggregate>>;
  save(agg: RefundAggregate): Promise<Result<void, DomainError>>;
}

export interface WalletRepository {
  findById(id: UUID): Promise<WalletAggregate | null>;
  findByOwner(ownerId: UUID, currency: string): Promise<WalletAggregate | null>;
  save(agg: WalletAggregate): Promise<Result<void, DomainError>>;
}
