# Eks-Food Extension Runtime — `@eks/runtime`

> **Audience:** Platform engineers and on-call developer-platform maintainers. Read alongside `ARCHITECTURE.md` (the platform-level overview), `SDK_GUIDE.md` (the `ExtensionContext` surface), `SECURITY_MODEL.md` (sandbox enforcement), and `PERMISSION_MODEL.md` (capability checks).
>
> **Status:** Milestone 3. The `@eks/runtime` package is the host-side component that loads, isolates, executes, and supervises extensions. It owns the lifecycle state machine, the isolate pool, the capability-gated module loader, the per-invocation resource limits, and the health-reporting loop. This document specifies the runtime's internals: how an invocation flows from the ingress route to the worker thread and back, what isolation boundaries are enforced, and how one extension cannot crash another.

---

## 1. Runtime responsibilities

The runtime is responsible for **six** concerns, and only these six:

1. **Lifecycle management** — install, activate, suspend, upgrade, rollback, remove. Each transition is atomic, audited, and persisted to `ExtensionInstallation`. See §3.
2. **Dependency injection** — materialise the `ExtensionContext` for each invocation, with the correct `installationId`, `organizationId`, Principal, and per-invocation quotas. See §4.
3. **Capability registration** — collect the route handlers, event subscribers, workflow steps, and scheduled jobs the extension registered in `setup()`, and freeze the registry when `setup()` returns. See §5.
4. **Startup validation** — before the first invocation, verify the package's integrity, the manifest's permissions, and the manifest's compatibility ranges. See §6.
5. **Graceful shutdown** — on SIGTERM or evict-from-pool, drain in-flight invocations, call the extension's `shutdown()` hook, and exit the worker thread cleanly. See §7.
6. **Health reporting** — every 10s, write a `RuntimeHealth` row with isolate-pool state, error counts, and resource usage. The M1 `HealthRegistry` surfaces this at `/api/v1/health/ready`. See §8.

The runtime is **not** responsible for:
- Authentication (handled by M2 `@eks/auth/middleware` before the runtime sees the request).
- Authorization (handled by M2 `@eks/authorization` before the runtime sees the request).
- Tenancy enforcement (handled by M2 `TenantContext` + `TenantScopedRepository` for every `ExtensionStorage`, `ExtensionLog`, etc. write).
- Event delivery (handled by M1 `EventBus`; the runtime is a subscriber, not a publisher of system events).
- Package storage (handled by `@eks/registry`; the runtime reads from the content-addressed package cache).

This separation is what lets the runtime be stateless and horizontally scalable: every runtime instance can serve every extension for every tenant, because all the state is in Postgres + the package cache.

---

## 2. Process topology

