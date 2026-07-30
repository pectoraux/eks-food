/**
 * @file integration/audit-actions.ts
 * @package @eks/integration
 *
 * Universal Connector Platform & Enterprise Integration audit action
 * codes.
 *
 * Responsibility:
 *  - Define the canonical set of audit action codes emitted by the
 *    integration platform. Every security-relevant integration
 *    operation (connector install/activate/deactivate/remove/upgrade,
 *    connector execution, sync lifecycle, webhook delivery/replay,
 *    polling, schema/mapping validation, transformation, retry,
 *    rate limiting, health check, credential rotation/access, sandbox
 *    violation) is recorded in the immutable audit log with one of
 *    these codes so analysts, SIEM integrations and compliance reports
 *    can pivot on a stable, enumerable vocabulary.
 *
 * Constraints:
 *  - Codes are uppercase SNAKE_CASE, distinct from the canonical
 *    domain event names (which are `{Aggregate}.{Verb}`) — audit
 *    actions capture the actor-side intent AND the negative outcomes
 *    that never mutate an aggregate (e.g. `SYNC_FAILED`,
 *    `WEBHOOK_DELIVERY_FAILED`, `POLLING_FAILED`, `RETRY_EXHAUSTED`,
 *    `RATE_LIMITED`, `HEALTH_CHECK_FAILED`, `SANDBOX_VIOLATION`).
 *  - Codes are stable and append-only; never re-use a retired code.
 *  - No `any`, no runtime side effects — pure constant.
 */

/**
 * Canonical integration-platform audit action codes. Append-only.
 *
 * The single source of truth for what gets written to the audit log's
 * `action` column whenever an integration operation occurs. Downstream
 * consumers (SIEM, compliance reports, anomaly detection) MUST
 * reference these constants rather than spelling out the literal
 * string.
 */
export const INTEGRATION_AUDIT_ACTIONS = {
  // Connector lifecycle
  CONNECTOR_INSTALLED: "CONNECTOR_INSTALLED",
  CONNECTOR_ACTIVATED: "CONNECTOR_ACTIVATED",
  CONNECTOR_DEACTIVATED: "CONNECTOR_DEACTIVATED",
  CONNECTOR_REMOVED: "CONNECTOR_REMOVED",
  CONNECTOR_UPGRADED: "CONNECTOR_UPGRADED",

  // Connector execution
  CONNECTOR_EXECUTION_STARTED: "CONNECTOR_EXECUTION_STARTED",
  CONNECTOR_EXECUTION_COMPLETED: "CONNECTOR_EXECUTION_COMPLETED",
  CONNECTOR_EXECUTION_FAILED: "CONNECTOR_EXECUTION_FAILED",

  // Synchronization lifecycle
  SYNC_STARTED: "SYNC_STARTED",
  SYNC_COMPLETED: "SYNC_COMPLETED",
  SYNC_FAILED: "SYNC_FAILED",
  SYNC_RESUMED: "SYNC_RESUMED",
  SYNC_PAUSED: "SYNC_PAUSED",

  // Webhook delivery
  WEBHOOK_RECEIVED: "WEBHOOK_RECEIVED",
  WEBHOOK_DELIVERED: "WEBHOOK_DELIVERED",
  WEBHOOK_DELIVERY_FAILED: "WEBHOOK_DELIVERY_FAILED",
  WEBHOOK_REPLAYED: "WEBHOOK_REPLAYED",

  // Polling
  POLLING_EXECUTED: "POLLING_EXECUTED",
  POLLING_FAILED: "POLLING_FAILED",

  // Schema registry & mapping
  SCHEMA_UPDATED: "SCHEMA_UPDATED",
  SCHEMA_VALIDATED: "SCHEMA_VALIDATED",
  MAPPING_VALIDATED: "MAPPING_VALIDATED",
  TRANSFORMATION_APPLIED: "TRANSFORMATION_APPLIED",

  // Retry & rate limiting
  RETRY_TRIGGERED: "RETRY_TRIGGERED",
  RETRY_EXHAUSTED: "RETRY_EXHAUSTED",
  RATE_LIMITED: "RATE_LIMITED",

  // Health
  HEALTH_CHECK_FAILED: "HEALTH_CHECK_FAILED",

  // Credentials
  CREDENTIAL_ROTATED: "CREDENTIAL_ROTATED",
  CREDENTIAL_ACCESSED: "CREDENTIAL_ACCESSED",

  // Sandbox & isolation
  SANDBOX_VIOLATION: "SANDBOX_VIOLATION",
} as const;

/** Union type of every integration-platform audit action code. */
export type IntegrationAuditAction =
  (typeof INTEGRATION_AUDIT_ACTIONS)[keyof typeof INTEGRATION_AUDIT_ACTIONS];
