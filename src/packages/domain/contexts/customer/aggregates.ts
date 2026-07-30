/**
 * @file contexts/customer/aggregates.ts
 * @package @eks-food/domain/contexts/customer
 *
 * Customer bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  EmailAddress,
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  CustomerAddress,
  CustomerFoodProfile,
  CustomerPreference,
  CustomerStatus,
  DietaryRestriction,
  PhoneNumber,
} from './value-objects';

/**
 * Aggregate root representing the customer-facing persona of a platform
 * user. A customer belongs to exactly one Tenant and may have many
 * Addresses and Preferences.
 */
export interface CustomerAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'CustomerAggregate';
  readonly tenantId: UUID;
  readonly userId: UUID;
  readonly displayName: string;
  readonly email: EmailAddress;
  readonly phone: PhoneNumber | null;
  readonly status: CustomerStatus;
  readonly addresses: ReadonlyArray<CustomerAddress>;
  readonly preferences: ReadonlyArray<CustomerPreference>;
  readonly foodProfile: CustomerFoodProfile | null;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;

  addAddress(address: CustomerAddress): Result<void, DomainError>;
  removeAddress(label: string): Result<void, DomainError>;
  setDefaultAddress(label: string): Result<void, DomainError>;
  setPreference(key: string, value: unknown, now: ISODateString): Result<void, DomainError>;
  updateFoodProfile(patch: Partial<CustomerFoodProfile>): Result<void, DomainError>;
  addDietaryRestriction(restriction: DietaryRestriction): Result<void, DomainError>;
  suspend(reason: string): Result<void, DomainError>;
  reactivate(): Result<void, DomainError>;
}

/**
 * Aggregate root representing an Address as a first-class entity (so it
 * can be referenced from bookings and deliveries without duplication).
 * Most operations go through the Customer aggregate; this interface is
 * for direct repository access in queries.
 */
export interface AddressAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'AddressAggregate';
  readonly customerId: UUID;
  readonly label: string;
  readonly isDefault: boolean;
}
