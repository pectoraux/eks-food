# Eks-Food Universal Connector Platform — Architecture

> **Audience:** Platform engineers, integration architects, on-call maintainers. Read alongside `docs/developer/CONNECTOR_SDK_GUIDE.md` (the underlying `@eks/connector-sdk` contract), `docs/identity/ARCHITECTURE.md` (M2 IAM), `docs/developer/ARCHITECTURE.md` (M3 developer platform), and the sibling docs in this folder: `CONNECTOR_DEVELOPMENT.md`, `AUTHENTICATION_GUIDE.md`, `SYNCHRONIZATION_GUIDE.md`, `WEBHOOK_GUIDE.md`, `SCHEMA_REGISTRY_GUIDE.md`, `TRANSFORMATION_GUIDE.md`, `OPERATIONS_RUNBOOK.md`, `DISASTER_RECOVERY.md`.
>
> **Status:** Milestone 4 — the Universal Connector Platform & Enterprise Integration Infrastructure. This document describes the **target M4 architecture**: the `@eks/integration` package (a layer above the M3 `@eks/connector-sdk`), the extended Prisma schema (`Connector`, `ConnectorVersion`, `ConnectorCredential`, `ConnectorConfiguration`, `ConnectorExecution`, `ConnectorHealth`, `ConnectorSchedule`, `SynchronizationJob`, `SynchronizationCheckpoint`, `WebhookEndpoint`, `WebhookDelivery`, `PollingJob`, `MappingTemplate`, `TransformationRule`, `SchemaDefinition`, `SchemaVersion`, `RetryPolicy`, `RateLimitPolicy`, `SecretReference`), and the `/api/v1/integrations/*` route surface. It builds on the M1 foundation (`@eks/common`, `@eks/events`, `@eks/observability`, `@eks/cache`, `@eks/security`, `@eks/api`, `@eks/workers`), the M2 IAM stack (`@eks/auth`, `@eks/authorization`, `@eks/organizations`), and the M3 developer platform (`@eks/sdk`, `@eks/connector-sdk`, `@eks/runtime`, `@eks/registry`, `@eks/workflow`).

---

## 1. Goals & Non-Goals

### Goals
- Make Eks-Food integrate with **any** external system a cook, supplier, restaurant, or operator might use: POS terminals, ERP/accounting suites (SAP, Oracle, Xero), fleet & delivery platforms, food-safety labs, government permit systems, payment providers (Payswap, Stripe, MoMo), e-commerce marketplaces, Google Sheets, CSV/SFTP drops, message queues (Kafka, SQS, RabbitMQ), and database replication feeds.
- Make every integration a **first-class connector** with a uniform lifecycle (install → activate → sync → deactivate → remove), uniform observability (health, executions, sync lag, webhook delivery), and uniform security (encrypted credentials, scoped secrets, audit on every privileged action).
- Make the platform scale to **tens of thousands of concurrent connectors** across all tenants without per-connector processes, per-connector databases, or per-connector secrets sprawl. Scheduling is centralised, state is database-backed, and execution is burst-tolerant.
- Make connector authoring **mechanical**: a connector author implements the `Connector` interface from `@eks/connector-sdk` and gets retry, circuit-breaking, rate-limiting, pagination, cursors, schema mapping, transformation, and dead-letter handling for free from `@eks/integration`.
- Make the platform **operationally debuggable**: every execution is a `ConnectorExecution` row; every sync is a `SynchronizationJob` with `SynchronizationCheckpoint` rows; every webhook delivery is a `WebhookDelivery` row; every polling pass is a `PollingJob` row. The ops dashboard is a query against these tables.

### Non-Goals
- A **low-code connector builder UI**. The M4 platform is code-first; the visual builder is M5. Operators configure existing connectors via the manifest's `configurationSchema`; they do not author new connectors from the UI.
- **Real-time streaming** at sub-second latency. The M4 sync engine targets minutes-to-hours cadence (with webhook fast-path for sub-minute latency where the source supports it). Kafka-to-Kafka streaming with exactly-once semantics is M5.
- **Cross-tenant connector sharing**. A `ConnectorConfiguration` is scoped to one `organizationId`. The platform can ship curated connectors (publisher `kind = "platform"`) that any tenant may install, but the configuration and credentials are always tenant-local.
- **Replacing `@eks/connector-sdk`**. The SDK is the contract; `@eks/integration` is the operational platform around it. A connector author imports types from `@eks/connector-sdk`; the runtime imports the executor, scheduler, and persistence layer from `@eks/integration`.
- **Replacing Payswap**. Payswap remains the sole payment infrastructure (see `docs/PAYMENTS.md`). The Payswap connector is *one of* the M4 connectors — it adapts the Payswap provider interface to the connector surface for downstream accounting/ERP sync.

