# Eks-Food Developer Platform — Architecture

> **Audience:** Platform engineers, extension authors, security reviewers, and on-call developer-platform maintainers. Read alongside `docs/ARCHITECTURE.md` (platform hexagon), `docs/EVENT_CONVENTIONS.md` (eventing), `docs/identity/ARCHITECTURE.md` (M2 IAM), and the sibling docs in this folder: `SDK_GUIDE.md`, `CONNECTOR_SDK_GUIDE.md`, `EXTENSION_AUTHORING.md`, `RUNTIME_ARCHITECTURE.md`, `SECURITY_MODEL.md`, `PERMISSION_MODEL.md`, `CLI_GUIDE.md`.
>
> **Status:** Milestone 3 — Developer Platform, Extension Framework & Connector SDK. This document describes the **target M3 architecture**: the `@eks/*` packages (`@eks/sdk`, `@eks/connector-sdk`, `@eks/runtime`, `@eks/workflow`, `@eks/registry`, `@eks/dev-cli`, `@eks/developer`), the Prisma models (`Extension`, `ExtensionVersion`, `ExtensionManifest`, `ExtensionPermission`, `ExtensionConfiguration`, `ExtensionInstallation`, `ConnectorDefinition`, `ConnectorConfiguration`, `ConnectorExecution`, `WorkflowDefinition`, `WorkflowExecution`, `EventReplay`, `Secret`, `Package`, `Publisher`, `RuntimeHealth`, `ExtensionLog`), and the public API surface (`/api/v1/extensions/*`, `/api/v1/connectors/*`, `/api/v1/workflows/*`). It builds on the M1 foundation (`@eks/common`, `@eks/config`, `@eks/errors`, `@eks/observability`, `@eks/events`, `@eks/cache`, `@eks/features`, `@eks/api`, `@eks/workers`, `@eks/security`, `@eks/payments`, `@eks/domain`, `@eks/testing`) and the M2 IAM stack (`@eks/identity`, `@eks/auth`, `@eks/authorization`, `@eks/organizations`, `@eks/notifications`, `@eks/verification`). The `@eks/developer` package (built in the M3 domain-events track) supplies the canonical `DEVELOPER_EVENTS` registry (19 events: `Extension.Installed`, `Extension.Activated`, `Extension.Suspended`, `Extension.Removed`, `Extension.Upgraded`, `Extension.RolledBack`, `Extension.HealthChanged`, `Extension.LogEmitted`, `Connector.Executed`, `Connector.Failed`, `Workflow.Started`, `Workflow.Completed`, `Workflow.Failed`, `Event.Replayed`, `Manifest.Validated`, `Manifest.ValidationFailed`, `Package.Published`, `Package.SignatureVerified`, `Secret.Rotated`), the `DEVELOPER_AUDIT_ACTIONS` registry (25 audit codes), the `buildDeveloperEvent` factory, and the `DeveloperEvent` / `DeveloperAuditAction` literal unions.

---

## 1. Goals & Non-Goals

### Goals
- Turn Eks-Food into a **programmable platform**: any tenant (or Eks-Food itself) can ship an extension that adds API handlers, subscribes to domain events, runs scheduled jobs, mounts a connector, or executes a workflow — without forking the core.
- Make every extension **isolated by construction**: one extension cannot read another's storage, exhaust its CPU, hijack its event subscriptions, or crash the host process. The sandbox is the trust boundary.
- Make the developer surface **small and stable**: every capability an extension can exercise flows through `@eks/sdk` (the `ExtensionContext`). Direct access to Prisma, Redis, the file system, or the network is forbidden and blocked at the sandbox layer.
- Make installation, activation, upgrade, rollback, and removal **first-class lifecycle operations** with audit, health, and rollback semantics — mirroring the rigor of the M2 session/identity lifecycle.
- Make connectors and workflows **share the same trust model** as extensions: a connector is a specialisation of an extension with an additional capability surface (`authenticate`, `poll`, `sync`, `handleWebhook`), and a workflow is a declarative composition of extension-provided steps.
- Keep the platform **operationally cheap**: thousands of installed extensions per tenant must not require thousands of long-running processes. The runtime loads extensions on demand, isolates them by request, and idles them between events.

### Non-Goals
- A **public marketplace** with search, ratings, revenue split, and external payout. The M3 registry is private: only verified publishers (Eks-Food partners and approved tenants) can publish. The public marketplace is M5.
- A **Turing-complete visual workflow editor**. The M3 workflow engine executes YAML-defined DAGs of extension steps; the visual editor is M5.
- **Cross-tenant extension sharing**. An extension is installed per-tenant (`ExtensionInstallation.organizationId`). Eks-Food-curated "platform extensions" bypass the per-tenant model via a `publisher.kind = "platform"` flag, but partner- and tenant-authored extensions are tenant-scoped.
- **Sandboxing arbitrary native modules**. The M3 runtime runs TypeScript/JavaScript extensions under a permissioned V8 isolate (Node.js `worker_threads` + a capability-gated module loader). Sandboxing WASM, Python, or JVM extensions is M5+.
- **Replacing the M2 IAM system**. The Developer Platform **consumes** identity and authorization — it does not redefine them. Every API call into `/api/v1/extensions/*` is authenticated by `@eks/auth/middleware` and authorized by `@eks/authorization`, exactly like every other M2 API.

