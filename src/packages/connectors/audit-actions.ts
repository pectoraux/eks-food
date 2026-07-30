/**
 * @file connectors/audit-actions.ts
 * @package @eks/connectors
 *
 * Production Connector audit action codes.
 *
 * Responsibility:
 *  - Define the canonical set of audit action codes emitted by the
 *    production connector layer. Every security- and
 *    operations-relevant connector action (provider registration,
 *    activation, deactivation, health changes, failover, provider
 *    selection, sync lifecycle, domain-specific connector operations
 *    across calendar/weather/maps/procurement/restaurant/merchant/
 *    government/notifications/communications/identity providers, cache
 *    invalidation, rate limiting, credential access/rotation, circuit
 *    breaker state transitions, connector version publishing) is
 *    recorded in the immutable audit log with one of these codes so
 *    analysts, SIEM integrations and compliance reports can pivot on a
 *    stable, enumerable vocabulary.
 *
 * Constraints:
 *  - Codes are uppercase SNAKE_CASE, distinct from the canonical
 *    domain event names (which are `{Aggregate}.{Verb}`) — audit
 *    actions capture the actor-side intent AND the negative outcomes
 *    that never mutate an aggregate (e.g. `SYNC_FAILED`,
 *    `NOTIFICATION_FAILED`, `COMMUNICATION_FAILED`,
 *    `RATE_LIMIT_TRIGGERED`, `CIRCUIT_BREAKER_OPENED`).
 *  - Codes are stable and append-only; never re-use a retired code.
 *  - No `any`, no runtime side effects — pure constant.
 */

/**
 * Canonical connector audit action codes. Append-only.
 *
 * The single source of truth for what gets written to the audit log's
 * `action` column whenever a connector operation occurs. Downstream
 * consumers (SIEM, compliance reports, anomaly detection) MUST
 * reference these constants rather than spelling out the literal
 * string.
 */
export const CONNECTOR_AUDIT_ACTIONS = {
  // Provider lifecycle
  PROVIDER_REGISTERED: "PROVIDER_REGISTERED",
  PROVIDER_ACTIVATED: "PROVIDER_ACTIVATED",
  PROVIDER_DEACTIVATED: "PROVIDER_DEACTIVATED",
  PROVIDER_HEALTH_CHANGED: "PROVIDER_HEALTH_CHANGED",
  PROVIDER_FAILOVER_TRIGGERED: "PROVIDER_FAILOVER_TRIGGERED",
  PROVIDER_SELECTED: "PROVIDER_SELECTED",

  // Synchronization lifecycle
  SYNC_STARTED: "SYNC_STARTED",
  SYNC_COMPLETED: "SYNC_COMPLETED",
  SYNC_FAILED: "SYNC_FAILED",

  // Calendar
  CALENDAR_SYNCED: "CALENDAR_SYNCED",

  // Weather
  WEATHER_UPDATED: "WEATHER_UPDATED",
  WEATHER_ALERT_RECEIVED: "WEATHER_ALERT_RECEIVED",

  // Maps
  ROUTE_CALCULATED: "ROUTE_CALCULATED",
  GEOCODING_RESOLVED: "GEOCODING_RESOLVED",
  PLACE_LOOKUP_COMPLETED: "PLACE_LOOKUP_COMPLETED",

  // Procurement
  PROCUREMENT_CATALOG_UPDATED: "PROCUREMENT_CATALOG_UPDATED",
  PROCUREMENT_ORDER_PLACED: "PROCUREMENT_ORDER_PLACED",

  // Restaurant
  RESTAURANT_MENU_UPDATED: "RESTAURANT_MENU_UPDATED",
  RESTAURANT_RESERVATION_SYNCED: "RESTAURANT_RESERVATION_SYNCED",

  // Merchant
  MERCHANT_CONTRACT_IMPORTED: "MERCHANT_CONTRACT_IMPORTED",
  MERCHANT_ORDER_CREATED: "MERCHANT_ORDER_CREATED",

  // Government
  GOVERNMENT_VERIFICATION_COMPLETED: "GOVERNMENT_VERIFICATION_COMPLETED",
  GOVERNMENT_LICENSE_VERIFIED: "GOVERNMENT_LICENSE_VERIFIED",

  // Notifications
  NOTIFICATION_SENT: "NOTIFICATION_SENT",
  NOTIFICATION_FAILED: "NOTIFICATION_FAILED",

  // Communications
  COMMUNICATION_DELIVERED: "COMMUNICATION_DELIVERED",
  COMMUNICATION_FAILED: "COMMUNICATION_FAILED",

  // Identity providers
  IDENTITY_PROVIDER_LINKED: "IDENTITY_PROVIDER_LINKED",
  IDENTITY_PROVIDER_UNLINKED: "IDENTITY_PROVIDER_UNLINKED",

  // Cache
  CACHE_INVALIDATED: "CACHE_INVALIDATED",

  // Resilience
  RATE_LIMIT_TRIGGERED: "RATE_LIMIT_TRIGGERED",

  // Credentials
  CREDENTIAL_ACCESSED: "CREDENTIAL_ACCESSED",
  CREDENTIAL_ROTATED: "CREDENTIAL_ROTATED",

  // Circuit breaker
  CIRCUIT_BREAKER_OPENED: "CIRCUIT_BREAKER_OPENED",

  // Registry
  CONNECTOR_VERSION_PUBLISHED: "CONNECTOR_VERSION_PUBLISHED",
} as const;

/** Union type of every connector audit action code. */
export type ConnectorAuditAction =
  (typeof CONNECTOR_AUDIT_ACTIONS)[keyof typeof CONNECTOR_AUDIT_ACTIONS];
