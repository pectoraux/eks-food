/**
 * @file contexts/customer/services.ts
 * @package @eks-food/domain/contexts/customer
 *
 * Customer bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { UUID } from '../../shared/value-objects';
import type { CustomerAggregate } from './aggregates';
import type { CustomerFoodProfile } from './value-objects';

/**
 * Builds and refreshes the derived {@link CustomerFoodProfile} from
 * past bookings, reviews and explicit preferences. The application
 * layer triggers a rebuild on relevant events.
 */
export interface CustomerProfileService {
  rebuild(customerId: UUID): Promise<Result<CustomerFoodProfile, DomainError>>;
  mergeExplicit(
    current: CustomerFoodProfile | null,
    patch: Partial<CustomerFoodProfile>,
  ): Result<CustomerFoodProfile, DomainError>;
}

/**
 * Resolves the canonical customer for a given actor in a tenant,
 * creating a stub on first touch. Used by the booking context when a
 * guest checks out.
 */
export interface CustomerResolutionService {
  resolveOrCreate(
    tenantId: UUID,
    userId: UUID,
    displayName: string,
    email: string,
  ): Promise<Result<CustomerAggregate, DomainError>>;
}