---

## 2. Bounded Contexts

The Developer Platform is decomposed into twelve bounded contexts. Each maps to one or more `@eks/*` packages, one or more Prisma models, and a set of API routes. Bounded-context boundaries are visible at every import site (`@eks/sdk`, `@eks/connector-sdk`, `@eks/runtime`, etc. — never import across contexts at the source level).

| # | Bounded Context | Owns | `@eks/*` Package(s) | Prisma Models | API Routes |
|---|---|---|---|---|---|
| 1 | **Extension Runtime** | Loading, isolating, executing extensions; lifecycle orchestration | `@eks/runtime` | `ExtensionInstallation`, `RuntimeHealth`, `ExtensionLog` | `/api/v1/extensions/:id/runtime/*` (health, logs) |
| 2 | **Registry** | Catalog of extensions, versions, manifests; package storage; install/upgrade/rollback | `@eks/registry` | `Extension`, `ExtensionVersion`, `ExtensionManifest`, `ExtensionPermission`, `ExtensionConfiguration`, `Package`, `Publisher` | `/api/v1/extensions/*`, `/api/v1/registry/*` |
| 3 | **SDK** | The `ExtensionContext` surface given to every extension at runtime | `@eks/sdk` | — (consumer only) | — (linked into extension bundle) |
| 4 | **Connector SDK** | The `Connector` interface and built-in capabilities (retry, pagination, cursors, circuit breakers) | `@eks/connector-sdk` | `ConnectorDefinition`, `ConnectorConfiguration`, `ConnectorExecution` | `/api/v1/connectors/*` |
| 5 | **Manifest** | The `ExtensionManifest` schema, validation, compatibility resolution | `@eks/registry` (manifest submodule) + `@eks/sdk` (types) | `ExtensionManifest`, `ExtensionPermission`, `ExtensionConfiguration` | `/api/v1/extensions/:id/manifest` |
| 6 | **Event SDK** | The typed `events` proxy on the `ExtensionContext`; subscribe, publish, replay | `@eks/sdk` (events submodule) + `@eks/events` (M1) | `EventReplay` | `/api/v1/events/replay` |
| 7 | **Workflow SDK** | The `WorkflowDefinition` executor and the `workflow` proxy on `ExtensionContext` | `@eks/workflow` | `WorkflowDefinition`, `WorkflowExecution` | `/api/v1/workflows/*` |
| 8 | **Testing** | The `@eks/testing` extensions: `createExtensionHarness`, `mockExtensionContext`, fixture builders | `@eks/testing` (M1 + M3 additions) | — | — |
| 9 | **Packaging** | Reproducible builds, dependency locking, integrity checksums, Ed25519 signing, tar+zstd | `@eks/dev-cli` (package command) + `@eks/registry` (verify command) | `Package` | `/api/v1/extensions/:id/versions/:v/package` |
| 10 | **Publishing** | Validation pipeline, compatibility checks, malware-scan hooks, staged rollout, rollback | `@eks/registry` (publish submodule) | `Publisher`, `ExtensionVersion`, `Package` | `/api/v1/extensions/:id/versions`, `/api/v1/publishers/*` |
| 11 | **Sandbox** | Resource limits, permission enforcement, network policies, filesystem isolation | `@eks/runtime` (sandbox submodule) | `RuntimeHealth`, `ExtensionLog` | — (internal) |
| 12 | **Console** | The Developer Console UI (Next.js) consuming the registry/runtime/workflow APIs | `src/app/(console)/developer/*` | — (consumer only) | — (UI) |
| 13 | **Domain Events & Audit Codes** | The canonical `DEVELOPER_EVENTS` registry, `DEVELOPER_AUDIT_ACTIONS` codes, and the `buildDeveloperEvent` factory shared by every other context | `@eks/developer` | — (cross-cutting; persists events to `EventOutbox` and audit codes to `AuditLog`) | — (internal; consumed by `/api/v1/extensions/*`, `/api/v1/connectors/*`, `/api/v1/workflows/*` handlers) |

