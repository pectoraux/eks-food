/**
 * @file contexts/organization/value-objects.ts
 * @package @eks-food/domain/contexts/organization
 *
 * Organization bounded context — value objects.
 *
 * Responsibility:
 *  - Describe tenant identity, slugs, member roles and feature
 *    entitlements that flow across the platform.
 */

// Re-export shared kernel value objects for single-source ergonomics.
export type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';

import type { ISODateString, UUID } from '../../shared/value-objects';

/**
 * Branded primitive representing a URL-friendly organisation slug.
 */
export type OrganizationSlug = string & { readonly __brand: 'OrganizationSlug' };

/**
 * Lifecycle states for an Organisation / tenant.
 */
export type OrganizationStatus =
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'TERMINATED';

/**
 * Lifecycle states for a Membership.
 */
export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'REVOKED';

/**
 * Branded primitive representing a plan code, e.g. `"eks.starter"`.
 */
export type PlanCode = string & { readonly __brand: 'PlanCode' };

/**
 * Per-tenant feature entitlement. Stored on the Organisation so the
 * platform can gate capabilities without per-context DB lookups.
 */
export interface FeatureEntitlement {
  readonly feature: string;
  readonly enabled: boolean;
  readonly limit?: number;
}

/**
 * Address attached to an organisation (HQ, branch, billing, etc.).
 */
export interface OrganizationAddress {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly country: string;
  readonly postalCode?: string;
}

/**
 * A tenant-scoped configuration override applied to the global default.
 */
export interface TenantConfigOverride {
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: ISODateString;
  readonly updatedBy: UUID;
}
