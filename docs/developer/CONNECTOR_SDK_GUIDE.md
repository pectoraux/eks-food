# Eks-Food Connector SDK — `@eks/connector-sdk`

> **Audience:** Integration engineers building data-plane connectors between Eks-Food and external systems (POS, ERP, accounting, marketplace, fleet, food-safety). Read alongside `SDK_GUIDE.md` (the parent `@eks/sdk` ExtensionContext), `EXTENSION_AUTHORING.md` (manifest fields shared with extensions), `PERMISSION_MODEL.md` (the `invoke.apis` + connector permissions), and `RUNTIME_ARCHITECTURE.md` (how connectors are scheduled).
>
> **Status:** Milestone 3. The `@eks/connector-sdk` package provides the `Connector` interface, a set of built-in operational capabilities (retry with backoff, pagination, incremental sync with cursors, conflict detection, batching, rate limiting, circuit breakers, caching), and a `defineConnector(...)` entrypoint. **No business connectors ship in M3** — the SDK is the contract; the first concrete connectors (Payswap, Stripe, Twilio, SendGrid, Acme POS) are M4. This document describes the SDK surface that M4 connectors will implement.

---

## 1. What a connector is (and is not)

A **connector** is a specialisation of an extension. It runs in the same sandbox, is installed via the same lifecycle (`ExtensionInstallation`), is signed and packaged the same way, and is invoked via the same `/api/v1/extensions/:slug/...` routes. What makes it a connector is:

1. **It declares `kind: "connector"` in its manifest** — this triggers the runtime to schedule periodic `poll` and `sync` invocations, expose `/api/v1/connectors/:slug/*` routes, and register a `healthCheck` job.
2. **It implements the `Connector` interface** (`authenticate`, `poll`, `handleWebhook`, `sync`, `mapSchema`, `healthCheck`) rather than the bare extension `setup()` interface.
3. **It is the **only** legitimate way for extension code to call an external system**. The platform's egress proxy is wired through the connector surface: any `ctx.apis.fetch("connector:foo", …)` call routes to a connector's action handler. Direct `ctx.apis.request("https://api.example.com/...")` is allowed only for `kind: "extension"` extensions with `allowedDomains` declared; connectors are the preferred abstraction because they centralise auth, pagination, retry, and observability.

A connector is **not**:
- A **driver** for a specific vendor (e.g. "the Stripe connector"). M3 ships the SDK only; concrete connectors are M4.
- A **replacement** for the SDK. A connector still receives an `ExtensionContext`; the `Connector` interface is layered on top.
- A **long-running process**. Each `poll`, `sync`, `handleWebhook` call is a bounded invocation with the same per-invocation quotas as any extension. Polling cadence is enforced by the platform scheduler, not by `setInterval` inside the connector.
- A **双向** sync engine out of the box. M3 connectors support inbound sync (external → Eks-Food) and webhook ingestion; outbound sync (Eks-Food → external) is achieved via the regular `ctx.events.subscribe` + `ctx.apis.fetch` pattern. Bidirectional sync with conflict resolution is M4.

---

## 2. The `Connector` interface

```typescript
import type { ExtensionContext, DomainEvent } from "@eks/sdk";

export interface Connector<TConfig = Record<string, unknown>, TAuth = unknown> {
  /** Validate the operator-supplied config + credentials; return a typed auth context. */
  authenticate(
    config: TConfig,
    credentials: Record<string, string>,
    ctx: ExtensionContext,
  ): Promise<TAuth>;

  /** Periodic external→Eks-Food fetch. Returns the next cursor (opaque to the platform). */
  poll(
    cursor: string | null,
    auth: TAuth,
    ctx: ConnectorContext<TConfig>,
  ): Promise<PollResult>;

  /** Handle an inbound webhook (POST /api/v1/connectors/:slug/webhook). */
  handleWebhook(
    request: WebhookRequest,
    auth: TAuth,
    ctx: ConnectorContext<TConfig>,
  ): Promise<WebhookResult>;

  /** Full or incremental sync, usually driven by a workflow. */
  sync(
    request: SyncRequest,
    auth: TAuth,
    ctx: ConnectorContext<TConfig>,
  ): Promise<SyncResult>;

  /** Map an external record to the Eks-Food canonical schema for the given aggregate. */
  mapSchema(
    externalRecord: unknown,
    target: SchemaTarget,
    ctx: ConnectorContext<TConfig>,
  ): unknown;

  /** Lightweight health probe invoked every 60s by the platform scheduler. */
  healthCheck(
    auth: TAuth,
    ctx: ConnectorContext<TConfig>,
  ): Promise<HealthCheckResult>;
}
```

The `ConnectorContext<TConfig>` extends `ExtensionContext` with connector-specific helpers:

