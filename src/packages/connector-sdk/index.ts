/**
 * @eks/connector-sdk — the framework that future connectors will use.
 *
 * A Connector is an adapter between Eks-Food and an external system (Payswap,
 * Google Sheets, a government API, etc.). The SDK provides the plumbing —
 * authentication, polling, webhooks, retries, pagination, incremental sync,
 * conflict detection, batching, rate limiting, circuit breakers, schema
 * mapping, and health checks — so connector authors only implement the
 * system-specific logic.
 *
 * No business connectors yet — those arrive in M4.
 */
export type { Connector, ConnectorContext, ConnectorConfig, SyncResult, PollResult, WebhookResult, HealthCheckResult, SchemaMapping } from "./types";
export { ConnectorRunner, type ConnectorRunnerOptions } from "./runner";
export { buildPagination, type PaginationStrategy, type CursorPagination, type OffsetPagination, type PagePagination } from "./pagination";
export { mapSchema, type SchemaMappingRule } from "./schema-mapper";
export { CONN_ERRORS } from "./errors";
