# Eks-Food Platform SDK — `@eks/sdk`

> **Audience:** Extension authors. Read alongside `ARCHITECTURE.md` (platform overview), `EXTENSION_AUTHORING.md` (project structure), `PERMISSION_MODEL.md` (capability codes), and `CLI_GUIDE.md` (local development).
>
> **Status:** Milestone 3. The `@eks/sdk` package is the **only sanctioned surface** for an extension to reach platform capabilities. Direct access to Prisma, Redis, the file system, the network, `process.env`, or any internal `@eks/*` package other than `@eks/sdk` is forbidden and blocked at the sandbox layer (see `SECURITY_MODEL.md`).

---

## 1. Why an SDK at all?

Eks-Food runs third-party code inside the same process tree as customer payment data. That is only safe if the third-party code can reach the outside world through a **narrow, audited, permission-checked surface**. The `@eks/sdk` `ExtensionContext` is that surface.

The SDK contract has three properties that make this safe:

1. **It is the entire reachable surface.** The sandbox's capability-gated module loader exposes only `@eks/sdk` to extension code. `require`, `import`, `globalThis.process`, `globalThis.fs`, and friends are not present. An extension that tries to `import { PrismaClient } from "@prisma/client"` receives a `ModuleNotFoundError` at runtime, not a database connection.
2. **Every method is permission-checked.** Each call on the context is intercepted by a proxy that compares the manifest's declared permissions (`ExtensionManifest.permissions`) and required APIs (`ExtensionManifest.requiredAPIs`) against the call being made. A call that the manifest does not declare throws `ForbiddenError` *before* any side effect occurs.
3. **Every method is metered, traced, and audited.** Each call increments a per-invocation counter, opens a child span on the inbound trace, and — for sensitive operations (`secrets.get`, `auth.asUser`, `apis.invoke`) — writes an `AuditLog` row. There is no "off the books" path.

---

## 2. The `ExtensionContext` surface

Every extension entrypoint receives an `ExtensionContext` as its second argument. The first argument is the inbound message (HTTP request, event, scheduled trigger, or workflow step). The shape of the context is identical across invocation kinds; only the message shape varies.

```typescript
import type { ExtensionContext } from "@eks/sdk";

export default async function handler(
  req: InboundRequest,
  ctx: ExtensionContext,
): Promise<OutboundResponse> {
  // ctx is the entire platform surface. Nothing else is reachable.
  // ...
}
```

The full surface:

```typescript
export interface ExtensionContext {
  /** Identity of this running installation. Read-only. */
  readonly installation: {
    readonly id: string;              // ExtensionInstallation.id
    readonly extensionId: string;     // Extension.id
    readonly version: string;         // ExtensionVersion.version (semver)
    readonly publisherId: string;     // Publisher.id
    readonly organizationId: string;  // tenant
  };

  /** Identity of this single invocation. Read-only. */
  readonly invocation: {
    readonly id: string;              // fresh UUID per invocation
    readonly correlationId: string;   // propagated from the inbound request
    readonly traceId: string;         // OTel trace id
    readonly causationId: string | null; // event id if this is an event delivery
    readonly kind: "http" | "event" | "scheduled" | "workflow";
    readonly deadline: number;        // epoch ms; ctx.retry and ctx.storage honour this
    readonly actorUserId: string | null;
  };

  /** HTTP-style APIs — register routes, invoke other extensions, call connectors. */
  readonly apis: Apis;

  /** Domain events — subscribe, publish, replay. */
  readonly events: Events;

  /** Per-installation key/value storage. */
  readonly storage: Storage;

  /** Per-installation cache (Redis in prod, in-memory in dev). */
  readonly cache: Cache;

  /** Extension configuration (declared in manifest, set per-tenant). */
  readonly config: Config;

  /** Structured logger — writes to ExtensionLog. */
  readonly logger: Logger;

  /** Prometheus-style metrics — registered on the host MetricsRegistry. */
  readonly metrics: Metrics;

  /** Distributed tracer — produces child spans of the invocation span. */
  readonly tracer: Tracer;

  /** Delegated authentication — act as a user, resolve Principals. */
  readonly auth: Auth;

  /** Secrets — encrypted at rest, scoped, never logged. */
  readonly secrets: Secrets;

  /** Retry helper — exponential backoff with jitter, honours invocation deadline. */
  readonly retry: Retry;

  /** Feature flags — read per-tenant flag state. */
  readonly features: Features;
}
```