```typescript
export interface ConnectorContext<TConfig> extends ExtensionContext {
  readonly connectorConfig: TConfig;
  readonly connector: ConnectorHelpers;
}

export interface ConnectorHelpers {
  /** Retry with backoff (delegates to ctx.retry.withBackoff, exposed here for clarity). */
  withRetry<T>(fn: (attempt: number) => Promise<T>, opts?: RetryOptions): Promise<T>;

  /** Iterate all pages of a paginated endpoint, yielding items one at a time. */
  paginate<T>(opts: PaginateOptions<T>): AsyncIterable<T>;

  /** Persist the cursor after each successful poll batch (transactional with the items emitted). */
  saveCursor(cursor: string): Promise<void>;

  /** Read the cursor from the previous poll. Returns null on first poll. */
  loadCursor(): Promise<string | null>;

  /** Emit a normalised record as a domain event. Writes to the outbox in the surrounding tx. */
  emit(eventType: string, payload: unknown, options?: { dedupeKey?: string }): Promise<void>;

  /** Resolve a conflict using the configured strategy. */
  resolveConflict(local: unknown, remote: unknown, strategy: ConflictStrategy): ConflictResolution;

  /** Apply a batch operation with bounded parallelism and per-item error isolation. */
  batch<TIn, TOut>(
    items: readonly TIn[],
    fn: (item: TIn, idx: number) => Promise<TOut>,
    opts?: BatchOptions,
  ): Promise<BatchResult<TOut>>;

  /** Enforce a rate limit (token bucket per connector+tenant). */
  rateLimit(weight?: number): Promise<void>;

  /** Wrap a remote call in a circuit breaker. */
  circuitBreaker<T>(name: string, fn: () => Promise<T>): Promise<T>;

  /** Cache a value under a connector-namespaced key. */
  cache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T>;
}
```

These helpers are documented in §4.

---

## 3. Building a connector — step by step

This section walks through a complete connector for an Acme POS system. The connector is intentionally vendor-shaped (Acme is a stand-in) but exercises every method on the `Connector` interface and every helper on `ConnectorContext`. M4 will ship real connectors following this same skeleton.

### 3.1 Project structure

```
acme-pos-connector/
├── eks.manifest.json5        # the manifest (kind: "connector")
├── src/
│   ├── index.ts              # defineConnector(...) entrypoint
│   ├── auth.ts               # authenticate() implementation
│   ├── poll.ts               # poll() — incremental order sync
│   ├── webhook.ts            # handleWebhook() — order.status.changed
│   ├── sync.ts               # sync() — full menu pull
│   ├── mapping.ts            # mapSchema() — Acme record → Eks-Food Booking
│   └── health.ts             # healthCheck()
├── tests/
│   ├── auth.spec.ts
│   ├── poll.spec.ts
│   └── webhook.spec.ts
├── package.json
└── tsconfig.json
```

### 3.2 The manifest (`eks.manifest.json5`)

```json5
{
  "slug": "acme-pos",
  "name": "Acme POS Connector",
  "version": "1.0.0",
  "kind": "connector",
  "description": "Two-way order sync between Acme POS and Eks-Food bookings.",
  "publisher": { "id": "pub_acme" },
  "permissions": [
    "invoke.apis",
    "subscribe.events",
    "publish.events",
    "access.storage",
    "access.cache",
    "access.secrets"
  ],
  "requiredAPIs": ["booking.read", "booking.create", "booking.update"],
  "requiredEvents": ["booking.created.v1", "booking.updated.v1"],
  "requiredSecrets": ["ACME_API_KEY", "ACME_API_SECRET"],
  "connector": {
    "pollIntervalSeconds": 30,
    "webhookPath": "/webhook",
    "webhookSecretHeader": "X-Acme-Signature",
    "healthCheckIntervalSeconds": 60,
    "rateLimit": { "requestsPerSecond": 5, "burst": 10 },
    "circuitBreaker": {
      "failureThreshold": 5,
      "openDurationMs": 30000,
      "halfOpenProbeIntervalMs": 5000
    },
    "sync": {
      "batchSize": 100,
      "maxParallelism": 4,
      "conflictStrategy": "remote_wins"
    }
  },
  "configurationSchema": {
    "type": "object",
    "properties": {
      "acmeBaseUrl": { "type": "string", "format": "uri" },
      "defaultRegionId": { "type": "string" },
      "menuMapping": { "type": "object" }
    },
    "required": ["acmeBaseUrl", "defaultRegionId"]
  },
  "compatibilityRanges": { "eks-platform": "^3.0.0" }
}
```

### 3.3 The entrypoint (`src/index.ts`)

