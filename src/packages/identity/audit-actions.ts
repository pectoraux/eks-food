/**
 * @file identity/audit-actions.ts
 * @package @eks/identity
 *
 * Identity audit action codes.
 *
 * Responsibility:
 *  - Define the canonical set of audit action codes emitted by the
 *    identity context. Every security-relevant identity operation
 *    (login, password change, role assignment, MFA toggle, account
 *    suspension, etc.) is recorded in the immutable audit log with
 *    one of these codes so analysts, SIEM integrations and compliance
 *    reports can pivot on a stable, enumerable vocabulary.
 *
 * Constraints:
 *  - Codes are uppercase SNAKE_CASE, distinct from the canonical
 *    domain event names (which are `{Aggregate}.{Verb}`) — audit
 *    actions capture the actor-side intent (e.g. `USER_LOGIN_FAILED`,
 *    which has no corresponding domain event because a failed login
 *    does not mutate an aggregate).
 *  - Codes are stable and append-only; never re-use a retired code.
 *  - No `any`, no runtime side effects — pure constant.
 */

/**
 * Canonical identity audit action codes. Append-only.
 *
 * The single source of truth for what gets written to the audit log's
 * `action` column whenever an identity operation occurs. Downstream
 * consumers (SIEM, compliance reports, anomaly detection) MUST
 * reference these constants rather than spelling out the literal
 * string.
 */
export const IDENTITY_AUDIT_ACTIONS = {
  // User lifecycle
  USER_REGISTERED: "USER_REGISTERED",
  USER_VERIFIED: "USER_VERIFIED",
  USER_LOGIN: "USER_LOGIN",
  USER_LOGIN_FAILED: "USER_LOGIN_FAILED",
  USER_LOGOUT: "USER_LOGOUT",
  USER_PROFILE_UPDATED: "USER_PROFILE_UPDATED",
  USER_EMAIL_CHANGED: "USER_EMAIL_CHANGED",

  // Session lifecycle
  SESSION_CREATED: "SESSION_CREATED",
  SESSION_REFRESHED: "SESSION_REFRESHED",
  SESSION_REVOKED: "SESSION_REVOKED",
  SESSION_EXPIRED: "SESSION_EXPIRED",

  // Password & MFA
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED",
  MFA_ENABLED: "MFA_ENABLED",
  MFA_DISABLED: "MFA_DISABLED",
  RECOVERY_CODES_GENERATED: "RECOVERY_CODES_GENERATED",
  RECOVERY_CODES_USED: "RECOVERY_CODES_USED",

  // Organization & membership
  ORGANIZATION_CREATED: "ORGANIZATION_CREATED",
  ORGANIZATION_UPDATED: "ORGANIZATION_UPDATED",
  ORGANIZATION_SUSPENDED: "ORGANIZATION_SUSPENDED",
  ORGANIZATION_DELETED: "ORGANIZATION_DELETED",
  MEMBERSHIP_ADDED: "MEMBERSHIP_ADDED",
  MEMBERSHIP_REMOVED: "MEMBERSHIP_REMOVED",

  // RBAC
  ROLE_ASSIGNED: "ROLE_ASSIGNED",
  ROLE_REVOKED: "ROLE_REVOKED",
  PERMISSION_GRANTED: "PERMISSION_GRANTED",
  PERMISSION_DENIED: "PERMISSION_DENIED",

  // Invitations
  INVITATION_CREATED: "INVITATION_CREATED",
  INVITATION_ACCEPTED: "INVITATION_ACCEPTED",
  INVITATION_REVOKED: "INVITATION_REVOKED",
  INVITATION_EXPIRED: "INVITATION_EXPIRED",

  // Account protection
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_UNLOCKED: "ACCOUNT_UNLOCKED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  ACCOUNT_DELETED: "ACCOUNT_DELETED",

  // Teams
  TEAM_CREATED: "TEAM_CREATED",
  TEAM_MEMBER_ADDED: "TEAM_MEMBER_ADDED",
  TEAM_MEMBER_REMOVED: "TEAM_MEMBER_REMOVED",

  // Verification
  VERIFICATION_REQUESTED: "VERIFICATION_REQUESTED",
  VERIFICATION_COMPLETED: "VERIFICATION_COMPLETED",

  // API credentials
  API_KEY_ISSUED: "API_KEY_ISSUED",
  API_KEY_REVOKED: "API_KEY_REVOKED",
} as const;

/** Union type of every identity audit action code. */
export type IdentityAuditAction =
  (typeof IDENTITY_AUDIT_ACTIONS)[keyof typeof IDENTITY_AUDIT_ACTIONS];