---

## 2. Bounded Contexts

The Universal Connector Platform is decomposed into **sixteen bounded contexts**. Each maps to one or more `@eks/integration` submodules, one or more Prisma models, and a set of API routes. Bounded-context boundaries are visible at every import site (`@eks/integration/registry`, `@eks/integration/runtime`, `@eks/integration/sync`, etc. — never import across contexts at the source level).

| # | Bounded Context | Owns | Prisma Models | API Routes |
|---|---|---|---|---|
| 1 | **Connector Registry** | Catalog of connector definitions, versions, manifests; install/upgrade/rollback | `Connector`, `ConnectorVersion` | `/api/v1/integrations/connectors`, `/api/v1/integrations/connectors/:id/versions` |
| 2 | **Runtime** | Loading, isolating, executing connector invocations; lifecycle orchestration | `ConnectorExecution` | `/api/v1/integrations/connectors/:id/execute`, `/api/v1/integrations/connectors/:id/executions` |
| 3 | **Authentication** | Credential storage, rotation, scoped access, auth-plugin dispatch | `ConnectorCredential`, `SecretReference` | `/api/v1/integrations/connectors/:id/credentials`, `/api/v1/integrations/secrets` |
| 4 | **Synchronization** | Full/incremental/delta sync engine; cursor & checkpoint management; conflict detection | `SynchronizationJob`, `SynchronizationCheckpoint` | `/api/v1/integrations/connectors/:id/sync`, `/api/v1/integrations/jobs/:jobId` |
| 5 | **Mapping** | Schema mapping templates: source→target field projection | `MappingTemplate` | `/api/v1/integrations/mappings` |
| 6 | **Transformation** | JSON/XML/CSV transformations; calculated fields; lookup tables; conditional logic | `TransformationRule` | `/api/v1/integrations/transformations` |
| 7 | **Scheduling** | Sync schedule enforcement; cron & interval dispatch | `ConnectorSchedule` | `/api/v1/integrations/connectors/:id/schedule` |
| 8 | **Webhooks** | Endpoint registration, signature validation, replay protection, delivery tracking, DLQ | `WebhookEndpoint`, `WebhookDelivery` | `/api/v1/integrations/webhooks/endpoints`, `/api/v1/integrations/webhooks/inbound/:slug`, `/api/v1/integrations/webhooks/deliveries/:id/replay` |
| 9 | **Polling** | Scheduled polling jobs (subset of sync, lightweight, no mapping) | `PollingJob` | `/api/v1/integrations/connectors/:id/poll` |
| 10 | **Event Routing** | Outbound event fanout: Eks-Food domain events → external systems via connectors | (uses `EventOutbox` from M1) | `/api/v1/integrations/routes` |
| 11 | **Retry** | Retry policy templates & execution state | `RetryPolicy` | `/api/v1/integrations/policies/retry` |
| 12 | **Schema Registry** | Canonical & external schemas, versioning, compatibility | `SchemaDefinition`, `SchemaVersion` | `/api/v1/integrations/schemas` |
| 13 | **Health** | Per-connector health rollups, p50/p99 latency, error-rate windows | `ConnectorHealth` | `/api/v1/integrations/connectors/:id/health`, `/api/v1/integrations/health/dashboard` |
| 14 | **Rate Limiting** | Per-connector token-bucket rate limits, burst, 429 backoff hints | `RateLimitPolicy` | `/api/v1/integrations/policies/rate-limit` |
| 15 | **Secrets** | Encrypted credential storage, rotation tracking, secret-reference indirection | `SecretReference` | `/api/v1/integrations/secrets/:id/rotate` |
| 16 | **Versioning** | Connector semver, compatibility ranges, upgrade path resolution | `ConnectorVersion` (shared with #1) | `/api/v1/integrations/connectors/:id/versions/:v/activate` |

> **Package note.** `@eks/integration` is published under `src/packages/integration/` and follows the M1/M2/M3 package pattern: `package.json` (name, version, private), `index.ts` barrel, one source file per bounded context (`registry.ts`, `runtime.ts`, `auth.ts`, `sync.ts`, `mapping.ts`, `transformation.ts`, `scheduling.ts`, `webhooks.ts`, `polling.ts`, `event-routing.ts`, `retry.ts`, `schema-registry.ts`, `health.ts`, `rate-limit.ts`, `secrets.ts`, `versioning.ts`), and `__tests__/*.spec.ts` for each. It depends on the M3 `@eks/connector-sdk` (the `Connector` interface), `@eks/runtime` (sandboxing), and `@eks/registry` (packaging); the M1 `@eks/common` (retry, circuit-breaker, pagination), `@eks/events` (outbox, bus), `@eks/observability` (logger, metrics, tracing), `@eks/cache` (token-bucket rate-limit state), `@eks/security` (AES-256-GCM encryption for credentials); and the M2 `@eks/auth`, `@eks/authorization`, `@eks/organizations` (RBAC + tenancy on every route).

---

## 3. Connector Lifecycle

Every connector on the platform moves through a strict state machine. Transitions are atomic, audited (via the M2 `AuditLog` with `INTEGRATION_AUDIT_ACTIONS` codes), and reversible where possible. The states and transitions are persisted on the `Connector` (definition) and `ConnectorConfiguration` (per-tenant instance) rows, and emitted as domain events to the M1 `EventOutbox` for downstream subscribers (`@eks/notifications`, the Integration Console UI, the Ops dashboard).

```
                        ┌─────────────┐
                        │  (not yet)  │
                        └──────┬──────┘
                               │ install (operator picks connector + version)
                               ▼
                        ┌─────────────┐  deactivate (operator / health-check)
                        │  INSTALLED  │◀──────────────┐
                        └──────┬──────┘               │
                               │ activate (validate config + credentials)│
                               ▼                       │
                        ┌─────────────┐               │
                        │   ACTIVE    │───────────────▶│
                        └──────┬──────┘
                               │ first sync / first webhook / first poll
                               ▼
                        ┌─────────────┐  health-check fail (transient)
                        │   SYNCING   │───────────────▶│
                        └──────┬──────┘                │
                               │ sync complete         │
                               ▼                       │
                        ┌─────────────┐  error threshold exceeded
                        │   ACTIVE    │───────────────▶┌─────────────┐
                        └──────┬──────┘                │   ERROR     │
                               │                       └──────┬──────┘
                               │                              │ auto-retry
                               │                              ▼
                               │                       ┌─────────────┐
                               │                       │  RECOVERING │
                               │                       └──────┬──────┘
                               │                              │ health-check ok
                               │                              ▼
                               │◀─────────────────────────────│
                               │
                               │ remove (operator)
                               ▼
                        ┌─────────────┐
                        │   REMOVED   │   (credentials wiped, config tombstoned)
                        └─────────────┘
```

### Lifecycle transitions in detail

| Transition | Trigger | Pre-conditions | Post-conditions | Audit code |
|---|---|---|---|---|
| → INSTALLED | `POST /api/v1/integrations/connectors/:id/install` | `ConnectorVersion` exists; manifest validated; `permissions` accepted by operator | `ConnectorConfiguration` row created with `status="INSTALLED"`; `encryptedConfig` empty; `ConnectorCredential` rows seeded (placeholder) | `INTEGRATION_CONNECTOR_INSTALLED` |
| INSTALLED → ACTIVE | `POST /api/v1/integrations/connectors/:id/activate` | `ConnectorConfiguration.encryptedConfig` populated; `authenticate()` returns `{ ok: true }` | `status="ACTIVE"`; first `ConnectorSchedule` row created; first `ConnectorHealth` row seeded | `INTEGRATION_CONNECTOR_ACTIVATED` |
| ACTIVE → SYNCING | Scheduler tick or `POST .../sync` | `status="ACTIVE"`; no in-flight `SynchronizationJob` | `SynchronizationJob` row created (`status="RUNNING"`); `ConnectorConfiguration.status="SYNCING"` | `INTEGRATION_SYNC_STARTED` |
| SYNCING → ACTIVE | `SynchronizationJob.status="SUCCEEDED"` | Checkpoint persisted | `lastSyncAt` updated; `ConnectorHealth.lastSyncAt` updated; next `ConnectorSchedule` row enqueued | `INTEGRATION_SYNC_COMPLETED` |
| ACTIVE → ERROR | 5 consecutive `ConnectorExecution` failures OR `healthCheck()` returns `healthy=false` for 3 ticks | `ConnectorConfiguration.status` was `ACTIVE` or `SYNCING` | `status="ERROR"`; `lastError` populated; `ConnectorHealth.healthy=false`; alert emitted | `INTEGRATION_CONNECTOR_DEGRADED` |
| ERROR → RECOVERING | First successful `healthCheck()` after entering ERROR | `status="ERROR"` | `status="RECOVERING"`; backoff schedule enforced | `INTEGRATION_CONNECTOR_RECOVERING` |
| RECOVERING → ACTIVE | 3 consecutive successful `healthCheck()` calls | `status="RECOVERING"` | `status="ACTIVE"`; `ConnectorHealth.healthy=true` | `INTEGRATION_CONNECTOR_RECOVERED` |
| * → DEACTIVATED | Operator `POST .../deactivate` | Any state | `status="DEACTIVATED"`; `ConnectorSchedule` rows cancelled; in-flight jobs allowed to complete | `INTEGRATION_CONNECTOR_DEACTIVATED` |
| DEACTIVATED → ACTIVE | Operator `POST .../activate` | `status="DEACTIVATED"`; `authenticate()` re-validated | Same as INSTALLED → ACTIVE | `INTEGRATION_CONNECTOR_REACTIVATED` |
| * → REMOVED | Operator `DELETE /api/v1/integrations/connectors/:id` | `status="DEACTIVATED"` (must deactivate first) | `ConnectorCredential` rows wiped; `ConnectorConfiguration` tombstoned; `ConnectorSchedule` rows deleted; `WebhookEndpoint` rows deactivated | `INTEGRATION_CONNECTOR_REMOVED` |

The full set of audit codes is defined in `@eks/integration/audit-actions.ts` (mirroring the M2 `@eks/identity/audit-actions.ts` and M3 `@eks/developer/audit-actions.ts` conventions) and persisted to the M2 `AuditLog` table with `category="INTEGRATION"`.

---

## 4. Sandbox Isolation Model

Connectors run inside the **same sandbox** that M3 introduced for extensions (see `docs/developer/SECURITY_MODEL.md` §4). The sandbox is a Node.js `worker_threads` isolate with a capability-gated module loader. Every capability a connector can exercise flows through the `ConnectorContext` (an extension of the M3 `ExtensionContext`):

- **Network** — `ctx.apis.request(url, init)` is the only legitimate egress path. The proxy enforces `allowedDomains` from the manifest, applies the per-connector `RateLimitPolicy`, and writes a redacted `ConnectorExecution` row.
- **Storage** — `ctx.storage.get/put/delete` is namespaced by `installationId`; one connector cannot read another's keys. The KV store is backed by the M1 `@eks/cache` (Redis in production, in-memory in dev).
- **Secrets** — `ctx.secrets.get("ACME_API_KEY")` resolves a `SecretReference` row to the decrypted value via the M2 `@eks/security/crypto` AES-256-GCM envelope. The plaintext never leaves the sandbox; the connector sees only the value it requested.
- **Events** — `ctx.events.publish(type, payload)` writes to the M1 `EventOutbox` in the surrounding transaction; `ctx.events.subscribe(type, handler)` registers a handler invoked on subsequent event-bus deliveries.
- **Database** — Connectors **do not** get direct Prisma access. They emit domain events via `ctx.events.publish`; the platform's event handlers (in `@eks/domain`) translate events into Prisma writes. This is the same constraint the M3 sandbox places on extensions.
- **CPU/Memory** — The sandbox enforces a per-invocation wall-clock timeout (`timeoutMs` from the manifest; default 30s) and a memory cap (default 256MB). A connector that exceeds either is killed and the in-flight `ConnectorExecution` is marked `status="TIMEOUT"` or `status="OOM"`.
- **Filesystem** — Read-only access to the connector's own bundle (`/bundle/...`); write access to a per-invocation scratch directory (`/scratch/<executionId>/...`) that is wiped on invocation exit.

The `ConnectorRunner` (in `@eks/connector-sdk/runner.ts`, exercised by `@eks/integration/runtime.ts`) wraps each invocation in a `CircuitBreaker` (M1 `@eks/common/circuit-breaker`) and `withRetry` (M1 `@eks/common/retry`). The breaker trips after `failureThreshold` failures in `windowMs`; while open, invocations fail-fast with `CONN_CIRCUIT_OPEN` (from `@eks/connector-sdk/errors`).

---

## 5. Integration with M1, M2, M3

The Connector Platform is a **consumer** of every layer below it; it does not redefine any of them.

### M1 — Foundation
- **`@eks/events`** — Every connector execution, sync, and webhook delivery publishes a domain event to the `EventOutbox`. The outbox relay guarantees at-least-once delivery to the `EventBus`, which routes to subscribers (notifications, audit, observability, the Integration Console live-updates).
- **`@eks/observability`** — The `logger()` is scoped per-connector (`logger().child({ connector: code, organizationId })`); `metrics()` exposes counters (`connector.executions.total`, `connector.sync.lag.seconds`, `webhook.delivery.failures.total`) and histograms (`connector.exec.duration.ms`); `tracing()` spans every `ConnectorRunner.execute` call.
- **`@eks/common`** — `withRetry` (exponential backoff + jitter), `CircuitBreaker` (failure-rate-tripped, half-open probe), `buildPagination` (cursor/offset/page strategies from `@eks/connector-sdk/pagination`).
- **`@eks/cache`** — Token-bucket rate-limit state lives in Redis (`rate-limit:{connectorCode}:{organizationId}`); auth-context cache (`auth:{credentialId}` TTL 1h, refreshed 60s before expiry); schema cache (`schema:{definitionId}:{version}` TTL 24h).
- **`@eks/security`** — AES-256-GCM encryption of `ConnectorCredential.encryptedValue`; HMAC-SHA256 webhook signatures; Ed25519 manifest signing (inherited from M3 `@eks/registry`).
- **`@eks/api`** — `apiHandler` wrapper, `success`/`error` response helpers, Zod validation pipeline.
- **`@eks/workers`** — The scheduler enqueues sync/poll/webhook jobs onto the M1 worker queue; workers pull jobs and invoke the `ConnectorRunner`.

### M2 — Identity & Tenancy
- **`@eks/auth`** — Every `/api/v1/integrations/*` route is authenticated by the M2 session middleware. Service-to-service calls (scheduler → runtime) use a short-lived service JWT issued by `@eks/auth/service`.
- **`@eks/authorization`** — RBAC permission `integration.connectors.manage` is required to install/activate/deactivate; `integration.connectors.read` is required to view; `integration.syncs.force` to trigger a sync out of schedule; `integration.webhooks.replay` to replay a failed delivery.
- **`@eks/organizations`** — The `organizationId` on every `ConnectorConfiguration` enforces tenant isolation. The `TenantContext` ALS (M2 `MULTI_TENANCY.md` §4) propagates through every Prisma query in `@eks/integration`.
- **`@eks/notifications`** — Health degradation, sync lag, and webhook DLQ events trigger notifications via the M2 notification template registry (`INTEGRATION_*` templates).

### M3 — Developer Platform
- **`@eks/connector-sdk`** — The `Connector` interface, `ConnectorRunner`, `buildPagination`, `mapSchema`, `CONN_ERRORS`. The M4 platform wraps but does not modify the SDK.
- **`@eks/runtime`** — Sandbox loading, capability enforcement, lifecycle hooks. `@eks/integration/runtime.ts` calls `@eks/runtime/loadInstallation` to materialise a connector instance.
- **`@eks/registry`** — Connector packages are signed and published through the M3 registry pipeline. A `Connector` row corresponds to an `Extension` row with `kind="connector"`; a `ConnectorVersion` corresponds to an `ExtensionVersion`.
- **`@eks/workflow`** — Workflows can invoke connectors as steps (`step.invokeConnector("acme-pos", { action: "sync" })`). The workflow engine delegates to `@eks/integration/runtime` for the actual execution.
- **`@eks/developer`** — The `DEVELOPER_EVENTS` registry (`Connector.Installed`, `Connector.Activated`, `Connector.Synced`, `Connector.Failed`, `Webhook.Delivered`, `Webhook.Dlqd`, `Schema.Published`, `Schema.Deprecated`, `Secret.Rotated`) and `DEVELOPER_AUDIT_ACTIONS` codes are emitted by the M4 platform.

---

## 6. End-to-End Request Flow

The following ASCII diagram traces a single sync invocation from an external system through the runtime to the Eks-Food platform. The same shape applies to webhook and poll invocations; only the trigger and the entry method differ.

```
   ┌─────────────────┐                                            ┌─────────────────────┐
   │ External System │                                            │  Eks-Food Platform  │
   │  (Acme POS,     │                                            │   (Prisma + Events) │
   │   Stripe,       │                                            │                     │
   │   Kafka, ...)   │                                            │                     │
   └────────┬────────┘                                            └──────────▲──────────┘
            │                                                                │
            │ HTTP / SQS / Kafka / SFTP / DB                                 │ Prisma writes
            │                                                                │ (Booking, Cook, Payment,
            ▼                                                                │  Inventory, AuditLog)
   ┌─────────────────────────┐   ctx.apis.request      ┌─────────────────────┴──────┐
   │  Connector (sandboxed)  │ ◀────────────────────── │  @eks/integration/runtime  │
   │  - authenticate()       │   ctx.secrets.get       │  (ConnectorRunner wrapper) │
   │  - poll()/sync()        │ ◀────────────────────── │  - circuit breaker         │
   │  - mapSchema()          │   ctx.events.publish    │  - retry with backoff      │
   │  - handleWebhook()      │ ──────────────────────▶ │  - rate-limit enforcement  │
   │  - healthCheck()        │                         │  - execution logging       │
   └─────────────────────────┘                         └───────────┬────────────────┘
                                                                   │
                                ┌──────────────────────────────────┼──────────────────────────┐
                                │                                  │                          │
                ┌───────────────▼─────────┐    ┌────────────────────▼──────────┐  ┌──────────▼───────────┐
                │  @eks/integration/sync  │    │  @eks/integration/scheduling  │  │ @eks/integration/    │
                │  - SynchronizationJob   │    │  - ConnectorSchedule          │  │ webhooks             │
                │  - checkpoints          │    │  - cron / interval dispatch   │  │ - WebhookEndpoint    │
                │  - conflict detection   │    │  - M1 worker queue            │  │ - WebhookDelivery    │
                │  - rollback             │    └───────────────────────────────┘  │ - DLQ                │
                └───────────┬─────────────┘                                       └──────────┬───────────┘
                            │                                                                │
                            ▼                                                                ▼
                ┌───────────────────────────┐                                ┌─────────────────────────────┐
                │  @eks/integration/mapping │                                │ @eks/integration/           │
                │  - MappingTemplate        │                                │ schema-registry             │
                │  - source→target rules    │                                │ - SchemaDefinition          │
                └───────────┬───────────────┘                                │ - SchemaVersion             │
                            │                                                │ - compatibility check       │
                            ▼                                                └──────────────┬──────────────┘
                ┌────────────────────────────┐                                              │
                │  @eks/integration/         │  ◀──────── schema version pinned ◀──────────┘
                │  transformation            │
                │  - TransformationRule      │
                │  - JSON/XML/CSV engines    │
                │  - lookup tables           │
                └─────────────┬──────────────┘
                              │
                              ▼
                ┌────────────────────────────┐
                │  @eks/events/outbox        │ ──▶ EventBus ──▶ @eks/domain handlers ──▶ Prisma
                │  (M1, atomic with sync tx) │                      │
                └────────────────────────────┘                      │
                                                                    ▼
                                                       ┌────────────────────────────┐
                                                       │ @eks/notifications         │
                                                       │ @eks/observability/audit   │
                                                       │ Integration Console (UI)   │
                                                       └────────────────────────────┘
```

The horizontal arrows inside the runtime column are **in-process function calls** within `@eks/integration`. The vertical arrows from the runtime down into sync/mapping/transformation are also in-process; the data flows back up through the runtime to the sandbox. The arrows from `@eks/events/outbox` to the platform are **transactional outbox deliveries** (at-least-once, idempotent consumers).

---

## 7. Scaling to Tens of Thousands of Connectors

The platform is designed for **~50,000 concurrently-active connectors** across all tenants at peak. The shape of the workload is:

- **Scheduling** — Each `ConnectorSchedule` row is a cron expression or an interval. The scheduler (in `@eks/integration/scheduling.ts`, backed by the M1 `@eks/workers` queue) computes the next-fire time for every schedule and enqueues a job onto the M1 worker queue at the appropriate time. The queue is partitioned by `connectorCode` so that hot connectors (e.g. `payswap` with 20k active configs) do not starve cold ones.
- **Execution** — Workers pull jobs from the queue with bounded concurrency (default 256 concurrent invocations per worker node). Each invocation loads the `Connector` bundle from the M3 registry cache, instantiates the sandbox, runs the method, and writes the `ConnectorExecution` row. The sandbox is destroyed on invocation exit (no long-lived processes).
- **State** — All state lives in Postgres (`ConnectorConfiguration.syncState`, `SynchronizationCheckpoint`, `ConnectorHealth`) and Redis (`rate-limit:{connector}:{org}`, `auth:{credentialId}`, `circuit:{connector}:{org}`). There is no in-memory state that survives an invocation; any node can be killed and replaced without data loss.
- **Backpressure** — When the worker queue depth exceeds `EKS_INTEGRATION_MAX_QUEUE_DEPTH` (default 10,000), the scheduler slows down non-critical connectors (those whose `ConnectorSchedule.priority < 5`) by extending their next-fire time. Webhook deliveries are **always** enqueued regardless of depth; they have their own queue partition.
- **Rate limits** — The per-connector `RateLimitPolicy` is enforced via a Redis token bucket shared across all worker nodes. A connector whose upstream returns `429 Too Many Requests` is backed off: the next `ConnectorSchedule` fire is delayed by the `Retry-After` header (or 60s if absent), and an alert is emitted if the backoff exceeds 5 minutes.
- **Multi-tenancy** — Every query is scoped by `organizationId` (M2 `TenantContext` ALS). One tenant's connector traffic cannot affect another's: the worker queue has per-tenant fair-share scheduling (`EKS_INTEGRATION_TENANT_FAIR_SHARE=true`), the rate-limit buckets are per-tenant, and the circuit breakers are per-tenant per-connector.
- **Database pressure** — `ConnectorExecution` is the highest-volume table (one row per invocation; at peak ~500 writes/sec across all tenants). It is **time-partitioned by `startedAt`** (monthly partitions) with automatic archival of partitions older than 90 days to S3 (Parquet). `WebhookDelivery` and `PollingJob` are similarly partitioned. `ConnectorConfiguration`, `Connector`, `ConnectorVersion`, `ConnectorCredential`, `ConnectorSchedule`, `SynchronizationJob`, `SynchronizationCheckpoint`, `MappingTemplate`, `TransformationRule`, `SchemaDefinition`, `SchemaVersion`, `RetryPolicy`, `RateLimitPolicy`, `SecretReference`, `WebhookEndpoint` are low-volume and not partitioned.
- **Caching** — `Connector` definitions and `ConnectorVersion` manifests are cached for 5 minutes (`@eks/cache`); `SchemaDefinition` and `SchemaVersion` are cached for 24 hours (schema evolution is rare); `MappingTemplate` and `TransformationRule` are cached for 5 minutes; the per-connector `RateLimitPolicy` and `RetryPolicy` are cached for 60 seconds.

The capacity model is: **one worker node per ~2,000 concurrent invocations**. At the design point of 50k connectors averaging one invocation per 5 minutes, the steady-state concurrency is ~170 invocations; burst capacity (e.g. morning sync spike across all tenants) handles 10× steady state, requiring ~9 worker nodes. The platform autoscales on `queue_depth > 1000` and `worker_cpu > 70%`.

---

## 8. The `@eks/integration` Package Surface

```typescript
// src/packages/integration/index.ts
export * from "./registry";          // Connector, ConnectorVersion CRUD
export * from "./runtime";           // execute() — wraps ConnectorRunner
export * from "./auth";              // authenticate(), credential rotation
export * from "./sync";              // runSync(), checkpoint management
export * from "./mapping";           // applyMappingTemplate()
export * from "./transformation";    // applyTransformationRule()
export * from "./scheduling";        // enqueueSchedule(), nextFireTime()
export * from "./webhooks";          // registerEndpoint(), verifySignature(), deliver()
export * from "./polling";           // runPoll()
export * from "./event-routing";     // routeDomainEvent()
export * from "./retry";             // buildRetryPolicy()
export * from "./schema-registry";   // publishSchema(), checkCompatibility()
export * from "./health";            // recordHealth(), getHealthRollup()
export * from "./rate-limit";        // enforceRateLimit()
export * from "./secrets";           // resolveSecret(), rotateSecret()
export * from "./versioning";        // resolveUpgradePath()
export * from "./audit-actions";     // INTEGRATION_AUDIT_ACTIONS
export * from "./events";            // INTEGRATION_EVENTS, buildIntegrationEvent
```

Every public function returns a `Result<T, DomainError>` (M1 `@eks/common/result`). No function throws on expected failures; unexpected infrastructure failures propagate as `@eks/errors` and are caught by the `apiHandler` wrapper at the route boundary.

---

## 9. The `/api/v1/integrations/*` Route Surface

```
GET    /api/v1/integrations/connectors                    — list installed + available connectors
POST   /api/v1/integrations/connectors                    — install a connector (creates ConnectorConfiguration)
GET    /api/v1/integrations/connectors/:id                — connector detail (def + configs + health)
PATCH  /api/v1/integrations/connectors/:id                — update config
DELETE /api/v1/integrations/connectors/:id                — remove (must be DEACTIVATED first)
POST   /api/v1/integrations/connectors/:id/activate       — INSTALLED → ACTIVE
POST   /api/v1/integrations/connectors/:id/deactivate     — * → DEACTIVATED
POST   /api/v1/integrations/connectors/:id/sync           — force a sync (SynchronizationJob)
POST   /api/v1/integrations/connectors/:id/poll           — force a poll (PollingJob)
GET    /api/v1/integrations/connectors/:id/executions     — paginated ConnectorExecution history
GET    /api/v1/integrations/connectors/:id/health         — current + history (24h, 7d rollups)
GET    /api/v1/integrations/connectors/:id/schedule       — current ConnectorSchedule
PATCH  /api/v1/integrations/connectors/:id/schedule       — update cadence
GET    /api/v1/integrations/connectors/:id/credentials    — list (metadata only; values never returned)
POST   /api/v1/integrations/connectors/:id/credentials    — add a credential
POST   /api/v1/integrations/connectors/:id/credentials/:cid/rotate  — rotate a credential
GET    /api/v1/integrations/connectors/:id/versions       — version history
POST   /api/v1/integrations/connectors/:id/versions/:v/activate    — switch active version
GET    /api/v1/integrations/jobs/:jobId                   — SynchronizationJob status + checkpoints
POST   /api/v1/integrations/jobs/:jobId/rollback          — rollback to a checkpoint
GET    /api/v1/integrations/webhooks/endpoints            — list WebhookEndpoint
POST   /api/v1/integrations/webhooks/endpoints            — register
POST   /api/v1/integrations/webhooks/inbound/:slug        — inbound webhook receiver
GET    /api/v1/integrations/webhooks/deliveries           — paginated WebhookDelivery
POST   /api/v1/integrations/webhooks/deliveries/:id/replay — replay a failed delivery
GET    /api/v1/integrations/schemas                       — list SchemaDefinition
POST   /api/v1/integrations/schemas                       — publish a new schema version
GET    /api/v1/integrations/schemas/:id/versions          — version history
POST   /api/v1/integrations/schemas/:id/versions/:v/check — compatibility check
GET    /api/v1/integrations/mappings                      — list MappingTemplate
POST   /api/v1/integrations/mappings                      — create
GET    /api/v1/integrations/transformations               — list TransformationRule
POST   /api/v1/integrations/transformations               — create
GET    /api/v1/integrations/policies/retry                — list RetryPolicy templates
POST   /api/v1/integrations/policies/retry                — create
GET    /api/v1/integrations/policies/rate-limit           — list RateLimitPolicy templates
POST   /api/v1/integrations/policies/rate-limit           — create
GET    /api/v1/integrations/secrets                       — list SecretReference (metadata only)
POST   /api/v1/integrations/secrets/:id/rotate            — rotate a secret
GET    /api/v1/integrations/health/dashboard              — aggregate health for the dashboard
```

Every route is wrapped in the M2 `apiHandler` (Zod validation, RBAC enforcement, tenant scoping, audit logging). See `CONNECTOR_DEVELOPMENT.md` for end-to-end code patterns, `AUTHENTICATION_GUIDE.md` for the credential routes, `SYNCHRONIZATION_GUIDE.md` for the sync routes, `WEBHOOK_GUIDE.md` for the webhook routes, `SCHEMA_REGISTRY_GUIDE.md` for the schema routes, `TRANSFORMATION_GUIDE.md` for the mapping & transformation routes, `OPERATIONS_RUNBOOK.md` for the ops dashboard, and `DISASTER_RECOVERY.md` for the recovery procedures.

---

## 10. Open Questions & Forward Compatibility

The M4 platform deliberately leaves the following seams for M5+:

- **Streaming sync** — The current sync model is batched. A streaming variant (`sync({ mode: "stream" })` returning an `AsyncIterable<Record>`) is reserved in the `Connector` interface but not yet implemented by the runtime.
- **Bidirectional conflict resolution UI** — Conflict detection is implemented (see `SYNCHRONIZATION_GUIDE.md` §6); the resolution UI for human-in-the-loop conflicts is M5.
- **Connector marketplace** — The M4 registry is private (Eks-Food-curated publishers). The public marketplace with search, ratings, and external payout is M5.
- **Custom auth plugins** — The auth plugin registry supports the eight built-in strategies (see `AUTHENTICATION_GUIDE.md` §1). Custom plugins (e.g. for proprietary SSO) require a code review and a platform release; the plugin host API for runtime-loaded auth plugins is M5.
- **Cross-region connector replication** — Connectors run in the tenant's `dataResidencyRegion`. Cross-region replication for disaster recovery is M5 (see `DISASTER_RECOVERY.md` §6 for the manual procedure today).