```typescript
import { defineConnector } from "@eks/connector-sdk";
import { authenticate } from "./auth";
import { poll } from "./poll";
import { handleWebhook } from "./webhook";
import { sync } from "./sync";
import { mapSchema } from "./mapping";
import { healthCheck } from "./health";

interface AcmeConfig {
  acmeBaseUrl: string;
  defaultRegionId: string;
  menuMapping: Record<string, string>;
}

interface AcmeAuth {
  token: string;
  expiresAt: number; // epoch ms
}

export default defineConnector<AcmeConfig, AcmeAuth>({
  authenticate,
  poll,
  handleWebhook,
  sync,
  mapSchema,
  healthCheck,
});
```

### 3.4 `authenticate` (`src/auth.ts`)

```typescript
import type { Connector } from "@eks/connector-sdk";
import type { AcmeConfig, AcmeAuth } from ".";

export const authenticate: Connector<AcmeConfig, AcmeAuth>["authenticate"] = async (
  config,
  credentials,
  ctx,
) => {
  // The connector never sees the raw secret again after this call —
  // the runtime caches the resulting auth object for the credential's
  // TTL (declared in the manifest as 3600s by default), and re-runs
  // authenticate() only when the cached auth is within 60s of expiry.
  const res = await ctx.apis.request(`${config.acmeBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: credentials.ACME_API_KEY,
      client_secret: credentials.ACME_API_SECRET,
    }),
  });

  if (!res.ok) {
    ctx.logger.error("acme_auth_failed", { status: res.status });
    throw new AuthenticationError("acme_auth_failed");
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  return {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
};
```

The runtime calls `authenticate()`:
- Once on installation activation (to fail-fast on bad credentials).
- Once per credential TTL (default 1h) to refresh the cached auth.
- Immediately after an operator updates the connector's `ConnectorConfiguration` or rotates a `Secret`.

### 3.5 `poll` (`src/poll.ts`)

```typescript
import type { Connector, PollResult } from "@eks/connector-sdk";
import type { AcmeConfig, AcmeAuth } from ".";

export const poll: Connector<AcmeConfig, AcmeAuth>["poll"] = async (
  cursor,
  auth,
  ctx,
) => {
  // Load the cursor persisted by the previous poll. The platform
  // also passes it as the first argument for convenience, but
  // loadCursor() reads the same value transactionally with the
  // surrounding poll batch — important for crash recovery.
  const since = cursor ?? (await ctx.connector.loadCursor());
  const url = new URL(`${ctx.connectorConfig.acmeBaseUrl}/v1/orders/updated`);
  if (since) url.searchParams.set("since", since);

  // paginate() is an async iterable that walks all pages of the
  // Acme "updated orders" endpoint, transparently following the
  // Link rel="next" header. Each item is yielded once.
  const batch: AcmeOrder[] = [];
  for await (const order of ctx.connector.paginate<AcmeOrder>({
    url: url.toString(),
    auth: { Authorization: `Bearer ${auth.token}` },
    parsePage: async (res) => {
      const body = (await res.json()) as { data: AcmeOrder[]; nextCursor: string | null };
      return { items: body.data, nextCursor: body.nextCursor };
    },
    rateLimit: true, // honour the manifest's rateLimit.requestsPerSecond
  })) {
    batch.push(order);
    if (batch.length >= 100) {
      await processBatch(batch, ctx);
      batch.length = 0;
    }
  }
  if (batch.length > 0) await processBatch(batch, ctx);

  return { ok: true, nextCursor: await ctx.connector.loadCursor() } satisfies PollResult;
};

async function processBatch(orders: AcmeOrder[], ctx: any) {
  // batch() applies the items with bounded parallelism (manifest:
  // maxParallelism=4) and per-item error isolation — one bad
  // record does not abort the whole batch.
  const results = await ctx.connector.batch(
    orders,
    async (order) => {
      const canonical = ctx.connector.mapSchema
        ? await ctx.connector.mapSchema(order, "Booking", ctx)
        : order;
      await ctx.connector.emit(
        "acme.order.updated.v1",
        canonical,
        { dedupeKey: `acme:${order.id}:${order.updatedAt}` },
      );
    },
    { maxParallelism: 4, continueOnError: true },
  );
  ctx.metrics.counter("poll_items", {
    outcome: "success",
    count: String(results.succeeded),
  });
  if (results.failed > 0) {
    ctx.metrics.counter("poll_items", { outcome: "failed", count: String(results.failed) });
    ctx.logger.warn("poll_batch_partial_failure", {
      failed: results.failed,
      errors: results.errors.slice(0, 5),
    });
  }
}
```

`poll` returns `PollResult`:

```typescript
export interface PollResult {
  ok: boolean;
  nextCursor: string | null;
  itemsProcessed?: number;
  error?: string;
}
```

The platform scheduler records each poll as a `ConnectorExecution` row (with `connectorId`, `organizationId`, `kind: "poll"`, `cursorBefore`, `cursorAfter`, `startedAt`, `completedAt`, `itemsProcessed`, `status`, `error`). Failed polls are retried with exponential backoff (5 attempts, then the connector's `circuitBreaker` opens).

Every `ConnectorExecution` row is paired with a domain event built by `buildDeveloperEvent` from `@eks/developer`: a successful poll/sync/webhook emits `ConnectorExecuted` (wire string `Connector.Executed`); a failed one emits `ConnectorFailed` (wire string `Connector.Failed`). Both are staged to the M1 `EventOutbox` in the same Prisma transaction that writes the `ConnectorExecution` row. The matching audit codes (`CONNECTOR_EXECUTED` / `CONNECTOR_FAILED` from `DEVELOPER_AUDIT_ACTIONS`) are written to `AuditLog.action` by the same handler — the audit log captures the actor-side intent (who triggered the execution) while the domain event captures the aggregate-side outcome (what the connector did). Subscribers on `Connector.Executed` include the Developer Console live-updates feed, the per-tenant metrics rollup worker, and any extension that declared `Connector.Executed` in its `requiredEvents` (rare — usually only observability extensions subscribe).

### 3.6 `handleWebhook` (`src/webhook.ts`)

```typescript
import type { Connector, WebhookRequest, WebhookResult } from "@eks/connector-sdk";
import type { AcmeConfig, AcmeAuth } from ".";
import { createHmac } from "@eks/sdk/crypto"; // pure-js HMAC, no node:crypto

export const handleWebhook: Connector<AcmeConfig, AcmeAuth>["handleWebhook"] = async (
  request,
  auth,
  ctx,
) => {
  // 1. Verify the webhook signature. The manifest declared
  //    webhookSecretHeader="X-Acme-Signature"; the raw secret is in
  //    ctx.secrets under "ACME_WEBHOOK_SECRET" (also in requiredSecrets).
  const secret = await ctx.secrets.get("ACME_WEBHOOK_SECRET");
  const expected = createHmac("sha256", secret).update(request.rawBody).digest("hex");
  if (!constantTimeEqual(expected, request.headers["x-acme-signature"])) {
    ctx.logger.warn("webhook_signature_mismatch", { ip: request.ip });
    return { status: 401 } satisfies WebhookResult;
  }

  // 2. Parse + dispatch.
  const event = JSON.parse(request.rawBody) as AcmeWebhookEvent;
  switch (event.type) {
    case "order.status_changed": {
      const canonical = await mapSchema(event.data, "Booking", ctx);
      await ctx.connector.emit("acme.order.status_changed.v1", canonical, {
        dedupeKey: `acme:${event.data.id}:${event.data.version}`,
      });
      return { status: 200 };
    }
    case "order.cancelled": {
      const principal = await ctx.auth.asUser(event.data.operatorId, ["booking.cancel"]);
      await ctx.apis.invoke("ext:booking-engine", "cancel", {
        bookingId: event.data.externalId,
        reason: "acme_cancelled",
      }, { as: principal });
      return { status: 200 };
    }
    default:
      ctx.logger.info("webhook_ignored", { type: event.type });
      return { status: 200 };
  }
};
```

Webhooks are received at `POST /api/v1/connectors/acme-pos/webhook` (path configurable via the manifest). The platform:
1. Authenticates the inbound request — connectors can opt for `auth.mode = "signature"` (default), `auth.mode = "apikey"`, or `auth.mode = "none"`.
2. Times the request — webhooks must return in <10s; longer runs are truncated and the connector is marked DEGRADED.
3. Records a `ConnectorExecution` row with `kind: "webhook"`.
4. Replays failed webhooks (those that returned non-2xx) up to 5 times with exponential backoff via the M1 `DeadLetterQueue`.

### 3.7 `sync` (`src/sync.ts`)

`sync` is the on-demand or workflow-driven full/incremental sync. It differs from `poll` in that:
- It is **invoked explicitly** (via `POST /api/v1/connectors/:slug/sync` or as a workflow step), not on a schedule.
- It supports **multiple sync types** (`full`, `incremental`, `backfill`).
- It is **idempotent** — running the same sync twice must produce the same end state.

```typescript
import type { Connector, SyncRequest, SyncResult } from "@eks/connector-sdk";
import type { AcmeConfig, AcmeAuth } from ".";

export const sync: Connector<AcmeConfig, AcmeAuth>["sync"] = async (
  request,
  auth,
  ctx,
) => {
  const { kind, since, until } = request;
  ctx.logger.info("sync_started", { kind, since, until });
  const start = Date.now();

  // circuitBreaker() wraps the entire sync in a per-connector breaker
  // keyed by "acme-pos:sync". After 5 consecutive failures the breaker
  // opens; subsequent calls reject fast with CircuitOpenError for 30s.
  const result = await ctx.connector.circuitBreaker("sync", async () => {
    if (kind === "full") {
      return syncFull(auth, ctx);
    } else if (kind === "incremental") {
      return syncIncremental(since, until, auth, ctx);
    } else if (kind === "backfill") {
      return syncBackfill(since, until, auth, ctx);
    }
    throw new ValidationError("unknown_sync_kind", { kind });
  });

  ctx.metrics.histogram("sync_duration_ms", Date.now() - start, { kind });
  return result;
};

async function syncFull(auth: AcmeAuth, ctx: any): Promise<SyncResult> {
  // Full sync uses paginate() across the entire /v1/menu endpoint.
  // Items are emitted in batches of 100; each batch is one outbox tx.
  let processed = 0;
  let cursor: string | null = null;
  do {
    const url = new URL(`${ctx.connectorConfig.acmeBaseUrl}/v1/menu`);
    if (cursor) url.searchParams.set("page", cursor);
    const res = await ctx.connector.withRetry(() =>
      ctx.apis.request(url.toString(), {
        headers: { Authorization: `Bearer ${auth.token}` },
      }),
    );
    const body = (await res.json()) as { data: AcmeMenuItem[]; nextCursor: string | null };
    await ctx.connector.batch(
      body.data,
      async (item) => {
        const canonical = await mapSchema(item, "MenuItem", ctx);
        await ctx.connector.emit("acme.menu.upserted.v1", canonical, {
          dedupeKey: `acme:menu:${item.id}`,
        });
      },
      { maxParallelism: 4, continueOnError: true },
    );
    processed += body.data.length;
    cursor = body.nextCursor;
  } while (cursor);
  return { ok: true, itemsProcessed: processed };
}
```

### 3.8 `mapSchema` (`src/mapping.ts`)

```typescript
import type { Connector, SchemaTarget } from "@eks/connector-sdk";
import type { AcmeConfig, AcmeAuth } from ".";

export const mapSchema: Connector<AcmeConfig, AcmeAuth>["mapSchema"] = (
  externalRecord,
  target,
  ctx,
) => {
  switch (target) {
    case "Booking":
      return mapAcmeOrderToBooking(externalRecord as AcmeOrder, ctx);
    case "MenuItem":
      return mapAcmeMenuItemToMenuItem(externalRecord as AcmeMenuItem, ctx);
    default:
      throw new ValidationError("unsupported_schema_target", { target });
  }
};

function mapAcmeOrderToBooking(order: AcmeOrder, ctx: any) {
  return {
    externalId: order.id,
    externalSource: "acme-pos",
    customerId: order.customer.externalId ?? null,
    regionId: ctx.connectorConfig.defaultRegionId,
    items: order.items.map((i) => ({
      menuItemId: ctx.connectorConfig.menuMapping[i.sku] ?? i.sku,
      quantity: i.qty,
      notes: i.notes ?? null,
    })),
    scheduledFor: order.scheduled_at,
    status: mapAcmeStatus(order.status),
    total: { amount: order.total_cents, currency: order.currency },
    placedAt: order.created_at,
    updatedAt: order.updated_at,
    version: order.version, // used by conflict detection
  };
}

function mapAcmeStatus(s: string): string {
  switch (s) {
    case "new": return "PENDING";
    case "accepted": return "CONFIRMED";
    case "preparing": return "PREPARING";
    case "ready": return "READY";
    case "completed": return "COMPLETED";
    case "cancelled": return "CANCELLED";
    default: return "UNKNOWN";
  }
}
```

### 3.9 `healthCheck` (`src/health.ts`)

The health-check contract is the most important operational guarantee a connector provides. It is invoked every 60 seconds by the `extensions.healthcheck` worker; the result is written to `RuntimeHealth` and surfaced at `/api/v1/health/ready` (via the M1 `HealthRegistry`).

```typescript
import type { Connector, HealthCheckResult } from "@eks/connector-sdk";
import type { AcmeConfig, AcmeAuth } from ".";

export const healthCheck: Connector<AcmeConfig, AcmeAuth>["healthCheck"] = async (
  auth,
  ctx,
) => {
  const start = Date.now();
  try {
    const res = await ctx.connector.withRetry(
      () => ctx.apis.request(`${ctx.connectorConfig.acmeBaseUrl}/v1/health`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      }),
      { maxAttempts: 2, initialDelayMs: 200 },
    );
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return {
        status: "healthy",
        latencyMs,
        details: { httpStatus: res.status, tokenExpiresIn: auth.expiresAt - Date.now() },
      } satisfies HealthCheckResult;
    }
    return {
      status: "degraded",
      latencyMs,
      details: { httpStatus: res.status, reason: "non_200" },
    } satisfies HealthCheckResult;
  } catch (err) {
    return {
      status: "unhealthy",
      latencyMs: Date.now() - start,
      details: { error: String(err) },
    } satisfies HealthCheckResult;
  }
};
```

**Health-check contract:**

| Field | Type | Notes |
|---|---|---|
| `status` | `"healthy" \| "degraded" \| "unhealthy"` | Maps to M1 HealthRegistry probe states |
| `latencyMs` | `number` | Wall-clock time of the probe; reported as a histogram |
| `details` | `Record<string, unknown>` | Arbitrary structured metadata; surfaced in the console |

The platform enforces:
- **Timeout.** `healthCheck` must return within 5s; longer runs are aborted and reported as `unhealthy` with `details.reason = "timeout"`.
- **No side effects.** `healthCheck` must be read-only. The sandbox blocks any `ctx.storage.set`, `ctx.events.publish`, `ctx.apis.invoke` call during a health check (the manifest declares this implicitly via `kind: "connector"`).
- **No retries beyond the connector's own.** The platform calls `healthCheck` exactly once per tick; the connector's own `withRetry` is the only retry surface.
- **Cache.** The auth context passed to `healthCheck` is the cached one — `healthCheck` does not trigger `authenticate`.

A connector that reports `unhealthy` for 3 consecutive ticks is auto-suspended by the platform (transition: `ExtensionInstallation.status = SUSPENDED`, reason: `health_check_failed`). The operator is notified via `@eks/notifications`. Reactivation requires manual `POST /api/v1/extensions/:id/activate` after the underlying issue is fixed.

---

## 4. Built-in capabilities

The `ConnectorContext.connector` helper surface provides six built-in capabilities. Each is configured by the manifest's `connector` block and enforced by the runtime; the connector implementation does not need to wire them up.

### 4.1 Retry with backoff

```typescript
const order = await ctx.connector.withRetry(
  () => ctx.apis.request(`${baseUrl}/orders/${id}`, { headers }),
  { maxAttempts: 5, initialDelayMs: 200, maxDelayMs: 5_000, multiplier: 2, jitter: true },
);
```

Delegates to `ctx.retry.withBackoff` with a connector-specific default: retries on `5xx`, on network errors, on `429` (respecting the `Retry-After` header), and on the connector's declared retryable error types. The defaults are tuned for typical REST APIs; override per call if needed.

### 4.2 Pagination

```typescript
for await (const item of ctx.connector.paginate<Order>({
  url: `${baseUrl}/orders`,
  auth: { Authorization: `Bearer ${token}` },
  parsePage: async (res) => {
    const body = await res.json();
    return { items: body.data, nextCursor: body.pagination?.next ?? null };
  },
  rateLimit: true,
  maxPages: 1000, // safety guard
})) {
  // process item
}
```

`paginate` supports three styles out of the box, auto-detected from `parsePage`'s return shape:
1. **Cursor pagination** (`nextCursor: string | null`) — passed back as a query parameter `cursor`.
2. **Offset pagination** (`nextOffset: number | null`) — passed back as a query parameter `offset`.
3. **Link header** (`nextLink: string | null`) — followed directly.

The connector specifies which one Acme uses by returning the right field from `parsePage`. `paginate` transparently applies `rateLimit` between pages if `rateLimit: true`.

### 4.3 Incremental sync with cursors

The cursor is opaque to the platform — it is a string the connector produces and consumes. The contract:
- `poll(cursor, …)` returns `{ nextCursor }`.
- `ctx.connector.saveCursor(cursor)` persists it; `loadCursor()` reads it back.
- Both are transactional with the surrounding batch — if the batch fails, the cursor is not advanced.

A typical cursor is an opaque wrapper around an ISO timestamp or a server-issued token. The connector should never assume the cursor's format is stable across versions — include a version prefix (`v1:2025-01-01T00:00:00Z`) so a future v2 cursor format can be detected and rejected cleanly.

### 4.4 Conflict detection

```typescript
const resolution = ctx.connector.resolveConflict(localRecord, remoteRecord, "remote_wins");
// resolution = { action: "skip", winner: "remote", reason: "remote_version_newer" }
```

The platform implements three strategies:
- **`local_wins`** — keep the Eks-Food record; ignore the remote.
- **`remote_wins`** — overwrite the Eks-Food record with the remote.
- **`field_merge`** — for each field, take the side whose `updatedAt` is more recent.

Conflict detection keys off a `version` field on each record (the connector's `mapSchema` must produce one). If the local and remote records have the same `version`, no conflict is recorded. If they differ, the configured strategy resolves it. The connector can override the strategy per-call by passing a fourth argument.

### 4.5 Batching

```typescript
const result = await ctx.connector.batch(
  items,
  async (item) => processItem(item),
  { maxParallelism: 4, continueOnError: true, failFast: false },
);
// result = { succeeded: 98, failed: 2, errors: [{ index: 3, error: ... }, ...] }
```

`batch` applies the function with bounded parallelism (default 4) and per-item error isolation. With `continueOnError: true`, a failed item does not abort the batch; the result includes the index and error of each failure. With `failFast: true`, the batch aborts on the first failure and the error is re-thrown.

### 4.6 Rate limiting

```typescript
await ctx.connector.rateLimit(); // blocks until a token is available
await ctx.connector.rateLimit(2); // costs 2 tokens (e.g. for a "heavy" call)
```

A token-bucket rate limiter per `(connectorId, organizationId)`, configured by the manifest's `connector.rateLimit` (`{ requestsPerSecond: 5, burst: 10 }`). The bucket is shared across all concurrent invocations of the connector in the same tenant, so two parallel `poll` invocations do not exceed the rate. `paginate` and `withRetry` call `rateLimit` automatically when `rateLimit: true` is passed.

### 4.7 Circuit breaker

```typescript
const result = await ctx.connector.circuitBreaker("sync", () => doRiskyWork());
```

A per-`(connectorId, name)` circuit breaker using the M1 `@eks/common` `CircuitBreaker`. Configuration comes from the manifest's `connector.circuitBreaker`:
- `failureThreshold` (default 5) — consecutive failures before opening.
- `openDurationMs` (default 30_000) — how long the breaker stays open before transitioning to `HALF_OPEN`.
- `halfOpenProbeIntervalMs` (default 5_000) — how often a probe call is allowed in `HALF_OPEN`.

In `OPEN` state, `circuitBreaker` rejects immediately with `CircuitOpenError`. In `HALF_OPEN`, one probe call is allowed every `halfOpenProbeIntervalMs`; a successful probe closes the breaker, a failed probe re-opens it.

### 4.8 Caching

```typescript
const token = await ctx.connector.cache(
  `acme:token:${credentialsHash}`,
  3_600,
  () => refreshAccessToken(),
);
```

A wrapper over `ctx.cache.getOrSet` with the connector namespace prepended. Used typically to cache auth tokens, schema descriptors, and slow metadata fetches. Cache writes are best-effort.

---

## 5. The `defineConnector` entrypoint

```typescript
import { defineConnector } from "@eks/connector-sdk";

