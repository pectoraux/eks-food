/**
 * @file developer/audit-actions.ts
 * @package @eks/developer
 *
 * Developer Platform audit action codes.
 *
 * Responsibility:
 *  - Define the canonical set of audit action codes emitted by the
 *    developer platform. Every security-relevant developer operation
 *    (extension install/activate/suspend/remove, connector execution,
 *    workflow start/complete/fail, manifest validation, package
 *    publishing, secret rotation, permission grant/deny, sandbox
 *    violation) is recorded in the immutable audit log with one of
 *    these codes so analysts, SIEM integrations and compliance reports
 *    can pivot on a stable, enumerable vocabulary.
 *
 * Constraints:
 *  - Codes are uppercase SNAKE_CASE, distinct from the canonical
 *    domain event names (which are `{Aggregate}.{Verb}`) — audit
 *    actions capture the actor-side intent and the negative outcomes
 *    that never mutate an aggregate (e.g. `CONNECTOR_FAILED`,
 *    `MANIFEST_VALIDATION_FAILED`, `PERMISSION_DENIED`,
 *    `SANDBOX_VIOLATION`).
 *  - Codes are stable and append-only; never re-use a retired code.
 *  - No `any`, no runtime side effects — pure constant.
 */

/**
 * Canonical developer-platform audit action codes. Append-only.
 *
 * The single source of truth for what gets written to the audit log's
 * `action` column whenever a developer operation occurs. Downstream
 * consumers (SIEM, compliance reports, anomaly detection) MUST
 * reference these constants rather than spelling out the literal
 * string.
 */
export const DEVELOPER_AUDIT_ACTIONS = {
  // Extension lifecycle
  EXTENSION_INSTALLED: "EXTENSION_INSTALLED",
  EXTENSION_ACTIVATED: "EXTENSION_ACTIVATED",
  EXTENSION_SUSPENDED: "EXTENSION_SUSPENDED",
  EXTENSION_REMOVED: "EXTENSION_REMOVED",
  EXTENSION_UPGRADED: "EXTENSION_UPGRADED",
  EXTENSION_ROLLED_BACK: "EXTENSION_ROLLED_BACK",
  EXTENSION_HEALTH_CHECK: "EXTENSION_HEALTH_CHECK",
  EXTENSION_LOG_EMITTED: "EXTENSION_LOG_EMITTED",

  // Connector lifecycle
  CONNECTOR_EXECUTED: "CONNECTOR_EXECUTED",
  CONNECTOR_FAILED: "CONNECTOR_FAILED",

  // Workflow lifecycle
  WORKFLOW_STARTED: "WORKFLOW_STARTED",
  WORKFLOW_COMPLETED: "WORKFLOW_COMPLETED",
  WORKFLOW_FAILED: "WORKFLOW_FAILED",

  // Eventing infrastructure
  EVENT_REPLAYED: "EVENT_REPLAYED",

  // Manifest validation
  MANIFEST_VALIDATED: "MANIFEST_VALIDATED",
  MANIFEST_VALIDATION_FAILED: "MANIFEST_VALIDATION_FAILED",

  // Package publishing
  PACKAGE_PUBLISHED: "PACKAGE_PUBLISHED",
  PACKAGE_SIGNATURE_VERIFIED: "PACKAGE_SIGNATURE_VERIFIED",

  // Secrets
  SECRET_CREATED: "SECRET_CREATED",
  SECRET_ROTATED: "SECRET_ROTATED",
  SECRET_ACCESSED: "SECRET_ACCESSED",

  // Permissions
  PERMISSION_GRANTED: "PERMISSION_GRANTED",
  PERMISSION_DENIED: "PERMISSION_DENIED",

  // Publisher trust
  PUBLISHER_VERIFIED: "PUBLISHER_VERIFIED",

  // Sandbox & isolation
  SANDBOX_VIOLATION: "SANDBOX_VIOLATION",
} as const;

/** Union type of every developer-platform audit action code. */
export type DeveloperAuditAction =
  (typeof DEVELOPER_AUDIT_ACTIONS)[keyof typeof DEVELOPER_AUDIT_ACTIONS];