```
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js host process (Node.js 20)                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  @eks/api/apiHandler                                          │   │
│  │  @eks/auth/middleware                                         │   │
│  │  @eks/authorization                                           │   │
│  │  /api/v1/extensions/[slug]/route/[...path]  → runtime.invoke  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                │                                     │
│                                ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  @eks/runtime — Runtime singleton                             │   │
│  │  • IsolatePool (per (installationId, versionId))              │   │
│  │  • PackageCache (content-addressed, /var/lib/eks/packages)    │   │
│  │  • InvocationQueue (in-process; bounded)                      │   │
│  │  • HealthReporter (10s tick → RuntimeHealth)                  │   │
│  │  • ScheduledJobDispatcher (cron → invocation)                 │   │
│  │  • EventDeliveryDispatcher (EventBus subscriber → invocation) │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │           │            │              │                    │
│         ▼           ▼            ▼              ▼                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐  ┌────────────────────┐   │
│  │ worker_1 │ │ worker_2 │ │ worker_3 │  │ worker_N (≤256)    │   │
│  │ thread   │ │ thread   │ │ thread   │  │ thread             │   │
│  │          │ │          │ │          │  │                    │   │
│  │ ext:     │ │ ext:     │ │ ext:     │  │ ext: ...           │   │
│  │ loyalty  │ │ acme-pos │ │ booking  │  │                    │   │
│  │ @1.0.0   │ │ @2.3.1   │ │ @0.9.4   │  │                    │   │
│  │ (org_A)  │ │ (org_A)  │ │ (org_B)  │  │                    │   │
│  │          │ │          │ │          │  │                    │   │
│  │  ↓ ctx   │ │  ↓ ctx   │ │  ↓ ctx   │  │  ↓ ctx             │   │
│  │  (SDK    │ │  (SDK    │ │  (SDK    │  │  (SDK              │   │
│  │  proxy)  │ │  proxy)  │ │  proxy)  │  │  proxy)            │   │
│  └──────────┘ └──────────┘ └──────────┘  └────────────────────┘   │
│         │           │            │              │                    │
│         └─────┬─────┴─────┬──────┴──────────────┘                  │
│               ▼           ▼                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Shared Prisma client (M1)                                    │   │
│  │  Shared @eks/cache (Redis in prod)                            │   │
│  │  Shared @eks/observability (Logger, Metrics, Tracer)          │   │
│  │  Shared @eks/events (EventBus + Outbox)                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

Each worker thread is a dedicated Node.js `worker_threads` instance. The worker holds:
- The compiled `index.mjs` bundle for one specific `(extensionId, versionId)` pair.
- A reference to the shared Prisma client, cache, observability, and events singletons (passed via `worker_threads` `MessagePort`, not re-created per worker).
- A per-worker `ExtensionContext` factory that materialises a fresh context per invocation.

The host process owns the IsolatePool — a bounded LRU of warm workers keyed by `(installationId, versionId)`. Pool sizing is configurable via `EKS_RUNTIME_POOL_MAX_WORKERS` (default 256) and `EKS_RUNTIME_POOL_MAX_PER_INSTALLATION` (default 4).

---

## 3. Lifecycle management

The lifecycle state machine is documented in `ARCHITECTURE.md` §3. This section documents the runtime's internal handling of each transition.

### 3.1 Install

```
POST /api/v1/extensions/:slug/install
  ↓
@eks/registry.installExtension(slug, version, organizationId, actorUserId)
  ↓
1. Verify the .ekx (see PACKAGING_GUIDE.md §5)
2. Verify the tenant's admin has extension.install permission (M2)
3. Verify the manifest's permissions are a subset of what the tenant has
   granted (operator approval flow; see PERMISSION_MODEL.md §4)
4. Create ExtensionInstallation row (status = PENDING)
5. Stage Extension.Installed.v1 to EventOutbox in the same tx
6. Commit
  ↓
EventBus delivers Extension.Installed.v1 to:
  • @eks/runtime (internal subscriber) → warm the isolate pool
  • @eks/notifications → email the installing user
  • @eks/observability/audit → AuditLog(EXTENSION_INSTALLED)
```

Every event staged in step 5 is built with `buildDeveloperEvent(name, aggregateId, payload, meta?)` from the `@eks/developer` package — the only sanctioned factory for developer-platform domain events. The `name` argument is one of the 19 keys of `DEVELOPER_EVENTS` (e.g. `"ExtensionInstalled"`, `"ExtensionUpgraded"`, `"ConnectorExecuted"`, `"WorkflowStarted"`), the factory resolves it to the canonical `{Aggregate}.{PastTenseVerb}` wire string, parses the `aggregateType` from the prefix, and stamps `tier = "domain"`, `version = 1`, a fresh `eventId`, and the ambient `correlationId` / `causationId` / `traceId` / `actorUserId` / `organizationId` from `requestContext()`. The runtime never spells out the literal `"Extension.Installed"` — it passes `"ExtensionInstalled"` and the registry does the rest, so a typo is a compile error rather than a silently broken subscriber. The matching `DEVELOPER_AUDIT_ACTIONS` code (`"EXTENSION_INSTALLED"`) is written to `AuditLog.action` by the same handler — the audit code is the actor-side counterpart of the event, and the two registries are designed to be used together.

The runtime's subscriber on `Extension.Installed.v1` triggers an **eager cold-start**: it spawns a worker for the installation, runs `setup()`, and verifies that no capability registration errors occurred. If `setup()` throws, the installation is auto-suspended with `reason = "setup_failed"` and the error is written to `ExtensionLog`.

### 3.2 Activate

Activation transitions `PENDING → ACTIVE`. The runtime:
1. Verifies `setup()` completed successfully on the eager cold-start.
2. Verifies all `requiredSecrets` have values in the `Secret` table for this `(organizationId, installationId)`.
3. Verifies all `connectorDependencies` are installed and ACTIVE in this tenant.
4. Sets `ExtensionInstallation.status = ACTIVE` and `activatedAt = now()`.
5. Stages `Extension.Activated.v1` to the outbox.
6. The isolate pool is now eligible to receive invocations.

### 3.3 Suspend

Suspension transitions `ACTIVE → SUSPENDED`. It can be triggered by:
- Operator action (`POST /api/v1/extensions/:id/suspend`).
- Health-check failure (3 consecutive unhealthy `healthCheck` results — connectors only).
- Resource-limit breach (a worker that exceeded its heap limit 5 times in 10 minutes).
- Security incident (platform team only; sets `ExtensionInstallation.status = SUSPENDED` with `reason = "security_incident_<case_id>"`).

The runtime's suspension handler:
1. Marks the installation's isolate pool as "draining" — no new invocations are accepted; existing in-flight invocations are allowed to complete (up to the invocation deadline).
2. After drain (or 5s timeout), terminates all worker threads in the pool.
3. Sets `ExtensionInstallation.status = SUSPENDED`, `suspendedAt`, `suspendedReason`.
4. Stages `Extension.Suspended.v1` to the outbox.

Subsequent invocations return `409 Extension Suspended` with a problem+json body explaining the reason.

### 3.4 Upgrade

Upgrade transitions `ACTIVE → UPGRADING → ACTIVE` (new version) or `UPGRADING → ACTIVE` (previous version, on rollback).

```
POST /api/v1/extensions/:id/upgrade
  body: { "toVersion": "1.2.0" }
  ↓