Each member is documented in its own section below. The TypeScript types live in `src/packages/sdk/types.ts` and are re-exported from the package root.

---

## 3. `ctx.apis` — HTTP, cross-extension, and connector calls

```typescript
export interface Apis {
  /** Register an HTTP handler mounted under /api/v1/extensions/:slug/route/:route. */
  register(route: string, handler: RouteHandler): void;

  /** Register a workflow step handler. */
  registerStep(step: string, handler: StepHandler): void;

  /** Invoke another extension's registered handler. */
  invoke<T = unknown>(
    target: `ext:${string}`,
    handler: string,
    payload: unknown,
    options?: InvokeOptions,
  ): Promise<T>;

  /** Call a connector's exposed action. */
  fetch<T = unknown>(
    target: `connector:${string}`,
    path: string,
    init?: ConnectorFetchInit,
  ): Promise<T>;

  /** Make an outbound HTTP call through the egress proxy. */
  request(url: string, init?: RequestInit): Promise<Response>;
}
```

### 3.1 Registering an API handler

```typescript
import { defineExtension } from "@eks/sdk";

export default defineExtension({
  manifest: {
    slug: "loyalty-engine",
    version: "1.0.0",
    permissions: ["invoke.apis", "access.storage", "publish.events"],
    requiredAPIs: [],
  },
  setup(ctx) {
    ctx.apis.register("redeem", async (req, ctx) => {
      const userId = req.user?.id;
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };

      const points = Number(await ctx.storage.get(`points:${userId}`)) ?? 0;
      const cost = Number(req.body.cost);
      if (points < cost) {
        return { status: 409, body: { error: "insufficient_points" } };
      }

      await ctx.storage.set(`points:${userId}`, points - cost);
      await ctx.events.publish("loyalty.redeemed.v1", {
        userId,
        cost,
        balance: points - cost,
      });

      return { status: 200, body: { ok: true, balance: points - cost } };
    });
  },
});
```

The `redeem` route is mounted at `POST /api/v1/extensions/loyalty-engine/route/redeem`. Authentication and authorization run before the handler is invoked (see `ARCHITECTURE.md` §5).

### 3.2 Invoking another extension

```typescript
// Inside extension "checkout-bridge":
const loyalty = await ctx.apis.invoke<{ ok: true; balance: number }>(
  "ext:loyalty-engine",
  "redeem",
  { userId: ctx.invocation.actorUserId, cost: 100 },
  { idempotencyKey: `redeem:${bookingId}` },
);
```

Cross-extension calls are audited: the source `installationId`, target `installationId`, handler name, and outcome are written to `AuditLog`. The target extension receives the call as if it were an HTTP request, with `req.user` set to the source extension's Principal (kind = `extension`).

### 3.3 Calling a connector

```typescript
// Inside any extension with connectorDependencies: ["connector:acme-pos"]:
const orders = await ctx.apis.fetch<{ orders: AcmeOrder[] }>(
  "connector:acme-pos",
  "/orders?since=" + encodeURIComponent(lastSyncIso),
  { method: "GET" },
);
```

The call routes through the platform's egress proxy, which:
1. Resolves the connector slug to a `ConnectorConfiguration` row for the current tenant.
2. Loads and decrypts the connector's stored credentials from `Secret`.
3. Calls the connector's `authenticate` step to mint a fresh provider token (cached for the credential's TTL).
4. Calls the connector's `handleWebhook`-style handler if `path` starts with `/webhook/`, otherwise calls the connector's generic action surface.
5. Records the outbound call to `ExtensionLog` + `AuditLog` and increments `extension_outbound_calls_total`.

### 3.4 Outbound HTTP

```typescript
const res = await ctx.apis.request("https://api.example.com/v1/thing", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ hello: "world" }),
});
```

`ctx.apis.request` is the **only** way for an extension to make an outbound HTTP call. It enforces the manifest's `allowedDomains` allowlist; a request to a domain not on the allowlist throws `ForbiddenError` and is audited as a security event. The response is the standard `Response` type.

---

## 4. `ctx.events` — subscribe, publish, replay