> **Package note.** The M3 packages `@eks/sdk`, `@eks/connector-sdk`, `@eks/runtime`, `@eks/workflow`, `@eks/registry`, `@eks/dev-cli`, and the cross-cutting `@eks/developer` (domain events + audit codes) are published under `src/packages/`. Each follows the M1 pattern: `package.json` (name, version, private), `index.ts` barrel, source files, `__tests__/*.spec.ts`. They depend on the M1 kernel (`@eks/common`, `@eks/errors`, `@eks/observability`, `@eks/events`, `@eks/cache`, `@eks/config`, `@eks/security`) and on the M2 IAM stack (`@eks/auth`, `@eks/authorization`, `@eks/organizations`) for authentication, authorization, and tenancy propagation. `@eks/developer` mirrors the M2 `@eks/identity` package: a `DEVELOPER_EVENTS` constant keyed by PascalCase names whose values are the wire-format `{Aggregate}.{PastTenseVerb}` strings, a `DEVELOPER_AUDIT_ACTIONS` constant of uppercase SNAKE_CASE codes, a `buildDeveloperEvent(name, aggregateId, payload, meta?)` factory that pulls correlation/trace/actor ids from the ambient `requestContext()`, and a barrel `index.ts` re-exporting both registries plus the `DeveloperEvent` / `DeveloperAuditAction` literal unions.

---

## 3. Extension Lifecycle

Every extension on the platform moves through a strict state machine. Transitions are atomic, audited, and reversible where possible. The states and transitions are persisted on the `ExtensionInstallation` row and emitted as domain events to the M1 `EventOutbox` for downstream subscribers (`@eks/notifications`, `@eks/observability/audit`, the Developer Console live-updates).

```
                        ┌─────────────┐
                        │  (not yet)  │
                        └──────┬──────┘
                               │ install
                               ▼
                        ┌─────────────┐
                ┌───────│   PENDING   │───────┐
                │       └──────┬──────┘       │
                │              │ activate     │ reject (install)
                │              ▼              │
                │       ┌─────────────┐       │
                │       │   ACTIVE    │◀──────┘ (removed)
                │       └──────┬──────┘
                │              │ suspend
                │              ▼
                │       ┌─────────────┐
                │       │  SUSPENDED  │
                │       └──────┬──────┘
                │              │ activate (resume)
                │              ▼
                │       ┌─────────────┐
                │       │   ACTIVE    │
                │       └──────┬──────┘
                │              │ upgrade
                │              ▼
                │       ┌─────────────┐
                │       │  UPGRADING  │
                │       └──────┬──────┘
                │   ┌──────────┴──────────┐
                │   │ commit              │ rollback
                │   ▼                     ▼
                │ ┌─────────────┐   ┌─────────────┐
                │ │   ACTIVE    │   │  ROLLING   │
                │ │ (new ver)   │   │   BACK     │
                │ └──────┬──────┘   └──────┬──────┘
                │        │                 │ commit
                │        │                 ▼
                │        │           ┌─────────────┐
                │        │           │   ACTIVE    │
                │        │           │ (prev ver)  │
                │        │           └─────────────┘
                │        │ remove
                ▼        ▼
                ┌─────────────┐
                │   REMOVED   │  (soft delete; 30-day grace for audit)
                └─────────────┘
```

**Lifecycle invariants:**
1. **Only one ACTIVE version per installation.** The `ExtensionInstallation.activeVersionId` is the sole source of truth; the runtime refuses to execute any other version.
2. **Upgrade is atomic.** The transition `ACTIVE → UPGRADING → ACTIVE` happens inside a single Prisma transaction that writes the new `activeVersionId`, the previous `activeVersionId` to `previousVersionId` (for rollback), and the `Extension.Upgraded` event to the `EventOutbox`.
3. **Rollback is one-shot.** A failed upgrade automatically rolls back to `previousVersionId`; an admin-initiated rollback can also target any prior version that is still in `ExtensionVersion` with `status = "PUBLISHED"`.
4. **Suspend is non-destructive.** The runtime evicts the extension's isolate from the pool and rejects all subsequent invocations with `409 Extension Suspended`, but storage, configuration, and installation metadata are untouched.
5. **Remove is soft.** The `ExtensionInstallation.deletedAt` is set; the row is retained for 30 days for audit reconstruction, then purged by the `extensions.gc` worker. The extension's `ExtensionStorage` rows are deleted immediately (the storage is owned by the installation, not the tenant).
6. **Every transition emits an event.** `Extension.Installed`, `Extension.Activated`, `Extension.Suspended`, `Extension.Upgraded`, `Extension.RolledBack`, `Extension.Removed` — versioned `v1` events, routed through the M1 `EventBus` and consumed by `@eks/observability/audit` and the Developer Console.

---

## 4. Sandbox Isolation Model

The sandbox is the single most important contract of the Developer Platform. It is what allows Eks-Food to run third-party code in the same process as customer payment data without compromising the trust model established by M1 (`@eks/security`) and M2 (`@eks/auth`, `@eks/authorization`).

### 4.1 Isolation layers

