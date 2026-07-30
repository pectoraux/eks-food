/**
 * @file contexts/organization/aggregates.ts
 * @package @eks-food/domain/contexts/organization
 *
 * Organization bounded context — aggregate root interfaces.
 *
 * Responsibility:
 *  - Declare the state shape and behaviour contracts for the
 *    `Organization`, `Tenant` and `Membership` aggregates.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { ISODateString, UUID } from '../../shared/value-objects';
import type {
  FeatureEntitlement,
  MembershipStatus,
  OrganizationAddress,
  OrganizationSlug,
  OrganizationStatus,
  PlanCode,
  TenantConfigOverride,
} from './value-objects';

/**
 * Aggregate root representing an Organisation on the platform. An
 * Organisation owns one or more Tenants and is the billing entity.
 */
export interface OrganizationAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'OrganizationAggregate';
  readonly parentOrganizationId: UUID | null;
  readonly slug: OrganizationSlug;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly plan: PlanCode;
  readonly address: OrganizationAddress | null;
  readonly entitlements: ReadonlyArray<FeatureEntitlement>;
  readonly createdAt: ISODateString;

  suspend(reason: string): Result<void, DomainError>;
  reactivate(): Result<void, DomainError>;
  terminate(): Result<void, DomainError>;
  upgradePlan(newPlan: PlanCode): Result<void, DomainError>;
  setEntitlement(feature: string, enabled: boolean, limit?: number): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Tenant inside an Organisation. A Tenant
 * is the unit of data isolation; most other contexts key their data by
 * `tenantId`.
 */
export interface TenantAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'TenantAggregate';
  readonly organizationId: UUID;
  readonly slug: OrganizationSlug;
  readonly displayName: string;
  readonly defaultCurrency: string;
  readonly defaultLocale: string;
  readonly config: ReadonlyArray<TenantConfigOverride>;

  setConfig(key: string, value: unknown, updatedBy: UUID, now: ISODateString): Result<void, DomainError>;
}

/**
 * Aggregate root representing a User's membership in a Tenant. Combines
 * a (tenantId, userId) pair with a roleId and lifecycle state.
 */
export interface MembershipAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'MembershipAggregate';
  readonly tenantId: UUID;
  readonly userId: UUID;
  readonly roleId: UUID;
  readonly status: MembershipStatus;
  readonly invitedAt: ISODateString;
  readonly activatedAt: ISODateString | null;
  readonly revokedAt: ISODateString | null;

  accept(now: ISODateString): Result<void, DomainError>;
  revoke(now: ISODateString): Result<void, DomainError>;
  changeRole(newRoleId: UUID, now: ISODateString): Result<void, DomainError>;
}