> **Naming convention.** The platform-side events emitted **by the runtime** during the extension lifecycle (`Extension.Installed`, `Extension.Upgraded`, `Connector.Executed`, `Workflow.Started`, `Event.Replayed`, `Package.Published`, `Secret.Rotated`, etc.) are defined in the `DEVELOPER_EVENTS` registry of the `@eks/developer` package and built by the `buildDeveloperEvent` factory — these are **platform events**, not extension events, and an extension cannot publish them (the runtime rejects `ctx.events.publish("Extension.Installed", …)` because the prefix `Extension.` is reserved). Extension-published events use a different convention: a lowercase dotted name with a `.vN` suffix (e.g. `loyalty.redeemed.v1`), chosen by the extension author and declared in the manifest's `publishedEvents` field. Both kinds share the same M1 `EventBus` and the same `DomainEvent` envelope shape (`tier`, `eventId`, `occurredAt`, `correlationId`, `causationId`, `version`, `traceId`, `actorUserId`, `organizationId`, `aggregateType`, `aggregateId`, `eventType`, `payload`) — the only difference is who built them.

```typescript
export interface Events {
  subscribe<T = unknown>(
    eventType: string,
    handler: (event: DomainEvent<T>) => Promise<void> | void,
  ): void;

  publish<T = unknown>(
    eventType: string,
    payload: T,
    options?: { idempotencyKey?: string; aggregateId?: string },
  ): Promise<void>;

  replay(options: {
    from: string;     // ISO timestamp
    to: string;       // ISO timestamp
    types?: string[]; // filter; undefined = all declared requiredEvents
    onEvent: (event: DomainEvent) => Promise<void>;
  }): Promise<{ replayed: number; skipped: number; eventId: string }>;
}
```

### 4.1 Subscribing to an event

```typescript
// manifest.requiredEvents: ["booking.created.v1", "booking.cancelled.v1"]

setup(ctx) {
  ctx.events.subscribe("booking.created.v1", async (event) => {
    const userId = event.payload.customerId;
    const points = Number(await ctx.storage.get(`points:${userId}`)) ?? 0;
    await ctx.storage.set(`points:${userId}`, points + 100);
    ctx.logger.info("awarded_points", { userId, awarded: 100, source: event.eventId });
  });

  ctx.events.subscribe("booking.cancelled.v1", async (event) => {
    const userId = event.payload.customerId;
    const points = Number(await ctx.storage.get(`points:${userId}`)) ?? 0;
    await ctx.storage.set(`points:${userId}`, Math.max(0, points - 100));
  });
}
```

Subscriptions are registered in `setup()` and persist for the lifetime of the installation. The runtime registers a single subscriber on the M1 `EventBus` per (installationId, eventType) pair and routes deliveries to the handler inside a fresh invocation. Each delivery:
- Carries the full M1 `DomainEvent` envelope (correlationId, traceId, causationId, organizationId).
- Is filtered by tenant — the event's `organizationId` must match the installation's.
- Is filtered by manifest — only event types in `requiredEvents` are routed.
- Is idempotent — the runtime deduplicates by `eventId` per installation for 24h.

### 4.2 Publishing an event

```typescript
await ctx.events.publish(
  "loyalty.redeemed.v1",
  { userId, cost, balance },
  { idempotencyKey: `redeem:${userId}:${bookingId}`, aggregateId: userId },
);
```

`publish` writes the event to the M1 `EventOutbox` table in the **same Prisma transaction** as the surrounding storage mutation (if the extension called `ctx.storage.tx(...)` first). If no transaction is open, `publish` opens its own short transaction. The relay worker then publishes to the `EventBus` asynchronously — but the write to the outbox is durable.

The `eventType` must follow the `{publisher}.{aggregate}.{verb}.v{N}` convention (e.g. `loyalty.redeemed.v1`). The runtime validates this against a regex and rejects malformed names with `ValidationError`.

### 4.3 Replaying events

```typescript
const result = await ctx.events.replay({
  from: "2025-01-01T00:00:00Z",
  to: "2025-01-31T23:59:59Z",
  types: ["booking.created.v1"],
  onEvent: async (event) => {
    // Re-award points for any bookings that were missed during a
    // storage outage on 2025-01-15.
    const userId = event.payload.customerId;
    const alreadyAwarded = await ctx.storage.get(`replay:${event.eventId}`);
    if (alreadyAwarded) return;
    await ctx.storage.set(`replay:${event.eventId}`, "1");
    const points = Number(await ctx.storage.get(`points:${userId}`)) ?? 0;
    await ctx.storage.set(`points:${userId}`, points + 100);
  },
});
ctx.logger.info("replay_completed", result);
```