The sandbox is enforced at **four layers**, defence-in-depth. Breaching any single layer is insufficient to escape the sandbox.

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 — Process isolation (worker_threads)                    │
│  Each extension runs in a dedicated Node.js worker thread.       │
│  A SIGSEGV / uncaught exception in the worker does NOT crash     │
│  the host. The host watches the worker via a heartbeat; if the   │
│  worker dies, the runtime logs to ExtensionLog, marks the        │
│  installation as DEGRADED in RuntimeHealth, and restarts it on   │
│  the next request (cold start).                                  │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2 — Capability gating (the ExtensionContext)              │
│  The worker is given ONLY the @eks/sdk ExtensionContext. There   │
│  is no `require`, no `import`, no `process.env`, no `fs`, no     │
│  `child_process`, no `net` — the @eks/sdk proxy is the entire    │
│  reachable surface. Every capability (apis, events, storage,     │
│  cache, config, logger, metrics, tracer, auth, secrets, retry)   │
│  is implemented as a permission-checked proxy. A call to         │
│  `storage.get("foo")` is allowed only if the manifest declares   │
│  `access.storage`; otherwise it throws `ForbiddenError`.         │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3 — Resource limits (per-invocation quotas)               │
│  Every invocation is bounded by: CPU (ms), wall-clock (ms),      │
│  heap (MB), outbound call count, storage I/O count, event        │
│  publish count. Limits come from ExtensionManifest.limits and    │
│  the tenant's plan; the runtime enforces them via                │
│  `worker_threads` `resourceLimits` + a per-invocation            │
│  deadline timer. Breach aborts the invocation with               │
│  `ResourceLimitExceeded` (HTTP 408 on the parent request).       │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4 — Network policy (egress allowlist)                     │
│  The sandbox has no direct network access. The only way to call  │
│  an external service is via `ctx.apis.fetch("connector:acme",    │
│  "/orders", …)` or `ctx.apis.invoke("extension:my-ext",          │
│  "handler", …)`, both of which route through the platform's      │
│  egress proxy. The egress proxy enforces a per-installation      │
│  allowlist derived from `ExtensionManifest.allowedDomains` and   │
│  records every outbound call to ExtensionLog + AuditLog.         │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Storage isolation

Extensions do **not** get their own database tables. Instead, the `@eks/sdk` `storage` proxy exposes a key/value API backed by an `ExtensionStorage` model (rows scoped by `installationId` + `organizationId`). A `storage.get("foo")` call resolves to:

```sql
SELECT value FROM "ExtensionStorage"
WHERE "installationId" = $1
  AND "organizationId" = $2  -- tenant isolation
  AND "key" = $3;
```

The `installationId` is injected by the runtime; the extension never sees it. A bug in the SDK cannot leak another installation's data because the `WHERE` clause is built server-side from the installation's identity, not from the extension's input.

### 4.3 Event isolation

An extension subscribing to `booking.created.v1` does **not** receive raw `EventBus` deliveries. Instead, the runtime registers a typed subscriber on the extension's behalf, and each delivery is:

1. **Filtered by tenant.** The event's `organizationId` must match the installation's `organizationId`. A `platform` extension (one with `publisher.kind = "platform"`) receives events across tenants but is sandboxes from customer data (the `payload` is scrubbed of PII fields by the `@eks/events` redaction layer).
2. **Filtered by manifest.** Only events in `ExtensionManifest.requiredEvents` are routed. Subscribing to an undeclared event type throws at registration time, not at delivery time.
3. **Metered.** Each delivery counts against the installation's per-second event rate. Breach triggers a `RateLimitError` and the event is redelivered later via the M1 `DeadLetterQueue`.

### 4.4 Capability surface (the only thing an extension can do)

| Capability | SDK method | Manifest permission | Notes |
|---|---|---|---|
| Register an HTTP handler | `ctx.apis.register("route", handler)` | `invoke.apis` | Routes mounted under `/api/v1/extensions/:slug/route` |
| Invoke another extension | `ctx.apis.invoke("ext:slug", "handler", payload)` | `invoke.apis` + target's `expose.apis` | Cross-extension calls are audited |
| Call an external connector | `ctx.apis.fetch("connector:slug", path, init)` | `invoke.apis` + `connector:slug` in `connectorDependencies` | Routes through the egress proxy |
| Subscribe to a domain event | `ctx.events.subscribe("booking.created.v1", handler)` | `subscribe.events` + event in `requiredEvents` | Filtered by tenant |
| Publish an integration event | `ctx.events.publish("my-ext.thing.v1", payload)` | `publish.events` | Versioned, idempotent, outbox-backed |
| Replay past events | `ctx.events.replay({ from, to, types })` | `subscribe.events` + `events.replay` | Writes an `EventReplay` row for audit |
| Read/write key/value storage | `ctx.storage.get/set/delete("key")` | `access.storage` | Scoped to installation + tenant |
| Cache a value | `ctx.cache.get/set("key", ttl)` | `access.cache` | Backed by `@eks/cache` (Redis in prod, in-memory in dev) |
| Read configuration | `ctx.config.get("key")` | — (always allowed) | From `ExtensionConfiguration` row |
| Read a secret | `ctx.secrets.get("STRIPE_KEY")` | `access.secrets` + secret name in `requiredSecrets` | Decrypted on-demand, never logged |
| Log a structured message | `ctx.logger.info/warn/error({...})` | — (always allowed) | Writes to `ExtensionLog`, scoped by installation |
| Emit a metric | `ctx.metrics.counter/gauge/histogram("name", …)` | — (always allowed) | Tagged with `extensionId`, `version`, `organizationId` |
| Start a span | `ctx.tracer.startSpan("name", fn)` | — (always allowed) | Parented to the inbound request span |
| Retry an operation | `ctx.retry.withBackoff(fn, opts)` | — (always allowed) | Wraps `@eks/common` exponential backoff |
| Act as the user (delegation) | `ctx.auth.asUser(userId, scopes)` | `invoke.apis` + `delegate.auth` | Returns a short-lived scoped Principal |

