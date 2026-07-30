/**
 * @file contexts/organization/repositories.ts
 * @package @eks-food/domain/contexts/organization
 *
 * Organization bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { Page, PagedResult, UUID } from '../../shared/value-objects';
import type {
  MembershipAggregate,
  OrganizationAggregate,
  TenantAggregate,
} from './aggregates';
import type { OrganizationSlug } from './value-objects';

export interface OrganizationListFilter {
  readonly parentOrganizationId?: UUID | null;
  readonly status?: OrganizationAggregate['status'];
}

export interface OrganizationRepository {
  findById(id: UUID): Promise<OrganizationAggregate | null>;
  findBySlug(slug: OrganizationSlug): Promise<OrganizationAggregate | null>;
  list(
    filter: OrganizationListFilter,
    page: Page,
  ): Promise<PagedResult<OrganizationAggregate>>;
  save(agg: OrganizationAggregate): Promise<Result<void, DomainError>>;
}

export interface TenantListFilter {
  readonly organizationId?: UUID;
}

export interface TenantRepository {
  findById(id: UUID): Promise<TenantAggregate | null>;
  findBySlug(slug: OrganizationSlug): Promise<TenantAggregate | null>;
  list(filter: TenantListFilter, page: Page): Promise<PagedResult<TenantAggregate>>;
  save(agg: TenantAggregate): Promise<Result<void, DomainError>>;
}

export interface MembershipListFilter {
  readonly tenantId?: UUID;
  readonly userId?: UUID;
  readonly status?: MembershipAggregate['status'];
}

export interface MembershipRepository {
  findById(id: UUID): Promise<MembershipAggregate | null>;
  findByTenantAndUser(tenantId: UUID, userId: UUID): Promise<MembershipAggregate | null>;
  list(
    filter: MembershipListFilter,
    page: Page,
  ): Promise<PagedResult<MembershipAggregate>>;
  save(agg: MembershipAggregate): Promise<Result<void, DomainError>>;
  revokeAllForUser(userId: UUID): Promise<Result<void, DomainError>>;
}