Replay creates an `EventReplay` row (with `installationId`, `organizationId`, `from`, `to`, `types`, `startedBy`, `status`, `eventsProcessed`, `eventsSkipped`, `startedAt`, `completedAt`, `error`) for audit. Replay is **read-only with respect to the source events** — the original event stream is never modified; the extension's `onEvent` callback may mutate its own storage, and that's the whole point.

The `eventId` returned in the result is the `EventReplay.id` — useful for querying replay status via `GET /api/v1/extensions/:id/events/replay/:replayId`.

---

## 5. `ctx.storage` — per-installation key/value

```typescript
export interface Storage {
  get<T = string>(key: string): Promise<T | null>;
  set<T = string>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; value: string }>>;
  tx<T>(fn: (tx: StorageTx) => Promise<T>): Promise<T>;
}
```

### 5.1 Reading and writing

```typescript
const balance = Number(await ctx.storage.get(`points:${userId}`)) ?? 0;
await ctx.storage.set(`points:${userId}`, balance + 100, { ttlSeconds: 60 * 60 * 24 * 365 });
await ctx.storage.delete(`temp:${correlationId}`);
```

Keys are strings up to 512 bytes; values are strings up to 256 KB. Larger values should be chunked or stored as references to `ExtensionLog` blobs (which have a 5 MB cap per entry). The backing store is the `ExtensionStorage` Prisma model — rows are scoped by `(installationId, organizationId, key)`.

### 5.2 Atomic transactions

```typescript
await ctx.storage.tx(async (tx) => {
  const balance = Number(await tx.get(`points:${userId}`)) ?? 0;
  if (balance < cost) throw new BusinessRuleError("insufficient_points");
  await tx.set(`points:${userId}`, balance - cost);
  await tx.set(`redeem:${bookingId}`, "1");
  // ctx.events.publish inside a tx writes to the outbox in the same
  // Prisma transaction — durable and atomic.
  await ctx.events.publish("loyalty.redeemed.v1", { userId, cost });
});
```

`tx` opens a Prisma transaction and routes every `get`/`set`/`delete` inside `fn` through it. The transaction is committed only if `fn` returns without throwing; any throw rolls back both the storage mutations and any outbox events staged during the tx. This is the M1 transactional-outbox guarantee, exposed at the SDK layer.

### 5.3 What storage is NOT

- It is **not** a relational store. There is no query language, no joins, no indexes beyond the key prefix. If an extension needs relational queries, it must subscribe to events and build a projection in its own storage namespace using composite keys (`points:by-cook:${cookId}:${period}`).
- It is **not** a blob store. Values are limited to 256 KB. Larger blobs should be chunked or referenced by URL.
- It is **not** shared across installations. `installationId` is in the `WHERE` clause; one installation cannot read another's storage, even within the same tenant.
- It is **not** shared across tenants. `organizationId` is in the `WHERE` clause.

---

## 6. `ctx.cache` — per-installation cache

```typescript
export interface Cache {
  get<T = string>(key: string): Promise<T | null>;
  set<T = string>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  getOrSet<T = string>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T>;
}
```

`ctx.cache` is a thin wrapper over the M1 `@eks/cache` registry, namespaced per installation (`ext:<installationId>:`). It inherits the M1 single-flight `getOrSet` stampede protection — concurrent calls with the same key share a single `loader` invocation.

```typescript
const customer = await ctx.cache.getOrSet(
  `customer:${customerId}`,
  60, // ttl seconds
  async () => {
    const res = await ctx.apis.fetch("connector:acme-pos", `/customers/${customerId}`);
    return res;
  },
);
```

Cache writes are **best-effort**. A cache miss must never cause an extension to fail — extensions must be designed to recover from a cold cache (typically by falling back to a connector call or storage read). The cache is shared across all warm workers for an installation on a given host; it is **not** shared across hosts (each host has its own Redis namespace if Redis is configured, or its own in-memory cache otherwise).

---

## 7. `ctx.config` — per-tenant configuration

```typescript
export interface Config {
  get<T = unknown>(key: string): T;
  getJSON<T = unknown>(key: string): T;
  all(): Readonly<Record<string, unknown>>;
}
```

