# Eks-Food Connector Development Guide

> **Audience:** Integration engineers and partner developers building connectors for Eks-Food. Read alongside `ARCHITECTURE.md` (the platform overview), `AUTHENTICATION_GUIDE.md` (credential handling), `SYNCHRONIZATION_GUIDE.md` (sync engine), `WEBHOOK_GUIDE.md` (inbound/outbound webhooks), `SCHEMA_REGISTRY_GUIDE.md` + `TRANSFORMATION_GUIDE.md` (data shaping), and the M3 `docs/developer/CONNECTOR_SDK_GUIDE.md` (the underlying `@eks/connector-sdk` contract).
>
> **Status:** M4. The `Connector` interface lives in `@eks/connector-sdk/types.ts` (M3); the operational platform (`@eks/integration`) wraps it with persistence, scheduling, health, rate-limiting, and secret management. This guide walks through authoring, testing, packaging, and publishing a connector end-to-end.

---

## 1. The Connector Interface

Every connector implements the `Connector` interface from `@eks/connector-sdk`. The interface is small — six methods — because the platform provides everything else (retry, circuit-breaking, rate-limiting, pagination, cursors, schema mapping, transformation, dead-letter queues, observability).

```typescript
// src/packages/connector-sdk/types.ts (M3; unchanged in M4)
export interface Connector {
  readonly code: string;
  readonly name: string;

  /** Validate credentials and return an auth context (cached by the runtime). */
  authenticate(ctx: ConnectorContext): Promise<{ ok: boolean; detail?: string }>;

  /** Poll for changes since the last cursor. Returns the next cursor. */
  poll(ctx: ConnectorContext, cursor?: string): Promise<PollResult>;

  /** Handle an inbound webhook (optional — only if the connector supportsWebhooks). */
  handleWebhook?(ctx: ConnectorContext, payload: unknown, headers: Record<string, string>): Promise<WebhookResult>;

  /** Run a full or incremental sync (poll + map + persist). */
  sync(ctx: ConnectorContext, cursor?: string): Promise<SyncResult>;

  /** Map an external record to the Eks-Food canonical schema. */
  mapSchema(ctx: ConnectorContext, source: Record<string, unknown>): Promise<Record<string, unknown>>;

  /** Lightweight health probe — invoked every 60s by the scheduler. */
  healthCheck(ctx: ConnectorContext): Promise<HealthCheckResult>;
}
```

The `ConnectorContext` is constructed by the runtime:

```typescript
export interface ConnectorConfig {
  readonly id: string;                  // ConnectorConfiguration.id
  readonly organizationId: string;      // tenant scope
  readonly connectorCode: string;       // e.g. "acme-pos"
  readonly credentials: Record<string, unknown>;  // decrypted at the boundary
  readonly syncState: Record<string, unknown>;    // cursor, lastSyncAt, ...
}

export interface ConnectorContext {
  readonly sdk: ExtensionContext;       // the M3 ExtensionContext (storage, cache, events, secrets, apis)
  readonly config: ConnectorConfig;
  readonly log: { info(msg, fields?): void; warn(msg, fields?): void; error(msg, fields?): void };
}
```

The runtime wraps each method invocation in:
1. **Rate-limit enforcement** — `RateLimitPolicy` token-bucket check (Redis; per-connector per-tenant).
2. **Circuit-breaker guard** — `CircuitBreaker` from `@eks/common`; trips after 5 failures in 60s, opens for 30s.
3. **Retry with backoff** — `withRetry` from `@eks/common`; exponential backoff (base 200ms, max 5s, jitter); `retryIf: (e) => !String(e).includes("AUTH_FAILED")` (auth failures are not retried — they surface immediately so the operator can rotate credentials).
4. **Execution logging** — One `ConnectorExecution` row per invocation (`kind`, `status`, `durationMs`, `attempts`, redacted `request`/`response`, `errorMessage`).
5. **Tracing** — OpenTelemetry span (`connector.execute`, attributes: `connector.code`, `connector.kind`, `tenant.id`).

---

## 2. Connector Types

The platform supports the following connector archetypes. The `Connector.code` and the `ConnectorVersion.manifest.kind` together identify the archetype; the runtime uses the archetype to pick the right scheduling cadence, retry policy, and observability dashboard.

