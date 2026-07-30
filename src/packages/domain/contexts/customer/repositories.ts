/**
 * @file contexts/customer/repositories.ts
 * @package @eks-food/domain/contexts/customer
 *
 * Customer bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  EmailAddress,
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  AddressAggregate,
  CustomerAggregate,
} from './aggregates';
import type { CustomerStatus } from './value-objects';

export interface CustomerListFilter {
  readonly tenantId?: UUID;
  readonly userId?: UUID;
  readonly status?: CustomerStatus;
}

export interface CustomerRepository {
  findById(id: UUID): Promise<CustomerAggregate | null>;
  findByUserId(userId: UUID): Promise<CustomerAggregate | null>;
  findByEmail(email: EmailAddress): Promise<CustomerAggregate | null>;
  list(
    filter: CustomerListFilter,
    page: Page,
  ): Promise<PagedResult<CustomerAggregate>>;
  save(agg: CustomerAggregate): Promise<Result<void, DomainError>>;
  delete(id: UUID): Promise<Result<void, DomainError>>;
}

export interface AddressRepository {
  findById(id: UUID): Promise<AddressAggregate | null>;
  listByCustomer(customerId: UUID): Promise<ReadonlyArray<AddressAggregate>>;
  save(agg: AddressAggregate): Promise<Result<void, DomainError>>;
  delete(id: UUID): Promise<Result<void, DomainError>>;
}