`ctx.config` exposes the `ExtensionConfiguration.values` JSON blob for the current installation, validated at write-time against `ExtensionManifest.configurationSchema` (a Zod schema). Reads are synchronous (the config is materialised into the context at invocation start). Writes happen via `PUT /api/v1/extensions/:id/configuration` — extensions cannot mutate their own config at runtime; that is an operator action.

```typescript
const pointsPerBooking = ctx.config.get<number>("pointsPerBooking") ?? 100;
const excludedCategories = ctx.config.getJSON<string[]>("excludedCategories") ?? [];
```

If `configurationSchema` declares a field as required and the operator has not set it, `ctx.config.get(key)` throws `ConfigurationError` at invocation start. Use defaults in the schema (`z.number().default(100)`) rather than `??` in code if you want the runtime to materialise the default before your handler runs.

---

## 8. `ctx.logger` — structured logger

```typescript
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}
```

`ctx.logger` is a child of the M1 `@eks/observability` `Logger`, bound with `{ extensionId, version, installationId, organizationId, invocationId, correlationId, traceId }`. Every log call writes a row to `ExtensionLog` (buffered, flushed at end of invocation) and emits to the host's structured log stream (JSON in prod, pretty in dev).

```typescript
ctx.logger.info("awarded_points", {
  userId,
  awarded: 100,
  source: "booking.created.v1",
  balanceBefore,
  balanceAfter,
});

const sub = ctx.logger.child({ handler: "redeem" });
sub.warn("insufficient_points", { userId, requested: cost, available: balance });
```

Logs are **scoped by installation**. A query for `ExtensionLog` rows for installation X cannot return rows for installation Y — the `WHERE` clause includes `installationId` and the API route `/api/v1/extensions/:id/logs` enforces it server-side. See `RUNTIME_ARCHITECTURE.md` §6 for retention and the `eks logs` CLI command.

---

## 9. `ctx.metrics` — Prometheus metrics

```typescript
export interface Metrics {
  counter(name: string, meta?: Record<string, string>, value?: number): void;
  gauge(name: string, value: number, meta?: Record<string, string>): void;
  histogram(name: string, value: number, meta?: Record<string, string>): void;
}
```

Every metric is registered on the host's M1 `MetricsRegistry` and exported at `/api/v1/metrics` (Prometheus text format). Metric names are automatically prefixed with `extension_<slug>_` to avoid collisions; the registry rejects duplicate (name, labels) tuples that the manifest did not declare in `metricsDeclared` (a defensive measure against accidental cardinality explosions).

```typescript
ctx.metrics.counter("redemptions", { outcome: "success" });
ctx.metrics.histogram("redemption_value_ms", Date.now() - start, { tier: "premium" });
ctx.metrics.gauge("active_point_balances", await countActiveBalances(ctx));
```

The metric is visible at:

```
# HELP extension_loyalty_engine_redemptions_total
# TYPE extension_loyalty_engine_redemptions_total counter
extension_loyalty_engine_redemptions_total{outcome="success"} 1234
```

---

## 10. `ctx.tracer` — distributed tracer

```typescript
export interface Tracer {
  startSpan<T>(name: string, fn: (span: Span) => Promise<T>, attributes?: Record<string, unknown>): Promise<T>;
  currentSpan(): Span | null;
}
```

`ctx.tracer` is a wrapper around the M1 `@eks/observability` `Tracer`. The invocation span is already open when the handler runs; `ctx.tracer.startSpan` creates a child. Attributes set on the span are exported to the configured OTel collector.

```typescript
const result = await ctx.tracer.startSpan("compute_tier", async (span) => {
  span.setAttribute("user.tier_input", tier);
  const computed = await computeTier(ctx, userId);
  span.setAttribute("user.tier_output", computed);
  return computed;
});
```

The trace tree for a typical invocation:

```
http.server POST /api/v1/extensions/loyalty-engine/route/redeem
└─ extension.invocation loyalty-engine@1.0.0
   ├─ extension.storage.get points:u_123
   ├─ extension.storage.tx
   │  ├─ extension.storage.get points:u_123
   │  ├─ extension.storage.set points:u_123
   │  ├─ extension.storage.set redeem:b_456
   │  └─ extension.events.publish loyalty.redeemed.v1
   └─ extension.metrics.counter redemptions
```

---

## 11. `ctx.auth` — delegated authentication

```typescript
export interface Auth {
  asUser(userId: string, scopes: string[], ttlSeconds?: number): Promise<DelegatedPrincipal>;
  resolvePrincipal(token: string): Promise<Principal | null>;
  currentPrincipal(): Principal | null;
}
```