| Archetype | `kind` | Trigger | Example |
|---|---|---|---|
| REST API (paginated) | `rest` | Scheduled poll | Acme POS orders, Xero invoices |
| GraphQL | `graphql` | Scheduled poll | Shopify Admin API |
| SOAP | `soap` | Scheduled poll | Legacy ERP, government permit systems |
| Webhooks (inbound) | `webhook-inbound` | HTTP POST to `/api/v1/integrations/webhooks/inbound/:slug` | Stripe, Payswap, Twilio |
| Event Streams | `event-stream` | Long-lived consumer (Kafka, Kinesis) | Real-time inventory updates |
| Message Queues | `message-queue` | Poll-based dequeue (SQS, RabbitMQ) | Async order fulfilment |
| Scheduled Polling | `scheduled-poll` | Cron | Government data dumps published at 02:00 |
| Database Replication | `db-replication` | CDC stream (Postgres logical replication, Debezium) | Read-replica from customer's ERP |
| File Import/Export | `file` | SFTP polling | Daily menu CSV from a franchise |
| CSV | `csv` | File trigger or upload | Bulk cook import |
| XML | `xml` | File trigger or SOAP response | Legacy supplier feeds |
| JSON | `json` | File trigger or REST response | Default for REST/GraphQL |

A single connector may combine archetypes (e.g. `rest` + `webhook-inbound` for Acme POS, which supports both polling and webhook notifications). The manifest declares the archetypes in `connector.archetypes: string[]`.

---

## 3. Building a Connector — Step by Step

This section walks through a complete connector for **Acme POS**, a fictional restaurant POS system. The connector exercises every method on the `Connector` interface and demonstrates the file / CSV / REST / webhook archetypes.

### 3.1 Project Structure

```
acme-pos-connector/
├── eks.manifest.json5        # the manifest (kind: "connector")
├── src/
│   ├── index.ts              # defineConnector(...) entrypoint
│   ├── auth.ts               # authenticate()
│   ├── poll.ts               # poll() — incremental order sync
│   ├── webhook.ts            # handleWebhook() — order.status.changed
│   ├── sync.ts               # sync() — full menu pull
│   ├── mapping.ts            # mapSchema() — Acme record → Eks-Food Booking
│   ├── transform.ts          # transformation helpers (CSV parse, lookup tables)
│   └── health.ts             # healthCheck()
├── schemas/
│   ├── acme-order.schema.json    # source schema (registered in the Schema Registry)
│   ├── acme-menu.schema.json
│   └── eks-booking.schema.json   # target schema (canonical, owned by Eks-Food)
├── mappings/
│   ├── order-to-booking.json     # MappingTemplate (references both schemas by version)
│   └── menu-to-mealcategory.json
├── transformations/
│   └── price-rounding.json       # TransformationRule
├── tests/
│   ├── auth.spec.ts
│   ├── poll.spec.ts
│   ├── webhook.spec.ts
│   ├── sync.spec.ts
│   └── mapping.spec.ts
├── package.json
└── tsconfig.json
```

### 3.2 The Manifest (`eks.manifest.json5`)

