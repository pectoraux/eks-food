/**
 * @file contexts/identity/repositories.ts
 * @package @eks-food/domain/contexts/identity
 *
 * Identity bounded context — repository interfaces (ports).
 *
 * Responsibility:
 *  - Declare the persistence contracts the application layer may use
 *    to load and store identity aggregates. Implementations live in
 *    the infrastructure layer (e.g. a Prisma adapter).
 *  - Provide paginated listing methods using the shared {@link Page}
 *    / {@link PagedResult} contracts.
 *
 * Constraints:
 *  - Interfaces only. Implementations must enforce optimistic
 *    concurrency via the aggregate `version` field.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  CredentialAggregate,
  PermissionAggregate,
  RoleAggregate,
  SessionAggregate,
  UserAggregate,
} from './aggregates';
import type { EmailAddress, Username } from './value-objects';

/**
 * Filter shape for `UserRepository.list`.
 */
export interface UserListFilter {
  readonly tenantId?: UUID;
  readonly status?: UserAggregate['status'];
  readonly roleIds?: ReadonlyArray<UUID>;
}

/**
 * Repository for {@link UserAggregate}.
 */
export interface UserRepository {
  findById(id: UUID): Promise<UserAggregate | null>;
  findByEmail(email: EmailAddress): Promise<UserAggregate | null>;
  findByUsername(username: Username): Promise<UserAggregate | null>;
  list(
    filter: UserListFilter,
    page: Page,
  ): Promise<PagedResult<UserAggregate>>;
  save(agg: UserAggregate): Promise<Result<void, DomainError>>;
  delete(id: UUID): Promise<Result<void, DomainError>>;
}

/**
 * Filter shape for `RoleRepository.list`.
 */
export interface RoleListFilter {
  readonly tenantId?: UUID | null;
  readonly system?: boolean;
}

/**
 * Repository for {@link RoleAggregate}.
 */
export interface RoleRepository {
  findById(id: UUID): Promise<RoleAggregate | null>;
  findBySlug(slug: RoleAggregate['slug']): Promise<RoleAggregate | null>;
  list(
    filter: RoleListFilter,
    page: Page,
  ): Promise<PagedResult<RoleAggregate>>;
  save(agg: RoleAggregate): Promise<Result<void, DomainError>>;
}

/**
 * Repository for {@link PermissionAggregate}.
 */
export interface PermissionRepository {
  findById(id: UUID): Promise<PermissionAggregate | null>;
  findByCode(code: PermissionAggregate['code']): Promise<PermissionAggregate | null>;
  list(page: Page): Promise<PagedResult<PermissionAggregate>>;
  save(agg: PermissionAggregate): Promise<Result<void, DomainError>>;
}

/**
 * Filter shape for `SessionRepository.list`.
 */
export interface SessionListFilter {
  readonly userId?: UUID;
  readonly status?: SessionAggregate['status'];
}

/**
 * Repository for {@link SessionAggregate}.
 */
export interface SessionRepository {
  findById(id: UUID): Promise<SessionAggregate | null>;
  findByRefreshToken(token: SessionAggregate['refreshToken']): Promise<SessionAggregate | null>;
  list(
    filter: SessionListFilter,
    page: Page,
  ): Promise<PagedResult<SessionAggregate>>;
  save(agg: SessionAggregate): Promise<Result<void, DomainError>>;
  revokeAllForUser(userId: UUID): Promise<Result<void, DomainError>>;
}

/**
 * Repository for {@link CredentialAggregate}.
 */
export interface CredentialRepository {
  findById(id: UUID): Promise<CredentialAggregate | null>;
  findByUserId(userId: UUID): Promise<CredentialAggregate | null>;
  save(agg: CredentialAggregate): Promise<Result<void, DomainError>>;
  delete(id: UUID): Promise<Result<void, DomainError>>;
}