`ctx.auth.asUser` mints a short-lived (default 60s, max 300s) `DelegatedPrincipal` for the given user with the given scopes. This is the **only** way an extension can act on behalf of a user — it cannot forge a session cookie or read raw session tokens. Every `asUser` call writes an `AuditLog` row with `action = EXTENSION_AUTH_DELEGATED`, the source installation, the target user, the scopes, and the TTL.

```typescript
const principal = await ctx.auth.asUser(userId, ["booking.read", "booking.cancel"]);
// Now use the principal to invoke another extension that requires booking.cancel.
await ctx.apis.invoke("ext:booking-engine", "cancel", { bookingId }, { as: principal });
```

`ctx.auth.resolvePrincipal` is used by connector webhooks: the connector posts a token, the extension resolves it to a Principal, and proceeds. This is how a payment-provider webhook becomes an authenticated booking-completion call without the connector ever holding a user session.

---

## 12. `ctx.secrets` — encrypted secrets

```typescript
export interface Secrets {
  get(name: string): Promise<string>;
  getJSON<T = unknown>(name: string): Promise<T>;
  list(): Promise<string[]>;
}
```

Secrets are stored in the `Secret` Prisma model, encrypted at rest with AES-256-GCM (M1 `@eks/security/crypto`). Each secret is scoped to `(organizationId, installationId, name)`; an extension can only read secrets whose names appear in its manifest's `requiredSecrets` array. The decrypted value is held in memory only for the duration of the `get` call; it is never logged, never cached, never returned in error messages.

```typescript
const stripeKey = await ctx.secrets.get("STRIPE_SECRET_KEY");
const stripe = new Stripe(stripeKey);
const intent = await stripe.paymentIntents.create({ amount: 1000, currency: "usd" });
```

`requiredSecrets: ["STRIPE_SECRET_KEY"]` must be in the manifest; otherwise `ctx.secrets.get("STRIPE_SECRET_KEY")` throws `ForbiddenError`. Secrets are written by operators via `PUT /api/v1/extensions/:id/secrets/:name` — extensions cannot write their own secrets at runtime.

The full secret lifecycle (rotation, scope, audit) is documented in `SECURITY_MODEL.md` §5.

---

## 13. `ctx.retry` — exponential backoff with jitter

```typescript
export interface Retry {
  withBackoff<T>(
    fn: (attempt: number) => Promise<T>,
    options?: {
      maxAttempts?: number;       // default 5
      initialDelayMs?: number;    // default 100
      maxDelayMs?: number;        // default 5_000
      multiplier?: number;        // default 2
      jitter?: boolean;           // default true
      retryOn?: (err: unknown) => boolean; // default: retry on AppError with status>=500 or name === "NetworkError"
    },
  ): Promise<T>;
}
```

`ctx.retry.withBackoff` is a thin wrapper over the M1 `@eks/common` exponential-backoff helper, with two platform-specific additions:

1. **It honours the invocation deadline.** If the next retry attempt would push past `ctx.invocation.deadline`, the function rejects with `DeadlineExceededError` instead of waiting.
2. **It opens a child span per attempt** so the trace tree makes the retry behaviour visible.

```typescript
const order = await ctx.retry.withBackoff(
  (attempt) => {
    ctx.logger.info("fetching_order", { orderId, attempt });
    return ctx.apis.fetch("connector:acme-pos", `/orders/${orderId}`);
  },
  {
    maxAttempts: 4,
    retryOn: (err) => err instanceof Error && err.name === "ConnectorUnavailableError",
  },
);
```

`ctx.retry.withBackoff` does **not** retry side-effecting operations idempotently — that is the caller's responsibility. For non-idempotent operations, use `idempotencyKey` on `ctx.events.publish` and `ctx.apis.invoke`.

---

## 14. `ctx.features` — feature flags

```typescript
export interface Features {
  isEnabled(flag: string): boolean;
  isEnabledFor(flag: string, userId: string): boolean;
  variant(flag: string): string | null;
}
```

`ctx.features` wraps the M1 `@eks/features` `FeatureFlagService`, evaluated against the current tenant and user. Extension-specific flags should be declared in the manifest's `featureFlags` array; the platform rejects unknown flags at invocation start (defensive against typos).