```json5
{
  slug: "acme-pos",
  name: "Acme POS Connector",
  version: "1.4.2",
  kind: "connector",
  description: "Two-way order sync between Acme POS and Eks-Food bookings.",
  publisher: { id: "pub_acme" },
  archetypes: ["rest", "webhook-inbound", "csv"],
  permissions: [
    "invoke.apis",
    "subscribe.events",
    "publish.events",
    "access.storage",
    "access.cache",
    "access.secrets",
  ],
  requiredAPIs: ["booking.read", "booking.create", "booking.update", "mealcategory.read"],
  requiredEvents: ["booking.created.v1", "booking.updated.v1"],
  requiredSecrets: ["ACME_API_KEY", "ACME_API_SECRET", "ACME_WEBHOOK_SECRET"],
  connector: {
    pollIntervalSeconds: 30,
    webhookPath: "/webhook",
    webhookSecretHeader: "X-Acme-Signature",
    healthCheckIntervalSeconds: 60,
    rateLimit: { requestsPerSecond: 5, burst: 10 },
    circuitBreaker: {
      failureThreshold: 5,
      openDurationMs: 30000,
      halfOpenProbeIntervalMs: 5000,
    },
    sync: {
      batchSize: 100,
      maxParallelism: 4,
      conflictStrategy: "remote_wins",
    },
  },
  configurationSchema: {
    type: "object",
    properties: {
      acmeBaseUrl: { type: "string", format: "uri" },
      defaultRegionId: { type: "string" },
      menuMapping: { type: "object" },
      csvImportPath: { type: "string", description: "SFTP path for daily menu CSV" },
    },
    required: ["acmeBaseUrl", "defaultRegionId"],
  },
  compatibilityRanges: { "eks-platform": "^4.0.0" },
  schemas: [
    { name: "acme-order", version: "1.0.0", path: "schemas/acme-order.schema.json", role: "source" },
    { name: "acme-menu", version: "1.0.0", path: "schemas/acme-menu.schema.json", role: "source" },
    { name: "eks-booking", version: "1.2.0", path: "schemas/eks-booking.schema.json", role: "target" },
  ],
  mappings: [
    { name: "order-to-booking", path: "mappings/order-to-booking.json" },
    { name: "menu-to-mealcategory", path: "mappings/menu-to-mealcategory.json" },
  ],
}
```

### 3.3 The Entrypoint (`src/index.ts`)

```typescript
import { defineConnector } from "@eks/connector-sdk";
import { authenticate } from "./auth";
import { poll } from "./poll";
import { handleWebhook } from "./webhook";
import { sync } from "./sync";
import { mapSchema } from "./mapping";
import { healthCheck } from "./health";

export default defineConnector({
  code: "acme-pos",
  name: "Acme POS Connector",
  authenticate,
  poll,
  handleWebhook,
  sync,
  mapSchema,
  healthCheck,
});
```

`defineConnector` is a thin identity function (it returns its argument unchanged) whose purpose is to give the M3 `@eks/registry/packager` a stable entrypoint and to enforce at author-time that the object satisfies `Connector`.

### 3.4 `authenticate` (`src/auth.ts`)

```typescript
import type { ConnectorContext } from "@eks/connector-sdk";

export async function authenticate(ctx: ConnectorContext) {
  const cfg = ctx.config.credentials as {
    ACME_API_KEY: string;
    ACME_API_SECRET: string;
  };

  const res = await ctx.sdk.apis.request(`${ctx.config.credentials.acmeBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: cfg.ACME_API_KEY,
      client_secret: cfg.ACME_API_SECRET,
    }),
  });

  if (!res.ok) {
    ctx.log.error("acme_auth_failed", { status: res.status });
    return { ok: false, detail: `Acme auth failed: HTTP ${res.status}` };
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  // The runtime caches the resulting auth context for the credential's TTL
  // (default 1h) and re-runs authenticate() only when the cached auth is
  // within 60s of expiry. The plaintext secret never leaves this call.
  ctx.config.credentials.accessToken = body.access_token;
  ctx.config.credentials.tokenExpiresAt = Date.now() + body.expires_in * 1000;

  return { ok: true };
}
```

The runtime invokes `authenticate()`:
- Once on activation (fail-fast on bad credentials).
- Once per credential TTL (default 1h) to refresh the cached token.
- Immediately after the operator rotates a `ConnectorCredential` or a `SecretReference`.

### 3.5 `poll` (`src/poll.ts`)

```typescript
import type { ConnectorContext, PollResult } from "@eks/connector-sdk";
import { buildPagination } from "@eks/connector-sdk";

