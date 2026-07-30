/**
 * @file contexts/identity/value-objects.ts
 * @package @eks-food/domain/contexts/identity
 *
 * Identity bounded context — value objects.
 *
 * Responsibility:
 *  - Define the small, immutable, side-effect-free value objects that
 *    describe identity-related concepts: usernames, hashed credentials,
 *    multi-factor secrets, tokens, permission scopes, role slugs.
 *  - Reuse shared kernel value objects (`EmailAddress`, `UUID`,
 *    `ISODateString`) wherever sensible.
 *
 * Constraints:
 *  - Pure TypeScript types and interfaces. No validation logic — the
 *    owning aggregate is responsible for invariant enforcement.
 */

// Re-export shared kernel value objects so consumers can import every
// identity-related type from this single module.
export type {
  EmailAddress,
  ISODateString,
} from '../../shared/value-objects';

import type { ISODateString } from '../../shared/value-objects';

/**
 * Branded primitive representing a unique, case-insensitive username.
 */
export type Username = string & { readonly __brand: 'Username' };

/**
 * Branded primitive representing a role slug, e.g. `"platform.admin"`.
 */
export type RoleSlug = string & { readonly __brand: 'RoleSlug' };

/**
 * Branded primitive representing a permission codename, e.g.
 * `"booking.cook.assign"`.
 */
export type PermissionCode = string & { readonly __brand: 'PermissionCode' };

/**
 * Branded primitive representing an opaque hashed password blob. The
 * accompanying {@link PasswordHashAlgorithm} records how it was
 * produced.
 */
export type HashedPassword = string & { readonly __brand: 'HashedPassword' };

/**
 * Branded primitive representing an opaque secret stored for
 * time-based one-time passwords (TOTP, RFC 6238).
 */
export type MfaSecret = string & { readonly __brand: 'MfaSecret' };

/**
 * Branded primitive representing an opaque opaque session or refresh
 * token. The domain treats tokens as opaque blobs; the application
 * layer is responsible for signing/verifying.
 */
export type OpaqueToken = string & { readonly __brand: 'OpaqueToken' };

/**
 * Hashing algorithm used to produce a {@link HashedPassword}. Stored
 * alongside the hash so legacy hashes can be migrated lazily on next
 * login.
 */
export type PasswordHashAlgorithm =
  | 'argon2id'
  | 'bcrypt'
  | 'scrypt'
  | 'pbkdf2';

/**
 * Compact description of a permission scope, used by the
 * authorization service to evaluate `can(actor, action, scope)`.
 */
export interface PermissionScope {
  readonly resource: string;
  readonly resourceId?: string;
  readonly tenantId?: string;
}

/**
 * A stored credential for a user. The `algorithm` and `hash` together
 * form an immutable record; rotation replaces the entire credential.
 */
export interface CredentialRecord {
  readonly algorithm: PasswordHashAlgorithm;
  readonly hash: HashedPassword;
  readonly mfaSecret: MfaSecret | null;
  readonly updatedAt: ISODateString;
}

/**
 * Identity of the principal that authenticated a session (password,
 * OTP, SSO, etc.).
 */
export type AuthenticationMethod =
  | 'password'
  | 'otp'
  | 'sso'
  | 'api_key'
  | 'impersonation';
