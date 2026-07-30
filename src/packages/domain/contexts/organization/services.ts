/**
 * @file contexts/organization/services.ts
 * @package @eks-food/domain/contexts/organization
 *
 * Organization bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { UUID } from '../../shared/value-objects';
import type {
  MembershipAggregate,
  OrganizationAggregate,
  TenantAggregate,
} from './aggregates';
import type { FeatureEntitlement, PlanCode } from './value-objects';

/**
 * Evaluates whether an organisation's plan + entitlements permit a
 * given capability. Used by other contexts to gate features without
 * each re-implementing plan logic.
 */
export interface EntitlementService {
  isEntitled(
    organization: OrganizationAggregate,
    feature: string,
  ): boolean;
  evaluateLimit(
    organization: OrganizationAggregate,
    feature: string,
    currentUsage: number,
  ): Result<void, DomainError>;
  comparePlans(a: PlanCode, b: PlanCode): number;
}

/**
 * Provisions a new tenant under an organisation, including default
 * roles, feature flags and projection seeding events. The application
 * layer orchestrates the actual side-effects; this domain service
 * decides what should be created.
 */
export interface TenantProvisioningService {
  provision(
    organization: OrganizationAggregate,
    slug: string,
    displayName: string,
    defaultCurrency: string,
    defaultLocale: string,
    initialEntitlements: ReadonlyArray<FeatureEntitlement>,
  ): Promise<Result<TenantAggregate, DomainError>>;

  addMember(
    tenant: TenantAggregate,
    userId: UUID,
    roleId: UUID,
  ): Promise<Result<MembershipAggregate, DomainError>>;
}
