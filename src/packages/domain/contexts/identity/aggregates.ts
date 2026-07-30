/**
 * @file contexts/identity/aggregates.ts
 * @package @eks-food/domain/contexts/identity
 *
 * Identity bounded context — aggregate root interfaces.
 *
 * Responsibility:
 *  - Declare the state shape and behaviour contracts for the five
 *    aggregate roots owned by the identity context: `User`, `Role`,
 *    `Permission`, `Session`, `Credential`.
 *  - Behaviour contracts are method signatures that return
 *    `Result<T, DomainError>`; the domain layer never throws.
 *
 * Constraints:
 *  - Interfaces only — no implementation, no invariants enforced here.
 *  - State fields are `readonly`; mutators return new aggregates in
 *    real implementations but the contract merely declares the
 *    method signature.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type {
  DomainError,
  UnauthorizedError,
} from '../../shared/errors';
import type {
  EmailAddress,
  ISODateString,
  UUID,
  Version,
} from '../../shared/value-objects';
import type {
  AuthenticationMethod,
  CredentialRecord,
  HashedPassword,
  MfaSecret,
  OpaqueToken,
  PasswordHashAlgorithm,
  PermissionCode,
  PermissionScope,
  RoleSlug,
  Username,
} from './value-objects';

/**
 * Lifecycle states for a User aggregate.
 */
export type UserStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

/**
 * Aggregate root representing a person or service principal that can
 * authenticate against the platform. A User belongs to exactly one
 * Tenant (organisation) and is granted zero or more Roles.
 */
export interface UserAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'UserAggregate';
  readonly tenantId: UUID;
  readonly email: EmailAddress;
  readonly username: Username;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly roleIds: ReadonlyArray<UUID>;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;

  activate(): Result<void, DomainError>;
  suspend(reason: string): Result<void, DomainError>;
  reactivate(): Result<void, DomainError>;
  deactivate(): Result<void, DomainError>;
  grantRole(roleId: UUID, grantedBy: UUID): Result<void, DomainError>;
  revokeRole(roleId: UUID, revokedBy: UUID): Result<void, DomainError>;
}

/**
 * Aggregate root representing a named bundle of permissions that can
 * be granted to many Users (e.g. `"platform.cook"`).
 */
export interface RoleAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'RoleAggregate';
  readonly tenantId: UUID | null;
  readonly slug: RoleSlug;
  readonly displayName: string;
  readonly permissionCodes: ReadonlyArray<PermissionCode>;
  readonly system: boolean;

  addPermission(code: PermissionCode): Result<void, DomainError>;
  removePermission(code: PermissionCode): Result<void, DomainError>;
}

/**
 * Aggregate root representing an atomic permission codename that can
 * be referenced by Roles. Permissions are platform-wide and immutable
 * once declared.
 */
export interface PermissionAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'PermissionAggregate';
  readonly code: PermissionCode;
  readonly description: string;
  readonly deprecated: boolean;
}

/**
 * Lifecycle states for a Session aggregate.
 */
export type SessionStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/**
 * Aggregate root representing an authenticated session for a User.
 * Sessions are short-lived and revocable; the application layer issues
 * opaque tokens that point at the session.
 */
export interface SessionAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'SessionAggregate';
  readonly userId: UUID;
  readonly status: SessionStatus;
  readonly method: AuthenticationMethod;
  readonly issuedAt: ISODateString;
  readonly expiresAt: ISODateString;
  readonly revokedAt: ISODateString | null;
  readonly refreshToken: OpaqueToken | null;

  revoke(reason: string): Result<void, DomainError>;
  refresh(newExpiresAt: ISODateString): Result<void, DomainError>;
}

/**
 * Aggregate root representing the secret material a User authenticates
 * with. Stored separately from User so credentials can be rotated
 * without touching the User aggregate.
 */
export interface CredentialAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'CredentialAggregate';
  readonly userId: UUID;
  readonly current: CredentialRecord;
  readonly previous: CredentialRecord | null;
  readonly mfaEnabled: boolean;

  rotate(
    algorithm: PasswordHashAlgorithm,
    newHash: HashedPassword,
    rotatedAt: ISODateString,
  ): Result<void, DomainError>;
  enableMfa(secret: MfaSecret): Result<void, DomainError>;
  disableMfa(): Result<void, DomainError>;
}

/**
 * Input shape for an authorization decision. The domain service
 * {@link AuthorizationService} consumes this and returns a boolean.
 */
export interface AuthorizationRequest {
  readonly actorId: UUID;
  readonly action: string;
  readonly scope: PermissionScope;
}

export type AuthorizationDecision = Readonly<
  | { readonly authorized: true; readonly matchedPermissions: ReadonlyArray<PermissionCode> }
  | { readonly authorized: false; readonly reason: string }
>;

export type { UnauthorizedError };