export default defineConnector<AcmeConfig, AcmeAuth>({
  authenticate,
  poll,
  handleWebhook,
  sync,
  mapSchema,
  healthCheck,
});
```

`defineConnector` is the analogue of `defineExtension` from `@eks/sdk`. It:
1. Validates that all six methods are present (any missing → `ManifestValidationError`).
2. Wraps each method in a per-invocation tracer span (`connector.<method>`).
3. Materialises the `ConnectorContext` (extension context + `connectorConfig` + `connector` helpers).
4. Returns a bundle entry that the runtime picks up at cold-start.

A connector manifest is just an extension manifest with `kind: "connector"` and a `connector` block. The runtime resolves `kind: "connector"` manifests to the `defineConnector` entrypoint; `kind: "extension"` manifests resolve to `defineExtension`. The two are mutually exclusive.

---

## 6. Routes exposed by every connector

A connector with slug `acme-pos` automatically exposes:

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/connectors/acme-pos/webhook` | Inbound webhook (path from manifest) |
| `POST` | `/api/v1/connectors/acme-pos/sync` | Trigger an on-demand `sync` |
| `GET` | `/api/v1/connectors/acme-pos/health` | Read the latest `healthCheck` result (no side effects) |
| `POST` | `/api/v1/connectors/acme-pos/auth/test` | Re-run `authenticate` with current credentials (operator diagnostic) |
| `GET` | `/api/v1/connectors/acme-pos/executions` | Paginated `ConnectorExecution` history (last 100) |
| `GET` | `/api/v1/connectors/acme-pos/cursor` | Read the current poll cursor |
| `POST` | `/api/v1/connectors/acme-pos/cursor/reset` | Reset the cursor (operator action, audited) |