The SDK is **the only sanctioned surface**. Direct Prisma, Redis, `fs`, `net`, or `child_process` access is forbidden and blocked by the capability-gated module loader. See `SDK_GUIDE.md` for the full API and `SECURITY_MODEL.md` for the enforcement mechanism.

---

## 5. Request → Runtime → Sandbox → Extension Flow

The end-to-end flow for a single invocation of an extension API handler. The same shape (minus the HTTP ingress) applies to event deliveries, scheduled jobs, and workflow steps — they all enter the runtime via a typed `Invocation` and exit via an `InvocationResult`.

```
   HTTPS request
   POST /api/v1/extensions/loyalty-engine/route/redeem
   with __Host-eks.session cookie (M2 auth)
   + Idempotency-Key (POST)
   + X-Correlation-Id
 ──────────────────────────────────────────────────────────────────▶
                          │
                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Edge (Caddy) — M1                                            │
   │  • TLS 1.3 termination, HSTS, CSP, security headers          │
   │  • Rate limit (per IP+path)                                   │
   │  • Forward to Next.js                                        │
   └─────────────────────────────────────────────────────────────┘
                          │
                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  @eks/api/apiHandler — M1                                     │
   │  • newRequestContext() → correlationId, traceId              │
   │  • withRequestContext(als)                                   │
   │  • startSpan("http.server")                                  │
   │  • try/catch → RFC 7807 problem+json                         │
   └─────────────────────────────────────────────────────────────┘
                          │
                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  @eks/auth/middleware — M2                                    │
   │  • Verify __Host-eks.session cookie (HMAC, constant-time)    │
   │  • Resolve Session → User → active Membership                │
   │  • Build Principal { userId, orgId, roles, permissions }     │
   │  • withTenantContext(orgId)                                  │
   │  • CSRF double-submit check on POST                          │
   └─────────────────────────────────────────────────────────────┘
                          │  Principal + TenantContext in ALS
                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  @eks/authorization — M2                                      │
   │  authorize(principal, "extension.invoke",                    │
   │    { resource: "Extension",                                  │
   │      resourceId: "loyalty-engine",                           │
   │      tenantId: principal.activeTenantId })                   │
   │  • If deny → 403 + reason + audit("EXTENSION_INVOKE_DENIED") │
   └─────────────────────────────────────────────────────────────┘
                          │  authorized=true
                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  /api/v1/extensions/[slug]/route/[...path] — M3 route        │
   │  • Resolve slug → ExtensionInstallation                      │
   │    (where organizationId = tenant & status = ACTIVE)         │
   │  • If not found → 404                                        │
   │  • If suspended → 409 "Extension Suspended"                  │
   │  • Load activeVersionId → ExtensionVersion → Package         │
   │  • Idempotency-Key dedup (POST only)                         │
   └─────────────────────────────────────────────────────────────┘
                          │
                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  @eks/runtime — M3                                            │
   │  1. Acquire isolate from pool (warm) or cold-start a worker  │
   │     thread for (installationId, activeVersionId).            │
   │  2. Inject ExtensionContext:                                  │
   │       ctx = {                                                 │
   │         apis, events, storage, cache, config, logger,        │
   │         metrics, tracer, auth, secrets, retry,               │
   │         installation: { id, version, organizationId },       │
   │         invocation: { id, correlationId, traceId, deadline } │
   │       }                                                       │
   │  3. Invoke the registered handler with { body, query,        │
   │     headers, user (Principal), tenant } as arguments.        │
   │  4. Apply per-invocation quotas: CPU 200ms, heap 64MB,       │
   │     wall-clock 5s, outbound calls 10.                        │
   │  5. On ResourceLimitExceeded → 408 + ExtensionLog +          │
   │     RuntimeHealth.degraded = true.                            │
   │  6. On uncaught throw → 500 + ExtensionLog.error +           │
   │     increment extension.errors metric.                        │
   │  7. On success → return result; stream ctx.logger.* to       │
   │     ExtensionLog (buffered, flushed async).                  │
   └─────────────────────────────────────────────────────────────┘
                          │
                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  @eks/sdk ExtensionContext — M3 (inside the worker thread)   │
   │  Every capability call:                                       │
   │  • Permission-checked against manifest                        │
   │  • Metered against per-invocation quotas                     │
   │  • Audited for sensitive operations (secrets, auth.asUser)   │
   │  • Traced as a child span of the invocation span             │
   └─────────────────────────────────────────────────────────────┘
                          │
                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Extension code (third-party TypeScript)                     │
   │  export default defineExtension({                            │
   │    handlers: {                                               │
   │      redeem: async (req, ctx) => {                           │
   │        const points = await ctx.storage.get(                 │
   │          `points:${req.user.id}`);                           │
   │        if (points < req.body.cost) {                         │
   │          throw new BusinessRuleError("insufficient_points"); │
   │        }                                                     │
   │        await ctx.storage.set(`points:${req.user.id}`,        │
   │          points - req.body.cost);                            │
   │        await ctx.events.publish(                             │
   │          "loyalty.redeemed.v1",                              │
   │          { userId: req.user.id, cost: req.body.cost });      │
   │        return { ok: true, newBalance: points - req.body.cost }; │
   │      }                                                       │
   │    }                                                         │
   │  });                                                         │
   └─────────────────────────────────────────────────────────────┘
                          │
                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Response pipeline (back up the stack)                        │
   │  • @eks/runtime wraps result in success() envelope           │
   │  • @eks/api attaches x-request-id, x-correlation-id          │
   │  • @eks/observability emits http_requests_total{...},        │
   │    http_request_duration_ms, extension.invocations_total,    │
   │    extension.errors_total, extension.invocation_duration_ms  │
   │  • Outbox relay worker publishes any events the extension    │
   │    staged via ctx.events.publish (transactional with          │
   │    storage.set if both ran in the same SDK tx)               │
   └─────────────────────────────────────────────────────────────┘
```