export async function poll(ctx: ConnectorContext, cursor?: string): Promise<PollResult> {
  const since = cursor ?? (ctx.config.syncState.cursor as string | undefined);
  const baseUrl = ctx.config.credentials.acmeBaseUrl as string;
  const token = ctx.config.credentials.accessToken as string;

  const params = new URLSearchParams();
  if (since) params.set("updated_since", since);
  params.set("limit", "100");

  const res = await ctx.sdk.apis.request(`${baseUrl}/v1/orders/updated?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Acme poll failed: HTTP ${res.status}`);

  const body = (await res.json()) as {
    orders: AcmeOrder[];
    next_cursor: string | null;
  };

  // Each record is emitted as a domain event; the platform handles mapping,
  // deduplication, and outbox delivery. The cursor is persisted transactionally
  // with the emit batch by the runtime.
  for (const order of body.orders) {
    await ctx.sdk.events.publish("acme.order.updated.v1", order, {
      dedupeKey: `acme-order-${order.id}-${order.updated_at}`,
    });
  }

  return {
    records: body.orders,
    nextCursor: body.next_cursor ?? undefined,
    hasMore: body.next_cursor !== null,
  };
}
```

The `PollResult.nextCursor` is persisted by the runtime into `ConnectorConfiguration.syncState.cursor`. On the next poll, the runtime passes it back as the `cursor` argument. The platform never persists it inside connector code — that's the runtime's job, transactional with the event emissions.

### 3.6 `handleWebhook` (`src/webhook.ts`)

```typescript
import type { ConnectorContext, WebhookResult } from "@eks/connector-sdk";
import { createHmac, timingSafeEqual } from "node:crypto";

export async function handleWebhook(
  ctx: ConnectorContext,
  payload: unknown,
  headers: Record<string, string>,
): Promise<WebhookResult> {
  const sig = headers["x-acme-signature"] ?? "";
  const secret = ctx.config.credentials.ACME_WEBHOOK_SECRET as string;
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);

  // Verify the HMAC-SHA256 signature. The runtime pre-checks the timestamp
  // window (±5 min) and the nonce (idempotency), so the connector only needs
  // to verify the signature.
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { processed: false, error: "invalid_signature" };
  }

  const event = payload as { type: string; data: AcmeOrder };
  if (event.type !== "order.status.changed") {
    return { processed: true }; // ignore non-order events
  }

  await ctx.sdk.events.publish("acme.order.updated.v1", event.data, {
    dedupeKey: `acme-order-${event.data.id}-${event.data.updated_at}`,
  });

  return { processed: true, records: [event.data] };
}
```

The runtime's webhook receiver (`/api/v1/integrations/webhooks/inbound/acme-pos`) does:
1. Looks up the `WebhookEndpoint` by `slug`.
2. Verifies the timestamp window (±5 min from `X-Acme-Timestamp`).
3. Checks the nonce (`X-Acme-Event-Id`) against the `WebhookDelivery` table for idempotency.
4. Creates a `WebhookDelivery` row (`status="RECEIVED"`).
5. Invokes `handleWebhook()`.
6. Updates the `WebhookDelivery` row (`status="PROCESSED"` or `status="FAILED"`).
7. On failure, schedules a retry via the `RetryPolicy` attached to the `WebhookEndpoint`.

See `WEBHOOK_GUIDE.md` for the full inbound + outbound webhook contract.

### 3.7 `sync` (`src/sync.ts`)

```typescript
import type { ConnectorContext, SyncResult } from "@eks/connector-sdk";

export async function sync(ctx: ConnectorContext, cursor?: string): Promise<SyncResult> {
  const baseUrl = ctx.config.credentials.acmeBaseUrl as string;
  const token = ctx.config.credentials.accessToken as string;

  const url = new URL(`${baseUrl}/v1/menu/full`);
  if (cursor) url.searchParams.set("since", cursor);

  let processed = 0, created = 0, updated = 0, errors = 0;
  const errorList: { recordId: string; error: string }[] = [];
  let nextCursor: string | undefined;

  // paginate<T>() is a helper on the ConnectorContext that walks all pages
  // of a cursor-paginated endpoint, yielding items one at a time. It honours
  // the per-connector RateLimitPolicy and the circuit breaker transparently.
  for await (const item of ctx.sdk.paginate<AcmeMenuItem>({
    url: url.toString(),
    auth: { Authorization: `Bearer ${token}` },
    cursorParam: "page_token",
    cursorField: "next_page_token",
  })) {
    processed++;
    try {
      const mapped = await mapSchema(ctx, item);
      // The runtime wraps the emit in the surrounding SynchronizationJob
      // transaction; a failure here rolls back the checkpoint.
      await ctx.sdk.events.publish("acme.menu.upserted.v1", mapped, {
        dedupeKey: `acme-menu-${item.id}`,
      });
      if (item.created_at === item.updated_at) created++; else updated++;
    } catch (e) {
      errors++;
      errorList.push({ recordId: item.id, error: e instanceof Error ? e.message : String(e) });
    }
    nextCursor = item._page_token; // updated each iteration
  }

  return {
    recordsProcessed: processed,
    recordsCreated: created,
    recordsUpdated: updated,
    recordsDeleted: 0,
    conflicts: 0,
    nextCursor,
    errors: errorList,
  };
}
```

The runtime wraps each `sync()` call in a `SynchronizationJob` (status `RUNNING`), persists a `SynchronizationCheckpoint` every `batchSize` records (default 100), and on success transitions the job to `SUCCEEDED` with the final `nextCursor` recorded on `ConnectorConfiguration.syncState`. On failure, the job transitions to `FAILED` and the last successful checkpoint is the resumption point. See `SYNCHRONIZATION_GUIDE.md` for the full checkpoint/rollback model.

### 3.8 `mapSchema` (`src/mapping.ts`)

```typescript
import type { ConnectorContext } from "@eks/connector-sdk";
import { mapSchema as applyRules, type SchemaMappingRule } from "@eks/connector-sdk";