1. Verify the target version is PUBLISHED for this extension.
2. Verify the target version's compatibilityRanges are satisfied by
   the current platform version.
3. Verify the target version's permissions are a subset of what the
   tenant has already granted (or initiate a re-approval flow if the
   new version requires additional permissions).
4. Set ExtensionInstallation.status = UPGRADING, activeVersionId = toVersion,
   previousVersionId = (the old activeVersionId).
5. Stage Extension.Upgraded.v1 to the outbox in the same tx.
6. Commit.
  ↓
EventBus delivers Extension.Upgraded.v1 to @eks/runtime:
  1. Evict the installation's isolate pool (terminate all workers).
  2. Eager cold-start a new worker for (installationId, toVersion).
  3. Run setup() on the new worker.
  4. If setup() succeeds: set ExtensionInstallation.status = ACTIVE.
  5. If setup() fails: auto-rollback to previousVersionId (see §3.5).
```

### 3.5 Rollback

Rollback can be automatic (setup failure on upgrade) or manual (operator action).

Automatic rollback (inside the upgrade flow):
1. The new worker's `setup()` throws.
2. The runtime sets `activeVersionId = previousVersionId`, leaving `previousVersionId` unchanged (so a future upgrade can still roll back to the version that just failed).
3. Sets `ExtensionInstallation.status = ACTIVE` (not `UPGRADING` — the rollback is complete).
4. Stages `Extension.RolledBack.v1` with `reason = "setup_failed"`.
5. Eager cold-starts a worker for `previousVersionId`.

Manual rollback (`POST /api/v1/extensions/:id/rollback`):
1. Verify the target version is PUBLISHED (or was PUBLISHED before being deprecated — deprecated versions can be rolled back to).
2. Set `previousVersionId = activeVersionId`, `activeVersionId = targetVersion`.
3. Stage `Extension.RolledBack.v1` with `reason = "manual"`, `actorUserId`.
4. Evict + warm the pool.

### 3.6 Remove

Removal is soft — `ExtensionInstallation.deletedAt` is set; the row is retained for 30 days for audit reconstruction, then purged by the `extensions.gc` worker (registered on the M1 `@eks/workers` scheduler).

The runtime's removal handler:
1. Evicts the isolate pool (terminate all workers).
2. Deletes the installation's `ExtensionStorage` rows immediately (storage is owned by the installation, not the tenant).
3. Deletes the installation's `ExtensionLog` rows after 30 days (retained for the audit window).
4. Sets `ExtensionInstallation.deletedAt = now()`, `status = REMOVED`.
5. Stages `Extension.Removed.v1` to the outbox.

The `Secret` rows scoped to this installation are deleted immediately (rotated out of the keystore). The `ConnectorConfiguration` rows scoped to this installation are deleted immediately (a removed connector loses its credentials instantly).

---

## 4. Dependency injection — the `ExtensionContext`

The runtime materialises a fresh `ExtensionContext` per invocation. The context is the **only** surface the extension sees; everything else (Prisma, Redis, `fs`, `net`) is unreachable.

```typescript
// Inside the runtime, per invocation:
function materialiseContext(
  installation: ExtensionInstallation,
  version: ExtensionVersion,
  invocation: InvocationDescriptor,
  principal: Principal | null,
): ExtensionContext {
  const sdkProxy = createSdkProxy({
    installation,
    version,
    invocation,
    principal,
    // Each capability is a permission-checked proxy:
    apis: createApisProxy({ installation, manifest: version.manifest }),
    events: createEventsProxy({ installation, manifest: version.manifest }),
    storage: createStorageProxy({ installation }),
    cache: createCacheProxy({ installation }),
    config: createConfigProxy({ installation }),
    logger: createLoggerProxy({ installation, invocation }),
    metrics: createMetricsProxy({ installation, version }),
    tracer: createTracerProxy({ invocation }),
    auth: createAuthProxy({ installation, invocation }),
    secrets: createSecretsProxy({ installation, manifest: version.manifest }),
    retry: createRetryProxy({ invocation }),
    features: createFeaturesProxy({ installation }),
  });
  return sdkProxy;
}
```

Each proxy is a thin shim over a platform service that:
1. Checks the manifest's declared permissions (e.g. `ctx.storage.set` requires `access.storage`).
2. Checks the per-invocation quotas (e.g. `ctx.storage.set` decrements `invocation.quota.storageOps`).
3. Opens a child span on the invocation's tracer.
4. Delegates to the platform service.
5. Records the call to `ExtensionLog` (at debug level) for audit reconstruction.

The proxies are **immutable** — the extension cannot replace `ctx.storage` with a fake, cannot add a new property to `ctx`, and cannot reach the underlying platform services through prototype-chain walks. The `createSdkProxy` function uses `Object.freeze` and a `Proxy` with a `get` trap that whitelists the known capability names; everything else returns `undefined`.

---

## 5. Capability registration

The extension calls `ctx.apis.register`, `ctx.events.subscribe`, `ctx.apis.registerStep`, `ctx.scheduled.register` inside `setup()`. The runtime collects these registrations in a per-worker `CapabilityRegistry`:

```typescript
interface CapabilityRegistry {
  routes: Map<string, RouteHandler>;                  // route name → handler
  subscribers: Map<string, Subscriber>;               // event type → handler
  steps: Map<string, StepHandler>;                    // step name → handler
  scheduled: Map<string, ScheduledJobHandler>;        // job name → handler
  freeze(): void;                                     // called after setup() returns
  isFrozen: boolean;
}
```

After `setup()` returns, the runtime calls `freeze()`. Any subsequent attempt to register a capability throws `CapabilityRegistrationClosedError`. This is a defensive measure against extensions that try to register handlers lazily inside other handlers (which would make the capability surface non-deterministic and break cold-start reproducibility).

The runtime also validates that:
- Every `route` name is unique (no duplicates).
- Every `event type` subscribed to is in the manifest's `requiredEvents`.
- Every `step` name is unique.
- Every `scheduled` job name matches a `name` in `manifest.scheduledJobs`.

A failure in any of these checks aborts `setup()` and triggers an automatic rollback (see §3.5).

---

## 6. Startup validation

Before the first invocation, the runtime performs startup validation:

1. **Package integrity.** Re-verify the SHA-256 of the `.ekx` file against `Package.sha256`. (This is a defence-in-depth check; the registry already verified it at install time.)
2. **Signature verification.** Re-verify the Ed25519 signature over `integrity.json` against `Publisher.signingPublicKey`. (Also defence-in-depth.)
3. **Per-file integrity.** For each file in `integrity.json.files`, compute its SHA-256 and compare. (Defence-in-depth against a corrupted package cache.)
4. **Manifest validation.** Re-validate the manifest against the schema.
5. **Permission validation.** Verify every permission in `manifest.permissions` is a known permission code.
6. **Compatibility validation.** Verify `manifest.compatibilityRanges.eks-platform` is satisfied by the current platform version.
7. **Lockfile validation.** Verify the lockfile has no forbidden packages.
8. **Capability declaration validation.** Verify every `requiredEvent` is a known event type. Verify every `requiredAPI` is a known API action. Verify every `requiredSecret` is in the `Secret` table for this `(organizationId, installationId)`.
9. **Resource-limit validation.** Verify `manifest.limits` does not exceed the platform's per-plan maximums (e.g. an extension cannot declare `cpuMs: 100000` on the standard plan).

A failure in any check prevents the worker from accepting invocations. The runtime sets `ExtensionInstallation.status = SUSPENDED` with `reason = "startup_validation_failed"` and writes the failure detail to `ExtensionLog`.

---

## 7. Graceful shutdown

The runtime receives a shutdown signal in three scenarios:

1. **SIGTERM** to the host process (deployment, scaling event).
2. **Evict from pool** — the IsolatePool LRU evicts the worker to make room for a more active installation.
3. **Installation suspended or removed** — the runtime explicitly terminates the worker.

In all three cases, the runtime:
1. Marks the worker as "draining" — no new invocations are dispatched to it.
2. Waits for in-flight invocations to complete, up to `EKS_RUNTIME_DRAIN_TIMEOUT_MS` (default 5_000ms).
3. Calls the extension's `shutdown(ctx)` hook with a fresh context. The hook has 5 seconds to flush buffers and close connections.
4. After `shutdown()` returns (or the 5s timeout), terminates the worker thread via `worker.terminate()`.
5. Records the shutdown to `ExtensionLog` and updates `RuntimeHealth`.

If the worker does not respond to `terminate()` within 1s (a stuck worker), the runtime uses `worker.terminate({ force: true })` (which corresponds to `SIGKILL` on the underlying thread). This is the last-resort escape hatch; it does not run `shutdown()` and may leak resources. The runtime counts forced terminations per installation; three in 24 hours auto-suspend the installation.

---

## 8. Health reporting

Every 10 seconds, each runtime instance writes a `RuntimeHealth` row:

```prisma
model RuntimeHealth {
  id                String   @id @default(cuid())
  runtimeInstanceId String                  // unique per host process
  hostName          String
  // ─── Pool state ─────────────────────────────────────────────────
  poolSize          Int                     // current warm worker count
  poolCapacity      Int                     // EKS_RUNTIME_POOL_MAX_WORKERS
  coldStartsTotal   Int                     // cumulative since runtime start
  evictionsTotal    Int                     // cumulative
  // ─── Invocation state (last 10s window) ────────────────────────
  invocationsTotal  Int
  invocationsP50Ms  Int
  invocationsP99Ms  Int
  errorsTotal       Int
  resourceLimitBreachesTotal Int
  // ─── Memory ────────────────────────────────────────────────────
  heapUsedMB        Float
  heapCapacityMB    Float
  rssMB             Float
  // ─── Status ────────────────────────────────────────────────────
  status            String                  // healthy | degraded | unhealthy
  degradedReasons   String[]
  // ─── Timestamps ────────────────────────────────────────────────
  reportedAt        DateTime @default(now())

  @@index([runtimeInstanceId, reportedAt])
  @@index([status])
}
```

The M1 `HealthRegistry` reads the latest `RuntimeHealth` row for each `runtimeInstanceId` and surfaces it at `/api/v1/health/ready`. A runtime is **degraded** if:
- `errorsTotal / invocationsTotal > 0.05` (5% error rate).
- `coldStartsTotal > 100` in the 10s window (excessive cold-start churn).
- `heapUsedMB / heapCapacityMB > 0.9` (imminent OOM).

A runtime is **unhealthy** if:
- No `RuntimeHealth` row has been written in the last 30s (the reporter thread is stuck).
- `resourceLimitBreachesTotal > 50` in the 10s window (a runaway extension).
- `status` was `unhealthy` on the previous tick and the degradation has not cleared.

The load balancer (Caddy) routes traffic only to `healthy` and `degraded` instances; `unhealthy` instances are drained.

---

## 9. The sandbox — isolation boundaries

This section documents the four isolation layers introduced in `ARCHITECTURE.md` §4 from the runtime's internal perspective.

### 9.1 Process isolation (worker_threads)

Each extension runs in a dedicated `worker_threads` instance. The worker:
- Has its own V8 heap (separate from the host).
- Has its own event loop (a stuck `Promise` in the worker does not block the host).
- Has its own `resourceLimits` (configured per the manifest's `limits`):

```typescript
const worker = new Worker(bundleUrl, {
  workerData: { installation, version, invocation, principal, capabilityRegistryPort },
  resourceLimits: {
    maxOldGenerationSizeMb: manifest.limits.heapMB,    // default 64
    maxYoungGenerationSizeMb: Math.floor(manifest.limits.heapMB / 4),
    codeRangeSizeMb: 16,
    stackSizeMb: 4,
  },
  eval: false,
  execArgv: ["--no-warnings", "--expose-gc"],
});
```

A `SIGSEGV` in the worker (e.g. a bug in a native module that slipped past the lockfile check) does not crash the host. The host listens for the worker's `error` event, logs it to `ExtensionLog`, marks the installation as `DEGRADED` in `RuntimeHealth`, and restarts the worker on the next invocation (cold-start).

### 9.2 Capability gating (the module loader)

The worker's module loader is a custom `load` hook (Node.js `module.register`) that whitelists only the modules in the package's lockfile plus the platform-provided `@eks/sdk`. Any `import "node:fs"` or `import "ioredis"` throws `ModuleNotFoundError`:

```typescript
// @eks/runtime/module-loader.ts
import { register } from "node:module";