---

## 6. Integration with M1 (Events / Outbox / Observability)

The Developer Platform is **not** a parallel system — it consumes and extends the M1 kernel at every layer. The contract is identical to the M2 IAM stack: domain events flow through the transactional outbox, metrics/traces/logs flow through `@eks/observability`, and feature flags are evaluated by `@eks/features`.

### 6.1 Event bus + transactional outbox

Every extension lifecycle transition and every `ctx.events.publish(...)` writes a domain event to the `EventOutbox` table in the **same Prisma transaction** as the state mutation. The M1 outbox relay worker then publishes to the `EventBus`, where M1, M2, and M3 subscribers react.

| Domain Event | Subscriber | Reaction |
|---|---|---|
| `extension.installed.v1` | `@eks/observability/audit` | Write `AuditLog` (action=`EXTENSION_INSTALLED`) |
| `extension.installed.v1` | `@eks/notifications` | Email the installing user "Extension installed" |
| `extension.activated.v1` | `@eks/runtime` (internal) | Warm the isolate pool for the installation |
| `extension.suspended.v1` | `@eks/runtime` (internal) | Evict the installation's isolate from the pool |
| `extension.upgraded.v1` | `@eks/observability/audit` | Write `AuditLog` (action=`EXTENSION_UPGRADED`) |
| `extension.upgraded.v1` | `@eks/runtime` (internal) | Evict + warm the new version |
| `extension.removed.v1` | `@eks/observability/audit` | Write `AuditLog` (action=`EXTENSION_REMOVED`) |
| `extension.invocation.failed.v1` | `@eks/observability/audit` | Write `AuditLog` (action=`EXTENSION_INVOKE_FAILED`) |
| `connector.executed.v1` | `@eks/observability/audit` | Write `AuditLog` (action=`CONNECTOR_EXECUTED`) |
| `workflow.started.v1` / `workflow.completed.v1` | `@eks/observability/audit` | Write `AuditLog` |
| `loyalty.redeemed.v1` (extension-published) | Developer Console (live updates via SSE) | Push toast to the operator UI |

Event envelopes use the M1 `DomainEvent` shape (`eventId`, `correlationId`, `causationId`, `traceId`, `actorUserId`, `organizationId`, `aggregateType`, `aggregateId`, `eventType`, `version: 1`, `tier: "domain"`; see `src/packages/events/types.ts`). Event names follow the `{Aggregate}.{PastTenseVerb}` convention from `src/packages/events/naming.ts`, with the dotted lowercase form (`extension.installed.v1`) used as the `eventType` literal for versioning — identical to the M2 identity convention.

### 6.2 Observability

The runtime exports the following Prometheus metrics (registered on the M1 `MetricsRegistry` singleton):

```
extension_invocations_total{extension_id,version,organization_id,kind,outcome}
extension_invocation_duration_ms{extension_id,version,organization_id,kind}    (histogram)
extension_errors_total{extension_id,version,organization_id,error_type}
extension_isolate_pool_size{extension_id,version,state}                         (warm, cold, evicted)
extension_isolate_pool_warmups_total{extension_id,version}
extension_storage_operations_total{extension_id,version,operation,outcome}
extension_event_deliveries_total{extension_id,version,event_type,outcome}
extension_outbound_calls_total{extension_id,version,target,domain,outcome}
connector_executions_total{connector_id,version,operation,outcome}
connector_sync_duration_ms{connector_id,version}                                (histogram)
workflow_executions_total{workflow_id,version,outcome}
workflow_step_duration_ms{workflow_id,version,step}                             (histogram)
```