const ORDER_TO_BOOKING: readonly SchemaMappingRule[] = [
  { source: "id", target: "externalId", required: true },
  { source: "customer.name", target: "customerName", required: true },
  { source: "customer.phone", target: "customerPhone" },
  { source: "items", target: "lineItems", transform: mapLineItems },
  { source: "total_cents", target: "totalAmount", transform: (v) => ({ amount: v, currency: "GHS" }) },
  { source: "region_id", target: "regionId", transform: mapRegion },
  { source: "created_at", target: "placedAt", transform: (v) => new Date(v).toISOString() },
];

export async function mapSchema(
  _ctx: ConnectorContext,
  source: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return applyRules(source, ORDER_TO_BOOKING);
}

function mapLineItems(items: unknown) {
  if (!Array.isArray(items)) return [];
  return items.map((i) => ({
    sku: i.sku,
    name: i.name,
    quantity: i.qty,
    unitPriceCents: i.unit_price_cents,
  }));
}

function mapRegion(acmeRegionId: unknown) {
  // Lookup table: Acme region IDs → Eks-Food Region IDs.
  // The MappingTemplate (in mappings/order-to-booking.json) holds this table;
  // the runtime injects it into ctx.config.credentials.lookupTables.
  const lookup = LOOKUP_TABLES.acmeRegionToEksRegion;
  const eks = lookup[acmeRegionId as string];
  if (!eks) throw new Error(`unknown_acme_region:${acmeRegionId}`);
  return eks;
}
```

The rules above are duplicated in `mappings/order-to-booking.json` for the runtime path (so operators can edit mappings without a code release). The in-code `mapSchema` is the **fallback** used when the runtime cannot find a `MappingTemplate` row for the connector + target schema pair. See `SCHEMA_REGISTRY_GUIDE.md` §5 and `TRANSFORMATION_GUIDE.md` §2.

### 3.9 `healthCheck` (`src/health.ts`)

```typescript
import type { ConnectorContext, HealthCheckResult } from "@eks/connector-sdk";