register("./module-loader-worker.mjs", import.meta.url, {
  data: { lockfile, allowedExternals: ["@eks/sdk", "@eks/connector-sdk"] },
});

// In the worker:
export async function load(url, context, nextLoad) {
  if (url.startsWith("node:") || url.startsWith("internal:")) {
    if (isAllowedNodeBuiltin(url)) return nextLoad(url, context);
    throw new ModuleNotFoundError(`forbidden module: ${url}`);
  }
  if (isExternalPackage(url, lockfile)) {
    if (isForbiddenPackage(url, lockfile)) {
      throw new ModuleNotFoundError(`forbidden package: ${url}`);
    }
    return nextLoad(url, context);
  }
  return nextLoad(url, context);
}
```

The allow-list of `node:` built-ins is minimal: `node:crypto` (the pure-JS subset), `node:url`, `node:util`. Everything else (`node:fs`, `node:net`, `node:child_process`, `node:worker_threads`, `node:vm`, etc.) is forbidden.

### 9.3 Resource limits (per invocation)

Every invocation is bounded by:

| Limit | Default | How enforced |
|---|---|---|
| CPU time | 200ms | `worker.resourceLimits.maxOldGenerationSizeMb` + a CPU-time accounting timer in the host |
| Wall-clock | 5000ms | `setTimeout` in the host; on expiry, the worker is terminated with `worker.terminate({ force: false })` and a `DeadlineExceededError` is returned |
| Heap | 64MB | `worker.resourceLimits.maxOldGenerationSizeMb` — V8 aborts the worker with an OOM |
| Outbound calls | 10 | A counter in the `ctx.apis.request` / `ctx.apis.fetch` / `ctx.apis.invoke` proxy; breach throws `ResourceLimitExceeded` |
| Storage ops | 50 | A counter in the `ctx.storage` proxy; breach throws `ResourceLimitExceeded` |
| Event publishes | 5 | A counter in the `ctx.events.publish` proxy; breach throws `ResourceLimitExceeded` |

When a limit is breached:
1. The current invocation is aborted.
2. The worker is **not** terminated (the limit is per-invocation, not per-worker).
3. The error is written to `ExtensionLog` with `level = warn`.
4. `RuntimeHealth.resourceLimitBreachesTotal` is incremented.
5. If a single worker breaches limits 5 times in 10 minutes, the worker is terminated and a fresh one is spawned (defence against a leaked resource).

### 9.4 Network policy (egress allowlist)

The worker has **no direct network access**. The V8 isolate does not see `globalThis.fetch`; the only way to make an outbound call is via `ctx.apis.request`, `ctx.apis.fetch`, or `ctx.apis.invoke`. Each of these:
1. Validates the URL against `manifest.allowedDomains`.
2. Forwards the request to the host process via the `MessagePort`.
3. The host process applies the platform's egress proxy (which enforces authentication, rate limiting, and audit logging).
4. The response is sent back to the worker via the `MessagePort`.

The egress proxy logs every outbound call to `ExtensionLog` and `AuditLog`:

```
{
  "action": "EXTENSION_EGRESS",
  "installationId": "inst_abc",
  "method": "POST",
  "url": "https://api.stripe.com/v1/charges",
  "status": 200,
  "durationMs": 234,
  "requestSizeBytes": 1024,
  "responseSizeBytes": 567,
  "actorUserId": "u_xyz"
}
```

This is what makes connectors and direct `ctx.apis.request` calls equivalent from an audit perspective — both go through the same egress proxy.

---

## 10. How one extension cannot crash another

The four isolation layers in §9 guarantee that a fault in one extension does not affect another. Concretely:

1. **Process isolation.** A `SIGSEGV` in worker A terminates worker A only. Worker B (running a different extension) is unaffected. The host process is unaffected. New invocations for worker A's extension cold-start a fresh worker.
2. **Capability gating.** An extension cannot reach another extension's storage, cache, or secrets — the proxies are scoped to the installation. There is no `ctx.otherExtensions` API; cross-extension calls go through `ctx.apis.invoke` which is audited and authorized against the target installation.
3. **Resource limits.** A runaway extension that breaches its CPU/heap/call limits is aborted at the invocation level. The host's CPU and heap are unaffected (the worker's V8 heap is a separate allocation). The host's overall capacity is protected by `EKS_RUNTIME_POOL_MAX_WORKERS` — even if all workers are saturated, the host rejects new invocations with `503` rather than running out of memory.
4. **Network policy.** An extension cannot cause another extension's outbound call to fail. The egress proxy is shared, but per-installation rate limits ensure fairness — a noisy extension cannot starve a quiet one.

The one shared resource that extensions contend for is the **Prisma connection pool**. A misbehaving extension that holds a long-running transaction can starve other extensions' storage operations. The runtime mitigates this by:
- A per-invocation storage-op count limit (default 50).
- A per-invocation storage-transaction timeout (default 5s — the same as the wall-clock limit).
- The Prisma client's `statement_timeout` is set to 2s, so a single slow query cannot block the pool.

In practice, these mitigations are sufficient — the storage proxy's per-invocation quotas prevent any single extension from dominating the pool.

---

## 11. Isolate pool sizing and eviction

The IsolatePool is an LRU cache of warm workers:

- **Key:** `(installationId, versionId)`.
- **Capacity:** `EKS_RUNTIME_POOL_MAX_WORKERS` (default 256) globally, `EKS_RUNTIME_POOL_MAX_PER_INSTALLATION` (default 4) per installation.
- **Eviction:** LRU when the global pool is full and a new installation needs a worker. Evicted workers go through the graceful-shutdown flow (§7).
- **Idle timeout:** A worker that has not been invoked in 15 minutes is evicted even if the pool is not full (frees memory).

The pool's warm/cold ratio is observable at:

```
extension_isolate_pool_size{extension_id,version,state="warm"}
extension_isolate_pool_size{extension_id,version,state="cold"}
extension_isolate_pool_size{extension_id,version,state="evicted"}
extension_isolate_pool_warmups_total{extension_id,version}
```

A high `evicted` count relative to `warm` indicates pool churn — typically a sign that the global capacity is too low for the tenant mix. The platform team can bump `EKS_RUNTIME_POOL_MAX_WORKERS` per host.

---

## 12. Cross-references

| Topic | Document |
|---|---|
| Platform architecture & sandbox model | `ARCHITECTURE.md` |
| `@eks/sdk` ExtensionContext | `SDK_GUIDE.md` |
| Lifecycle state machine | `ARCHITECTURE.md` §3 |
| Sandbox enforcement | `SECURITY_MODEL.md` §3 |
| Per-invocation quotas | `SDK_GUIDE.md` §15 |
| Health registry (M1) | `docs/ARCHITECTURE.md` |
| M1 worker scheduler (`extensions.gc`, `extensions.healthcheck`) | `docs/ARCHITECTURE.md` |
| M2 Principal + tenancy | `docs/identity/ARCHITECTURE.md` |
| `ExtensionInstallation` model | `EXTENSION_AUTHORING.md` §3 |
| `eks logs`, `eks install` | `CLI_GUIDE.md` |