Every extension invocation starts a child span of the inbound HTTP span, named `extension.invocation` with attributes `{extension.id, extension.version, extension.kind, invocation.id}`. Every capability call inside the extension (`ctx.storage.get`, `ctx.events.publish`, `ctx.apis.invoke`) is a grandchild span — the trace tree reconstructs the full execution without instrumenting the extension's own code.

### 6.3 Feature flags

Extension rollout is itself feature-flagged. Each `ExtensionInstallation` is gated by `@eks/features` flag `extension.<slug>.enabled`, which allows Eks-Food operators to kill-switch an extension per-tenant or globally without uninstalling it. Staged rollout (see `PUBLISHING_GUIDE.md`) is implemented as a feature-flag percentage rollout over `extension.<slug>.<version>.rollout`.

### 6.4 Cache

The `@eks/sdk` `ctx.cache` proxy is a thin wrapper over the M1 `@eks/cache` registry. In production it is backed by Redis (per-installation namespace: `ext:<installationId>:`); in development it is backed by the in-memory cache. Cache stampede protection (single-flight `getOrSet`) is inherited from M1.

### 6.5 Workers

The runtime publishes scheduled jobs (cron-declared handlers from the manifest) and event-replay jobs to the M1 `@eks/workers` queue. The `extensions.gc` worker (30-day retention sweep), `extensions.replay` worker (drives `EventReplay`), and `extensions.healthcheck` worker (calls each connector's `healthCheck` every 60s) are registered on the M1 scheduler.

---

## 7. Integration with M2 (Identity / Authorization / Tenancy)

The Developer Platform inherits the M2 IAM stack wholesale. There is **no parallel auth system** for extensions.

### 7.1 Authentication

Every `/api/v1/extensions/*`, `/api/v1/connectors/*`, `/api/v1/workflows/*` route runs through `@eks/auth/middleware`. The caller is authenticated by one of:

- **Interactive session** (`__Host-eks.session` cookie) — operators in the Developer Console.
- **API key** (header `Authorization: Bearer eks_live_…`) — partner systems calling extension routes programmatically. API keys are issued by the M2 `@eks/identity` ApiKeyAggregate (see `src/packages/domain/contexts/developer/aggregates.ts`) and scoped via `ApiScope`; the `extension.invoke` scope is required to call any extension route.
- **Extension-to-extension token** — when extension A calls `ctx.apis.invoke("ext:B", …)`, the runtime mints a short-lived (60s) internal token signed by `@eks/security/cookies` carrying `{ kind: "extension", sourceInstallationId, targetInstallationId, organizationId }`. This token is accepted **only** by the runtime's internal ingress, never by user-facing routes.

### 7.2 Authorization

Authorization uses the M2 `@eks/authorization` engine. The Principal (built from session or API key) is evaluated against:

| Action code | Resource | Required role (canonical) | Notes |
|---|---|---|---|
| `extension.install` | `Extension` | `OWNER`, `ADMIN` | Install into the tenant |
| `extension.invoke` | `Extension` | any member | Default; per-extension policies may restrict |
| `extension.manage` | `Extension` | `ADMIN` | Activate, suspend, upgrade, rollback, remove |
| `extension.publish` | `Extension` | `OWNER` (publisher-scoped) | Publish a new version |
| `connector.invoke` | `Connector` | any member | Execute a connector action |
| `connector.manage` | `Connector` | `ADMIN` | Configure credentials, enable/disable |
| `workflow.invoke` | `Workflow` | any member | Start a workflow |
| `workflow.manage` | `Workflow` | `ADMIN` | Create, update, disable |
| `extension.logs.read` | `Extension` | `ADMIN`, `SUPPORT` | Read `ExtensionLog` rows |
| `extension.events.replay` | `Extension` | `ADMIN` | Trigger an `EventReplay` |

These action codes are registered in the M2 `PERMISSIONS` registry (`src/packages/authorization/permissions.ts` extension) and follow the same `authorize(principal, action, resource)` flow as every other M2 permission. Denials produce explainable RFC 7807 `details` and an `AuditLog` row with action `AUTHZ_DENIED`.

### 7.3 Tenancy

Every tenant-scoped Prisma model added in M3 (`ExtensionInstallation`, `ExtensionConfiguration`, `ConnectorConfiguration`, `WorkflowDefinition`, `WorkflowExecution`, `EventReplay`, `Secret`, `ExtensionLog`, `RuntimeHealth`) carries `organizationId String @default(...)` plus `@@index([organizationId])` — the same convention as M2. Repositories in `@eks/registry`, `@eks/connector-sdk`, `@eks/workflow` extend the M2 `TenantScopedRepository` base class, and the active `organizationId` is read from the M2 `TenantContext` (set by `@eks/auth/middleware`).

Platform-published extensions (`Publisher.kind = "platform"`) bypass per-tenant scoping: a single `Extension` row is visible to all tenants, but each tenant still has its own `ExtensionInstallation` row, its own `ExtensionConfiguration`, its own `ExtensionStorage`, and its own secrets. The extension code is shared; the data is not.

---

## 8. How Thousands of Extensions Scale

The single hardest scaling question for any extension platform is: *how do you run 10,000 installed extensions without running 10,000 processes?* Eks-Food's answer has four parts.

### 8.1 Isolate pool, not process-per-extension

The runtime maintains a **bounded pool of warm worker threads per `(extensionId, versionId)` pair**, sized by recent traffic. An installation that hasn't been invoked in 15 minutes has zero warm workers; the next request cold-starts one (typically 80–150ms). An installation receiving sustained traffic grows its pool up to a per-installation cap (default 4) and a global cap (default 256 across all installations on a single host).

Cold-start cost is mitigated by:
- **Bundle pre-compilation.** The published `Package` is a pre-bundled ESM module (esbuild, tree-shaken, minified). The runtime `import()`s the bundle; there is no on-host TypeScript compilation.
- **Lazy context materialisation.** The `ExtensionContext` proxies are created eagerly but their backing clients (storage repo, cache client, tracer) are created lazily on first use. An extension that only calls `ctx.logger.info` pays nothing for `ctx.secrets` initialisation.
- **Snapshot restore (M3.1).** Experimental: after the first cold start, the worker's V8 heap is snapshotted; subsequent cold starts `worker_threads` from the snapshot, reducing cold-start to ~20ms. Off by default in M3.

### 8.2 Event-driven, not polling

Extensions do **not** poll. The only entry points are:
1. Inbound HTTP request to a registered route.
2. Domain event delivery (the runtime's subscriber, not the extension's).
3. Scheduled job (cron declared in the manifest, dispatched by the M1 worker scheduler).
4. Workflow step (the workflow engine invoking a step the extension registered).

Between events, the installation consumes zero CPU. A tenant with 200 installed extensions of which 5 are actively serving traffic runs 5 warm worker pools, not 200.

### 8.3 Storage is shared, not dedicated

The `ExtensionStorage` model is a single Prisma table with `(installationId, organizationId, key)` indexing. There is no per-extension schema migration, no per-extension database, no per-extension connection pool. The storage proxy is a thin repository that reuses the host's Prisma client — 200 installed extensions share one connection pool, not 200.

### 8.4 Multi-tenant co-location

A single Eks-Food host serves many tenants. The runtime's isolate pool is keyed by `(installationId, versionId)`, where `installationId` is unique per tenant — so two tenants running the same extension version have separate pools (tenancy isolation) but share the same compiled `Package` bytes (memory efficiency, since the V8 code cache is keyed by the bundle hash).

### 8.5 Capacity envelope (per host)

The platform's default capacity envelope on a `c6i.4xlarge` (16 vCPU, 32GB) host:

| Resource | Limit |
|---|---|
| Concurrent warm worker threads | 256 |
| Cold-starts per second | 100 |
| Inbound invocations per second | 2,000 |
| Event deliveries per second | 10,000 |
| Storage operations per second | 8,000 |
| Outbound calls per second (egress proxy) | 1,000 |
| Heap across all workers | 24 GB (8 GB reserved for host) |

Beyond this envelope, the runtime returns `503 Service Unavailable` with `Retry-After` and the M1 `@eks/api` rate limiter queues the request. Horizontal scaling is handled by the M1 deployment topology (Caddy → N instances behind a load balancer); the runtime is stateless and shares nothing between instances except the Postgres database and Redis cache.

---

## 9. Cross-References

| Topic | Document |
|---|---|
| `@eks/sdk` ExtensionContext API and code examples | `SDK_GUIDE.md` |
| `@eks/connector-sdk` Connector interface | `CONNECTOR_SDK_GUIDE.md` |
| Manifest schema, project structure, hello world | `EXTENSION_AUTHORING.md` |
| Packaging, integrity, signing | `PACKAGING_GUIDE.md` |
| Publishing pipeline, rollout, rollback | `PUBLISHING_GUIDE.md` |
| Runtime internals, sandbox, isolation boundaries | `RUNTIME_ARCHITECTURE.md` |
| Signing, permissions, secrets, audit | `SECURITY_MODEL.md` |
| Capability-based permission registry | `PERMISSION_MODEL.md` |
| `@eks/dev-cli` command reference | `CLI_GUIDE.md` |
| 30/60/90 onboarding | `DEVELOPER_ONBOARDING.md` |
| M1 event/outbox/observability | `docs/EVENT_CONVENTIONS.md`, `docs/ARCHITECTURE.md` |
| M2 IAM | `docs/identity/ARCHITECTURE.md`, `docs/identity/AUTHORIZATION_POLICIES.md`, `docs/identity/MULTI_TENANCY.md` |