Every route is authenticated by `@eks/auth/middleware` and authorized by `@eks/authorization` (action `connector.invoke` for sync/auth-test, `connector.manage` for cursor reset, any member for health read).

---

## 7. Observability for connectors

The platform emits the following metrics for every connector (in addition to the per-extension metrics):

```
connector_executions_total{connector_id,version,kind,outcome}
connector_execution_duration_ms{connector_id,version,kind}        (histogram)
connector_poll_items_total{connector_id,version,outcome}
connector_webhook_received_total{connector_id,source,event_type}
connector_webhook_signature_mismatches_total{connector_id,source}
connector_sync_duration_ms{connector_id,version,kind}             (histogram)
connector_health_check_status{connector_id,version,status}        (gauge, 0/1)
connector_circuit_breaker_state{connector_id,name,state}          (gauge: 0=closed, 1=open, 2=half_open)
connector_rate_limit_waits_ms{connector_id}                       (histogram)
```

Each `ConnectorExecution` row is queryable via `GET /api/v1/connectors/:slug/executions` (paginated, last 100 by default, 1000 max). The Developer Console surfaces the last 24 hours of executions as a sparkline plus a table of failures with retry buttons.

---

## 8. Testing connectors locally

The `@eks/dev-cli` provides `eks test` (see `CLI_GUIDE.md`) which spins up a local runtime with a fake `ExtensionContext`. The fake is provided by `@eks/testing` (M1 + M3 additions):