export async function healthCheck(ctx: ConnectorContext): Promise<HealthCheckResult> {
  const baseUrl = ctx.config.credentials.acmeBaseUrl as string;
  const token = ctx.config.credentials.accessToken as string;

  const start = Date.now();
  const res = await ctx.sdk.apis.request(`${baseUrl}/v1/health`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const latencyMs = Date.now() - start;

  if (res.ok) return { healthy: true, latencyMs };
  if (res.status === 401) return { healthy: false, latencyMs, detail: "auth_expired" };
  if (res.status === 429) return { healthy: false, latencyMs, detail: "rate_limited" };
  return { healthy: false, latencyMs, detail: `http_${res.status}` };
}
```

The runtime invokes `healthCheck()` every 60s (configurable in the manifest). The result is written to `ConnectorHealth` (a rollup row per minute, with p50/p99 latency windows of 5m, 1h, 24h). Three consecutive `healthy=false` results transition the `ConnectorConfiguration` to `ERROR` and emit `Connector.HealthChanged` to the M1 `EventOutbox`, which triggers an alert via `@eks/notifications`.

---

## 4. Testing Locally

The `@eks/testing` package (M1) provides `mockRepository<T>()`, `apiCall()`, and the fixture builders. The M4 platform adds `@eks/integration/testing`, which provides:

- `createConnectorHarness(connector, { config, credentials })` — materialises a `ConnectorContext` with a mocked `ExtensionContext`, in-memory storage/cache/events, and a stubbed `apis.request` whose responses you control.
- `runPoll(connector, harness, cursor?)` — invokes `connector.poll` and returns the `PollResult` plus a list of every event emitted.
- `runSync(connector, harness, cursor?)` — invokes `connector.sync` and returns the `SyncResult` plus events.
- `runWebhook(connector, harness, payload, headers)` — invokes `connector.handleWebhook` and returns the `WebhookResult` plus events.
- `runHealthCheck(connector, harness)` — invokes `connector.healthCheck`.

A representative test (`tests/poll.spec.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { createConnectorHarness, runPoll } from "@eks/integration/testing";
import acmeConnector from "../src";

describe("acme-pos poll", () => {
  it("emits an event per order and returns the next cursor", async () => {
    const harness = createConnectorHarness(acmeConnector, {
      config: { acmeBaseUrl: "https://acme.test", defaultRegionId: "r-accra" },
      credentials: { ACME_API_KEY: "k", ACME_API_SECRET: "s", accessToken: "tok" },
      httpStubs: [
        { match: "/v1/orders/updated", status: 200, body: { orders: [{ id: "o1", updated_at: "2025-01-01T00:00:00Z" }], next_cursor: "c2" } },
      ],
    });

    const { result, events } = await runPoll(acmeConnector, harness, "c1");

    expect(result.records).toHaveLength(1);
    expect(result.nextCursor).toBe("c2");
    expect(events).toEqual([
      expect.objectContaining({ type: "acme.order.updated.v1", payload: expect.objectContaining({ id: "o1" }) }),
    ]);
  });
});
```

Run locally:

```bash
cd acme-pos-connector
bun install
bun test                  # vitest run
bun run typecheck         # tsc --noEmit
```

The harness is a real Node.js process — no sandboxing, no network restrictions. To test against a live Acme sandbox, set `ACME_API_KEY`/`ACME_API_SECRET` in `.env.test` and add `{ live: true }` to the harness options (this disables the HTTP stubs and lets real calls through, gated behind `process.env.NODE_ENV === "test"` so it never runs in CI by accident).

---

## 5. Packaging

The M3 `@eks/dev-cli package` command produces a reproducible tarball:

```bash
bunx @eks/dev-cli package
# → builds src/ with the platform's tsconfig
# → bundles with esbuild (target: node20, format: cjs, platform: node)
# → generates eks.manifest.sha256 (manifest integrity)
# → generates bundle.sha256 (bundle integrity)
# → signs both with the publisher's Ed25519 key (Ed25519 signature, base64)
# → packs into acme-pos-connector-1.4.2.tar+zstd
```

The output is a single `tar+zstd` archive with the following layout:

```
acme-pos-connector-1.4.2.tar+zstd
├── eks.manifest.json5             # manifest (signed)
├── eks.manifest.sha256            # manifest integrity
├── eks.manifest.sig               # Ed25519 signature of the manifest
├── bundle.js                      # esbuild output (signed)
├── bundle.sha256                  # bundle integrity
├── bundle.sig                     # Ed25519 signature of the bundle
├── schemas/                       # JSON Schema files
├── mappings/                      # MappingTemplate JSON files
└── transformations/               # TransformationRule JSON files
```

The M3 `@eks/registry` validates on publish:
1. **Manifest schema** — must match `@eks/sdk`'s `ExtensionManifestSchema` with `kind="connector"`.
2. **Signature** — both signatures must verify against the publisher's public key (registered on the `Publisher` row).
3. **Checksums** — must match the file contents.
4. **Malware scan** — ClamAV scan of the bundle (must pass).
5. **Schema compatibility** — every schema in `schemas[]` must have a `SchemaVersion` row in the Schema Registry (or be a new version that passes the backward-compatibility check against the previous version; see `SCHEMA_REGISTRY_GUIDE.md` §4).
6. **Permission review** — every permission in `permissions[]` must be on the platform's allow-list; new permissions require a platform release.

---

## 6. Publishing

```bash
bunx @eks/dev-cli publish --version 1.4.2 --notes "Fix: handle 429 from Acme with Retry-After"
```

This:
1. Re-runs the package step.
2. Uploads the archive to the registry's object store (S3 in production, local FS in dev).
3. Creates a `ConnectorVersion` row (status `PENDING_REVIEW`).
4. Triggers the M3 validation pipeline (signatures, malware, schemas, permissions).
5. On validation success, transitions the `ConnectorVersion` to `PUBLISHED` and emits `Connector.VersionPublished` to the `EventOutbox`.
6. Operators who have the connector installed see the upgrade in the Integration Console; they can upgrade at will (the runtime supports zero-downtime upgrades via the M3 blue/green loader — see `docs/developer/RUNTIME_ARCHITECTURE.md` §6).

The M4 platform supports **staged rollouts**: a `ConnectorVersion` can be marked `progressive` with a `rolloutPercent`. The runtime activates the new version for `rolloutPercent` of tenants (selected by hash of `organizationId`); if no errors are observed in 24h, the rollout is increased to 100%. A `rollback` API (`POST /api/v1/integrations/connectors/:id/versions/:v/rollback`) reverts every tenant to the previous active version.

---

## 7. End-to-End Checklist

Before submitting a connector for review, confirm:

- [ ] `defineConnector(...)` is the default export of `src/index.ts`.
- [ ] All six `Connector` methods are implemented (`handleWebhook` may be omitted if the connector does not declare `archetypes: ["webhook-inbound"]`).
- [ ] `authenticate()` returns `{ ok: false, detail }` on auth failure (does not throw).
- [ ] `poll()` returns `{ records, nextCursor, hasMore }` and emits one event per record.
- [ ] `sync()` returns a `SyncResult` with accurate counts; never throws on per-record errors (collects them in `errors[]`).
- [ ] `handleWebhook()` verifies the HMAC signature and returns `{ processed: false, error }` on mismatch.
- [ ] `mapSchema()` produces records that validate against the target `SchemaVersion` (the runtime asserts this — a mismatch surfaces as `CONN_SCHEMA_MISMATCH` from `@eks/connector-sdk/errors`).
- [ ] `healthCheck()` is fast (<1s) and does not mutate state.
- [ ] Every `schemas[]`, `mappings[]`, and `transformations[]` entry in the manifest resolves to a file in the package.
- [ ] Every `requiredSecrets[]` entry is documented in the connector's README and is referenced by `ctx.sdk.secrets.get(...)` in the code.
- [ ] Tests cover the happy path and at least one error path for each method.
- [ ] `bun run typecheck` is clean; `bun test` is green; `bunx @eks/dev-cli validate` is green.

Once all boxes are checked, run `bunx @eks/dev-cli publish` and the registry pipeline takes over.

---

## 8. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Storing the cursor in connector code | Sync restarts from zero on every invocation after a restart | Use `PollResult.nextCursor` / `SyncResult.nextCursor` — the runtime persists it |
| Throwing from `authenticate()` on bad credentials | The runtime treats this as a transient failure and retries | Return `{ ok: false, detail }` — auth failures are not retried |
| Calling `ctx.sdk.apis.request` to a domain not in `allowedDomains` | `Egress denied` error | Add the domain to `connector.allowedDomains` in the manifest |
| Mutating `ctx.config.credentials` to store derived state | State lost on next invocation (sandbox is destroyed) | Use `ctx.sdk.storage.put` for derived state; `ctx.config.credentials` is read-only |
| Emitting events outside the sync transaction | Checkpoint advanced past records that were never persisted | Use `ctx.sdk.events.publish` (transactional) — never `process.nextTick` or `setImmediate` |
| Hardcoding the target schema version | Mapping breaks when Eks-Food publishes a new `eks-booking` version | Reference the schema by `name + versionRange` in the manifest; the runtime resolves at install time |
| Re-encrypting secrets in connector code | Double-encrypted value sent to upstream | `ctx.sdk.secrets.get(name)` returns the decrypted plaintext — never re-encrypt |

When in doubt, run `bunx @eks/dev-cli validate --strict` — it catches most of these at build time.