```typescript
if (ctx.features.isEnabled("loyalty.double_points_promo")) {
  await ctx.storage.set(`points:${userId}`, balance + 200);
} else {
  await ctx.storage.set(`points:${userId}`, balance + 100);
}
```

Flag state is per-tenant; an extension running in tenant A does not see tenant B's flag state. Operators manage flags via the existing M1 `/api/v1/features` route; there is no extension-specific flag UI.

---

## 15. What you CANNOT do (and why)

The SDK is the entire surface. The following are **forbidden** and blocked at the sandbox layer:

| Forbidden | Why | Use instead |
|---|---|---|
| `import { PrismaClient } from "@prisma/client"` | Direct DB access bypasses tenancy, audit, and permissions | `ctx.storage`, `ctx.config` |
| `import Redis from "ioredis"` | Direct cache access bypasses quota and TTL | `ctx.cache` |
| `import fs from "node:fs"` | Filesystem access bypasses isolation | `ctx.storage` for state, `ctx.logger` for logs |
| `import http from "node:http"` | Network access bypasses egress allowlist | `ctx.apis.request`, `ctx.apis.fetch`, `ctx.apis.invoke` |
| `import { randomBytes } from "node:crypto"` | Not needed; the SDK provides `uuid()` where required | `ctx.invocation.id`, `ctx.invocation.correlationId` |
| `process.env.MY_VAR` | Environment access bypasses config + secrets | `ctx.config`, `ctx.secrets` |
| `globalThis.fetch("https://…")` | Bypasses egress allowlist | `ctx.apis.request` |
| `setTimeout(() => …, 60_000)` | Background work bypasses invocation deadline | Declare a scheduled job in the manifest |
| `new Date()` for audit timestamps | Bypasses the platform clock (testability, replay) | `ctx.invocation.now` (ISO string) |
| `console.log(…)` | Bypasses `ExtensionLog` and structured logging | `ctx.logger.info(…)` |

If the SDK does not expose something you need, the answer is **not** to reach for a Node primitive — it is to file a capability request with the platform team. The platform adds new capabilities only after a security review and a manifest declaration; this is the contract that lets Eks-Food run third-party code safely.

---

## 16. Worked example — a complete extension

The following extension uses every major capability of the SDK. It is intentionally small but exercises: API handler, event subscribe, event publish, storage tx, cache, secrets, retry, logger, metrics, tracer, auth delegation.