```typescript
import { describe, it, expect } from "vitest";
import { createConnectorHarness } from "@eks/testing";
import connector from "../src";

describe("acme-pos connector", () => {
  const harness = createConnectorHarness(connector, {
    config: { acmeBaseUrl: "https://acme.test", defaultRegionId: "r_1", menuMapping: {} },
    credentials: { ACME_API_KEY: "key", ACME_API_SECRET: "secret" },
    secrets: { ACME_WEBHOOK_SECRET: "wh" },
  });

  it("authenticates with Acme and caches the token", async () => {
    harness.egress
      .post("https://acme.test/oauth/token")
      .reply(200, { access_token: "tok_1", expires_in: 3600 });
    const auth = await harness.authenticate();
    expect(auth.token).toBe("tok_1");
    expect(harness.egress.calls).toHaveLength(1);
  });

  it("polls orders since the cursor and emits domain events", async () => {
    harness.egress
      .get("https://acme.test/v1/orders/updated")
      .query({ since: "2025-01-01T00:00:00Z" })
      .reply(200, { data: [{ id: "o_1", status: "new", updated_at: "2025-01-02T00:00:00Z" }] });
    const result = await harness.poll("2025-01-01T00:00:00Z");
    expect(result.ok).toBe(true);
    expect(harness.emitted).toContainEqual({
      eventType: "acme.order.updated.v1",
      payload: expect.objectContaining({ externalId: "o_1" }),
    });
  });

  it("rejects a webhook with a bad signature", async () => {
    const res = await harness.handleWebhook({
      rawBody: '{"type":"order.status_changed"}',
      headers: { "x-acme-signature": "bad" },
      ip: "10.0.0.1",
    });
    expect(res.status).toBe(401);
  });

  it("reports healthy when Acme is reachable", async () => {
    harness.egress.get("https://acme.test/v1/health").reply(200, {});
    const result = await harness.healthCheck();
    expect(result.status).toBe("healthy");
  });
});
```

