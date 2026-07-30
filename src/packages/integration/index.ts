/**
 * @eks/integration — Universal Connector Platform & Enterprise Integration Infrastructure.
 *
 * The integration layer through which all external systems communicate with
 * Eks-Food. Provider-agnostic, isolated, auditable, resilient. Components:
 *  - Connector Runtime (lifecycle, isolation, hot reload, health)
 *  - Authentication Framework (API Key, OAuth2, JWT, Bearer, Basic, mTLS, Signed, Custom)
 *  - Synchronization Engine (full, incremental, delta, bidirectional + checkpoints)
 *  - Scheduling Engine (cron, interval, manual, event-triggered, maintenance windows)
 *  - Webhook Platform (registration, verification, retries, signatures, DLQ)
 *  - Polling Engine (intervals, adaptive, backoff, batching, pagination, checkpointing)
 *  - Data Mapping Engine (field mapping, transformations, validation, enrichment)
 *  - Schema Registry (versioning, compatibility, evolution, rollback)
 *  - Transformation Engine (JSON, XML, CSV, calculated fields, lookup tables, conditionals)
 *  - Retry Engine (exponential backoff, jitter, budgets, circuit breakers, fallbacks)
 *  - Rate Limiting (per connector/provider/tenant/credential, burst, concurrency, adaptive)
 *  - Health Monitoring (latency, availability, sync lag, error rates, throughput)
 *  - Secret Management (encrypted, rotation, scoped access, auditing)
 *  - Version Management (semver, upgrades, downgrades, migration, compatibility)
 */

// Domain events + audit actions (from subagent)
export { INTEGRATION_EVENTS, type IntegrationEvent, type IntegrationEventMeta, buildIntegrationEvent } from "./events";
export { INTEGRATION_AUDIT_ACTIONS, type IntegrationAuditAction } from "./audit-actions";

// Auth framework
export { AuthProvider, type AuthContext, type AuthCredentials, type AuthResult } from "./auth";

// Synchronization engine
export { SyncEngine, type SyncMode, type SyncResult, type SyncCheckpoint } from "./sync";

// Webhook platform
export { WebhookPlatform, type WebhookEndpoint, type WebhookDeliveryResult, verifyWebhookSignature } from "./webhooks";

// Polling engine
export { PollingEngine, type PollConfig, type PollResult } from "./polling";

// Data mapping + transformation
export { MappingEngine, type MappingRule } from "./mapping";
export { TransformationEngine, type TransformConfig } from "./transformation";

// Schema registry
export { SchemaRegistry, type SchemaCompat } from "./schema-registry";

// Retry + rate limiting
export { RetryEngine, type RetryPolicyConfig } from "./retry";
export { RateLimiter, type RateLimitConfig } from "./rate-limiter";

// Health monitoring
export { HealthMonitor, type HealthStatus, type HealthReport } from "./health";

// Connector runtime
export { ConnectorRuntime, type ConnectorInstance, type ConnectorHealthStatus } from "./runtime";

// Scheduling
export { Scheduler, type ScheduleConfig, type ScheduleType } from "./scheduler";