```typescript
import { defineExtension, type DomainEvent } from "@eks/sdk";
import Stripe from "stripe"; // ← Stripe SDK is bundled with the extension; only the
                             //   network call goes through ctx.apis.request via the
                             //   stripe SDK's fetch override.

export default defineExtension({
  manifest: {
    slug: "loyalty-engine",
    version: "1.0.0",
    permissions: [
      "invoke.apis", "subscribe.events", "publish.events",
      "access.storage", "access.cache", "access.secrets",
      "delegate.auth", "events.replay",
    ],
    requiredEvents: ["booking.created.v1", "booking.cancelled.v1"],
    requiredSecrets: ["STRIPE_SECRET_KEY"],
    configurationSchema: {
      type: "object",
      properties: {
        pointsPerBooking: { type: "number", default: 100 },
        redemptionFloor: { type: "number", default: 50 },
      },
    },
    allowedDomains: ["api.stripe.com"],
  },

  setup(ctx) {
    // 1. Subscribe to booking events to award points.
    ctx.events.subscribe("booking.created.v1", async (event: DomainEvent) => {
      const userId = event.payload.customerId as string;
      const award = ctx.config.get<number>("pointsPerBooking");

      await ctx.storage.tx(async (tx) => {
        const balance = Number(await tx.get(`points:${userId}`)) ?? 0;
        await tx.set(`points:${userId}`, balance + award);
        await tx.set(`award:${event.eventId}`, "1"); // idempotency marker
      });

      ctx.metrics.counter("points_awarded", { source: "booking.created.v1" });
      ctx.logger.info("awarded_points", { userId, award, eventId: event.eventId });
    });

    ctx.events.subscribe("booking.cancelled.v1", async (event: DomainEvent) => {
      const userId = event.payload.customerId as string;
      const award = ctx.config.get<number>("pointsPerBooking");
      const alreadyAwarded = await ctx.storage.get(`award:${event.causationId ?? event.eventId}`);
      if (!alreadyAwarded) return; // defensive: nothing to claw back
      await ctx.storage.tx(async (tx) => {
        const balance = Number(await tx.get(`points:${userId}`)) ?? 0;
        await tx.set(`points:${userId}`, Math.max(0, balance - award));
        await tx.delete(`award:${event.causationId ?? event.eventId}`);
      });
    });

    // 2. Register an HTTP handler for redemption.
    ctx.apis.register("redeem", async (req) => {
      const userId = req.user?.id;
      if (!userId) return { status: 401, body: { error: "unauthenticated" } };

      const cost = Number(req.body.cost);
      if (!Number.isFinite(cost) || cost < ctx.config.get<number>("redemptionFloor")) {
        return { status: 400, body: { error: "invalid_cost" } };
      }

      let newBalance: number;
      try {
        await ctx.storage.tx(async (tx) => {
          const balance = Number(await tx.get(`points:${userId}`)) ?? 0;
          if (balance < cost) throw new BusinessRuleError("insufficient_points");
          newBalance = balance - cost;
          await tx.set(`points:${userId}`, newBalance);
          await tx.set(`redeem:${ctx.invocation.id}`, JSON.stringify({ userId, cost }));
          await ctx.events.publish(
            "loyalty.redeemed.v1",
            { userId, cost, balance: newBalance },
            { idempotencyKey: `redeem:${userId}:${ctx.invocation.id}`, aggregateId: userId },
          );
        });
      } catch (err) {
        ctx.logger.warn("redeem_failed", { userId, cost, err: String(err) });
        return { status: 409, body: { error: "insufficient_points" } };
      }

      // 3. Issue a Stripe coupon for the redeemed value (with retry + cache).
      const stripeKey = await ctx.secrets.get("STRIPE_SECRET_KEY");
      const coupon = await ctx.cache.getOrSet(
        `stripe:coupon:${cost}`,
        3_600,
        async () => {
          const stripe = new Stripe(stripeKey, {
            fetch: (url, init) => ctx.apis.request(url.toString(), init as RequestInit),
          });
          return ctx.retry.withBackoff(() =>
            stripe.coupons.create({ percent_off: cost, duration: "once" }),
          );
        },
      );

      ctx.metrics.counter("redemptions", { outcome: "success" });
      return { status: 200, body: { ok: true, balance: newBalance, couponId: coupon.id } };
    });

    // 4. Register a workflow step (consumed by the "loyalty_digest" workflow).
    ctx.apis.registerStep("compute_balance", async (input, ctx) => {
      const balance = Number(await ctx.storage.get(`points:${input.userId}`)) ?? 0;
      return { userId: input.userId, balance };
    });

    ctx.logger.info("extension_started", {
      version: ctx.installation.version,
      handlers: ["redeem"],
      steps: ["compute_balance"],
      subscriptions: ["booking.created.v1", "booking.cancelled.v1"],
    });
  },
});
```

This is the pattern. Subscribe in `setup()`, mutate in handlers, persist in `tx`, publish through the outbox, reach external services via `ctx.apis.request` (or the connector surface), and never touch Prisma/Redis/`fs`/`net` directly.

---

## 17. Cross-references

| Topic | Document |
|---|---|
| Architecture & sandbox isolation | `ARCHITECTURE.md` |
| Connector SDK (authenticate, poll, sync) | `CONNECTOR_SDK_GUIDE.md` |
| Manifest schema and project structure | `EXTENSION_AUTHORING.md` |
| Packaging, integrity, signing | `PACKAGING_GUIDE.md` |
| Runtime internals (isolate pool, worker threads) | `RUNTIME_ARCHITECTURE.md` |
| Permission codes (capability registry) | `PERMISSION_MODEL.md` |
| Secret lifecycle, signing keys, audit | `SECURITY_MODEL.md` |
| `@eks/dev-cli` (`eks test`, `eks logs`) | `CLI_GUIDE.md` |
| M1 cache (single-flight, namespaces) | `docs/ARCHITECTURE.md` |
| M1 events (outbox, DLQ, idempotency) | `docs/EVENT_CONVENTIONS.md` |
| M1 metrics + tracer | `docs/ARCHITECTURE.md` |
| M2 auth (`asUser`, Principal) | `docs/identity/AUTHENTICATION_FLOWS.md` |
| M2 authorization (`authorize()`) | `docs/identity/AUTHORIZATION_POLICIES.md` |