The harness:
- Stubs `ctx.apis.request` with a declarative egress mock (no real network calls).
- Captures emitted events in `harness.emitted` for assertion.
- Captures storage writes in `harness.storage` for inspection.
- Provides `harness.authenticate()`, `harness.poll(cursor)`, `harness.handleWebhook(req)`, `harness.sync(req)`, `harness.healthCheck()` wrappers.
- Honours the same manifest permissions as production — a test that exercises a capability the manifest does not declare will fail with the same `ForbiddenError` it would in production.

---

## 9. What's coming in M4

M3 ships the SDK only. M4 will ship the first set of concrete connectors, each implementing the `Connector` interface for a specific vendor:

| Connector | Vendor | Sync mode | Poll cadence |
|---|---|---|---|
| `payswap` | Payswap payments | inbound + outbound | on-event |
| `stripe` | Stripe payments | inbound + outbound | on-event |
| `twilio` | Twilio SMS | outbound only | n/a |
| `sendgrid` | SendGrid email | outbound only | n/a |
| `acme-pos` | Acme POS (reference impl) | inbound + outbound | 30s |
| `quickbooks` | QuickBooks accounting | inbound + outbound | 5m |
| `squarespace` | Squarespace commerce | inbound | 60s |

Each M4 connector will be packaged as a signed `Package` published to the private registry, installable by any tenant whose publisher has been granted access. The M4 milestone will also add the first bidirectional sync engine (with the `field_merge` conflict strategy fully implemented; M3 ships `local_wins` and `remote_wins` only).

---

## 10. Cross-references

| Topic | Document |
|---|---|
| `@eks/sdk` ExtensionContext (the parent surface) | `SDK_GUIDE.md` |
| Manifest schema (kind: "connector") | `EXTENSION_AUTHORING.md` |
| Runtime scheduling of `poll` and `healthCheck` | `RUNTIME_ARCHITECTURE.md` |
| Connector permissions (`connector.invoke`, `connector.manage`) | `PERMISSION_MODEL.md` |
| Secret lifecycle (credential storage, rotation) | `SECURITY_MODEL.md` |
| `eks test`, `eks logs` for connector testing | `CLI_GUIDE.md` |
| M1 circuit breaker, retry, rate limiter | `docs/ARCHITECTURE.md` |
| M1 transactional outbox (`emit` → `EventOutbox`) | `docs/EVENT_CONVENTIONS.md` |
| M1 worker scheduler (`poll` cadence, `healthCheck` tick) | `docs/ARCHITECTURE.md` |
