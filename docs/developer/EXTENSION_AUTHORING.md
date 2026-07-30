# Eks-Food Extension Authoring Guide

> **Audience:** Developers writing their first Eks-Food extension. Read alongside `SDK_GUIDE.md` (the `ExtensionContext` API), `PERMISSION_MODEL.md` (capability codes), `PACKAGING_GUIDE.md` (turning the project into a signed `Package`), `PUBLISHING_GUIDE.md` (pushing the package to the private registry), and `CLI_GUIDE.md` (the `eks` command reference).
>
> **Status:** Milestone 3. By the end of this document you will have a working "hello world" extension that registers an HTTP route, subscribes to a domain event, reads and writes per-installation storage, and runs locally under the `@eks/dev-cli` test harness.

---

## 1. Prerequisites

- **Node.js 20+** and **Bun 1.1+** (the platform uses Bun for the dev workflow, Node for production runtime).
- **TypeScript 5.4+** with `strict: true`.
- The **`@eks/dev-cli`** installed globally: `npm install -g @eks/dev-cli` (or `bun add -g @eks/dev-cli`).
- An **Eks-Food developer account** — your `Publisher` row is created by the platform team during onboarding. You will receive a `publisherId` (e.g. `pub_acme`) and a one-time Ed25519 signing keypair.
- The **Eks-Food SDK** as a dev dependency: `bun add -d @eks/sdk @eks/connector-sdk @eks/testing`.

You do **not** need:
- A local Postgres — the CLI bundles an in-memory Prisma mock.
- A local Redis — the SDK falls back to in-memory cache in dev.
- A local message broker — the M1 `EventBus` is in-process in dev.

---

## 2. Project structure

The `eks create` scaffold produces this layout. You may add files but should not remove the manifest or the entrypoint — the CLI and runtime both depend on them being in fixed locations.

```
my-extension/
├── eks.manifest.json5          # the manifest (the only required config file)
├── package.json                # npm-style metadata + bundled deps
├── tsconfig.json               # extends @eks/sdk/tsconfig.base.json
├── README.md
├── src/
│   ├── index.ts                # the entrypoint (defineExtension / defineConnector)
│   ├── handlers/               # one file per API handler (convention)
│   │   ├── hello.ts
│   │   └── echo.ts
│   ├── subscribers/            # one file per event subscription
│   │   └── booking.created.ts
│   ├── steps/                  # one file per workflow step (if any)
│   │   └── compute.ts
│   └── lib/                    # extension-private helpers (not exposed)
│       └── points.ts
├── tests/
│   ├── handlers/
│   │   └── hello.spec.ts
│   └── subscribers/
│       └── booking.created.spec.ts
├── examples/                   # example HTTP requests for local testing
│   └── hello.http
└── .eks/
    ├── dev.json5               # local dev config (tenants, secrets, fixtures)
    └── signing-key.pem         # Ed25519 private key (NEVER commit; .gitignore'd)
```

The conventions enforced:
- `src/index.ts` is the entrypoint. The runtime imports the **default export** of this file. The default export must be the result of `defineExtension(...)` or `defineConnector(...)`.
- `eks.manifest.json5` is the manifest. JSON5 is supported (comments, trailing commas) — useful for the long `configurationSchema` blocks.
- `tests/**/*.spec.ts` are auto-discovered by `eks test`. Test files use Vitest (already configured by `@eks/sdk/tsconfig.base.json`).

---

## 3. The manifest

The manifest is the single source of truth for what an extension is, what it can do, and how the platform should run it. It is validated by `@eks/registry` at publish time and enforced by `@eks/runtime` at execution time.

### 3.1 Full schema

```json5
{
  // ─── Identity ────────────────────────────────────────────────────────
  "slug": "loyalty-engine",              // url-safe, lowercase, 3-64 chars, unique per publisher
  "name": "Loyalty Engine",              // human-readable, 3-128 chars
  "version": "1.0.0",                    // semantic version
  "kind": "extension",                   // "extension" | "connector"
  "description": "Points accrual and redemption for the Eks-Food booking lifecycle.",
  "publisher": { "id": "pub_acme" },
  "homepage": "https://docs.acme.com/eks-loyalty",
  "repository": "https://github.com/acme/eks-loyalty",
  "license": "Apache-2.0",
  "icon": "assets/icon.svg",             // 64x64 SVG, bundled in the package

  // ─── Capabilities ───────────────────────────────────────────────────
  "capabilities": [
    "apis",          // registers HTTP handlers under /api/v1/extensions/:slug/route/*
    "events",        // subscribes to domain events
    "storage",       // uses ctx.storage (key/value)
    "cache",         // uses ctx.cache
    "secrets",       // uses ctx.secrets
    "workflow",      // registers workflow steps
    "scheduled",     // declares scheduled jobs (cron)
    "auth",          // uses ctx.auth.asUser
    "metrics",       // uses ctx.metrics
    "tracer"         // uses ctx.tracer (always allowed; listed for clarity)
  ],

  // ─── Permissions (capability-based; see PERMISSION_MODEL.md) ────────
  "permissions": [
    "invoke.apis",            // can register/invoke HTTP handlers
    "subscribe.events",       // can subscribe to domain events
    "publish.events",         // can publish integration events
    "access.storage",         // can read/write ctx.storage
    "access.cache",           // can read/write ctx.cache
    "access.secrets",         // can read ctx.secrets (per-name via requiredSecrets)
    "delegate.auth",          // can call ctx.auth.asUser
    "events.replay",          // can call ctx.events.replay
    "read.customers",         // can read customer data via the platform API
    "read.bookings",          // can read booking data
    "write.schedules"         // can write to the schedule aggregate
  ],

  // ─── Required APIs (must be granted by the platform's API surface) ──
  "requiredAPIs": [
    "booking.read",
    "booking.create",
    "booking.update",
    "customer.read"
  ],

  // ─── Required events (subscribed to via ctx.events.subscribe) ───────
  "requiredEvents": [
    "booking.created.v1",
    "booking.cancelled.v1",
    "booking.completed.v1"
  ],

  // ─── Required secrets (names that ctx.secrets.get is allowed to read) ──
  "requiredSecrets": [
    "STRIPE_SECRET_KEY"
  ],

  // ─── Configuration schema (Zod; validated on write, materialised on read) ──
  "configurationSchema": {
    "type": "object",
    "properties": {
      "pointsPerBooking": { "type": "number", "default": 100, "minimum": 0, "maximum": 10000 },
      "redemptionFloor":  { "type": "number", "default": 50,  "minimum": 0, "maximum": 10000 },
      "excludedCategories": {
        "type": "array",
        "items": { "type": "string" },
        "default": []
      },
      "promotion": {
        "type": "object",
        "properties": {
          "active": { "type": "boolean", "default": false },
          "multiplier": { "type": "number", "default": 2, "minimum": 1, "maximum": 10 }
        }
      }
    },
    "required": []
  },

  // ─── Connector dependencies (for extensions that call connectors) ──
  "connectorDependencies": [
    "connector:acme-pos",      // must be installed in the same tenant
    "connector:stripe"
  ],

  // ─── Localization (message catalogs) ────────────────────────────────
  "localization": {
    "defaultLocale": "en",
    "locales": ["en", "fr", "sw"],
    "catalogPath": "locales/{locale}.json"
  },

  // ─── Licensing (soft-enforced; checked at activation) ───────────────
  "licensing": {
    "model": "subscription",              // "subscription" | "per-seat" | "free"
    "required": true,                     // false = no license check
    "gracePeriodDays": 14                 // extensions still run during grace
  },

  // ─── Compatibility ranges (platform version pinning) ────────────────
  "compatibilityRanges": {
    "eks-platform": "^3.0.0",             // semver range; required
    "@eks/sdk": "^3.0.0",
    "@eks/connector-sdk": "^3.0.0"        // only if kind = "connector"
  },

  // ─── Resource limits (per invocation; defaults shown) ───────────────
  "limits": {
    "cpuMs": 200,
    "wallClockMs": 5000,
    "heapMB": 64,
    "outboundCalls": 10,
    "storageOps": 50,
    "eventPublishes": 5
  },

  // ─── Egress allowlist (only for ctx.apis.request) ──────────────────
  "allowedDomains": [
    "api.stripe.com"
  ],

  // ─── Scheduled jobs (cron expressions, UTC) ─────────────────────────
  "scheduledJobs": [
    {
      "name": "nightly_balance_digest",
      "cron": "0 2 * * *",
      "handler": "scheduled:nightly_digest"
    }
  ],

  // ─── Feature flags the extension reads (defensive; typos rejected) ─
  "featureFlags": [
    "loyalty.double_points_promo"
  ],

  // ─── Metrics the extension emits (defensive; typos rejected) ───────
  "metricsDeclared": [
    { "name": "redemptions", "type": "counter" },
    { "name": "redemption_value_ms", "type": "histogram" },
    { "name": "active_point_balances", "type": "gauge" }
  ],

  // ─── Connectors-only block (ignored for kind: "extension") ─────────
  "connector": {
    "pollIntervalSeconds": 30,
    "webhookPath": "/webhook",
    "webhookSecretHeader": "X-Signature",
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
  }
}
```

### 3.2 Field reference

| Field | Required | Description |
|---|---|---|
| `slug` | yes | URL-safe identifier, unique per publisher. Lowercase, 3-64 chars, `^[a-z][a-z0-9-]*$`. |
| `name` | yes | Human-readable name, 3-128 chars. |
| `version` | yes | Semantic version (`MAJOR.MINOR.PATCH`). Must match `package.json`. |
| `kind` | yes | `"extension"` or `"connector"`. Determines entrypoint resolver. |
| `description` | yes | 10-512 chars. Shown in the Developer Console. |
| `publisher.id` | yes | The `Publisher.id` you were issued during onboarding. Verified against the signing key. |
| `capabilities` | yes | Array of capability tokens; gates which `ctx.*` surfaces the extension may use. |
| `permissions` | yes | Capability-based permission codes. See `PERMISSION_MODEL.md`. |
| `requiredAPIs` | no | Platform API actions the extension invokes (e.g. `booking.read`). Granted per-tenant by an admin. |
| `requiredEvents` | no | Event types the extension subscribes to. Only these types are routed. |
| `requiredSecrets` | no | Secret names the extension may read. |
| `configurationSchema` | no | Zod-schema JSON describing the per-tenant config. |
| `connectorDependencies` | no | Connectors that must be installed in the same tenant for this extension to function. |
| `localization` | no | Locale configuration; `catalogPath` is bundled into the package. |
| `licensing` | no | License enforcement model. |
| `compatibilityRanges` | yes | Semver ranges for `eks-platform` and the SDK packages. |
| `limits` | no | Per-invocation resource limits. Override the platform defaults. |
| `allowedDomains` | no | Domains the extension may call via `ctx.apis.request`. |
| `scheduledJobs` | no | Cron-defined jobs (UTC). |
| `featureFlags` | no | Feature flags the extension reads. |
| `metricsDeclared` | no | Metrics the extension emits. Defensive against typos. |
| `connector` | conditional | Required iff `kind = "connector"`. |

---

## 4. Writing the entrypoint

The entrypoint is `src/index.ts`. Its default export must be the result of `defineExtension` (for `kind: "extension"`) or `defineConnector` (for `kind: "connector"`).

### 4.1 The `defineExtension` shape

```typescript
import { defineExtension, type ExtensionContext, type InboundRequest } from "@eks/sdk";

export default defineExtension({
  /** The manifest is loaded from eks.manifest.json5 by the bundler;
   *  you may also pass it inline (useful for tests). */
  manifest: undefined,

  /** Called once when the isolate is cold-started. Register all
   *  handlers, subscribers, steps, and scheduled jobs here.
   *  Anything not registered in setup() will not be available at
   *  invocation time. */
  setup(ctx: ExtensionContext) {
    // Register HTTP handlers
    ctx.apis.register("hello", helloHandler);
    ctx.apis.register("echo", echoHandler);

    // Subscribe to domain events
    ctx.events.subscribe("booking.created.v1", onBookingCreated);

    // Register workflow steps
    ctx.apis.registerStep("compute_balance", computeBalanceStep);

    // Register scheduled jobs (must match manifest.scheduledJobs)
    ctx.scheduled.register("nightly_digest", nightlyDigestJob);

    ctx.logger.info("extension_ready", {
      version: ctx.installation.version,
      handlers: ["hello", "echo"],
      subscribers: ["booking.created.v1"],
      steps: ["compute_balance"],
      scheduled: ["nightly_digest"],
    });
  },

  /** Called once when the isolate is being shut down (graceful).
   *  Use it to flush buffers, close connections, etc. The platform
   *  gives you 5 seconds; anything still running after that is
   *  force-killed. */
  async shutdown(ctx: ExtensionContext) {
    ctx.logger.info("extension_shutdown", { version: ctx.installation.version });
  },
});
```

### 4.2 Handler signatures

```typescript
type RouteHandler = (
  req: InboundRequest,
  ctx: ExtensionContext,
) => Promise<OutboundResponse> | OutboundResponse;

interface InboundRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;                          // the full path including /api/v1/extensions/:slug/route/...
  route: string;                         // the route name as registered (e.g. "hello")
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body: unknown;                         // already validated against any schema the route declared
  user: Principal | null;                // the M2 Principal, null if the route is public
  tenant: { id: string; region?: string };
  idempotencyKey: string | null;
  invocationId: string;
  correlationId: string;
}

interface OutboundResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
```

### 4.3 Subscriber signatures

```typescript
type Subscriber<T = unknown> = (
  event: DomainEvent<T>,
  ctx: ExtensionContext,
) => Promise<void> | void;

interface DomainEvent<T = unknown> {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;                    // ISO timestamp
  version: 1;
  tier: "domain" | "integration" | "internal";
  correlationId: string;
  causationId: string | null;
  traceId: string;
  actorUserId: string | null;
  organizationId: string;
  payload: T;
}
```

### 4.4 Scheduled job signatures

```typescript
type ScheduledJobHandler = (
  trigger: { name: string; firedAt: string; invocationId: string },
  ctx: ExtensionContext,
) => Promise<void>;

ctx.scheduled.register("nightly_digest", async (trigger, ctx) => {
  ctx.logger.info("digest_started", { trigger: trigger.name });
  // ...
});
```

The platform invokes scheduled jobs based on the manifest's `scheduledJobs` cron expressions (UTC). The cron schedule is owned by the platform, not the extension — there is no `setInterval` inside the isolate.

---

## 5. Registering capabilities — what goes in `setup()`

`setup()` is the only place capabilities may be registered. The runtime freezes the registry after `setup()` returns; attempts to register handlers/subscribers later throw `CapabilityRegistrationClosedError`.

### 5.1 HTTP routes

```typescript
ctx.apis.register("hello", async (req, ctx) => {
  return { status: 200, body: { hello: "world", user: req.user?.id ?? null } };
});
```

The route is mounted at `GET /api/v1/extensions/loyalty-engine/route/hello`. The HTTP method is determined by the route name's suffix:
- `:GET` suffix → GET (e.g. `"hello:GET"`)
- `:POST` suffix → POST
- No suffix → any method (handler decides based on `req.method`)

### 5.2 Event subscriptions

```typescript
ctx.events.subscribe("booking.created.v1", async (event, ctx) => {
  const userId = event.payload.customerId;
  const award = ctx.config.get<number>("pointsPerBooking");
  await ctx.storage.tx(async (tx) => {
    const balance = Number(await tx.get(`points:${userId}`)) ?? 0;
    await tx.set(`points:${userId}`, balance + award);
  });
  ctx.metrics.counter("points_awarded", { source: "booking.created.v1" });
});
```

The event type must appear in `requiredEvents` or `ctx.events.subscribe` throws at registration time.

> **Platform events vs. extension events.** The `eventType` strings an extension subscribes to come in two namespaces. **Domain events emitted by the platform's own aggregates** (`Booking.Created`, `Cook.Onboarded`, `Payment.Captured`, `Order.Fulfilled`, etc.) are defined in the `DEVELOPER_EVENTS`-style registries of the corresponding `@eks/domain` context packages — see `src/packages/domain/contexts/booking/events.ts`, `src/packages/domain/contexts/cook/events.ts`, etc. These follow the `{Aggregate}.{PastTenseVerb}` convention with PascalCase parts. **Events emitted by the extension itself** (`loyalty.awarded.v1`, `points.redeemed.v1`) follow a separate convention — lowercase dotted name, `.vN` suffix, declared in `publishedEvents` — and are emitted via `ctx.events.publish`. The extension can subscribe to **either** kind via `ctx.events.subscribe`, but it can only **publish** its own events; the `{Aggregate}.` prefixes owned by the platform (`Extension.`, `Connector.`, `Workflow.`, `Event.`, `Manifest.`, `Package.`, `Secret.`, plus the M1/M2 business aggregates) are reserved. The platform-side developer-platform events are defined in `@eks/developer`'s `DEVELOPER_EVENTS` registry; the business-domain events are defined in `@eks/domain`.

### 5.3 Workflow steps

```typescript
ctx.apis.registerStep("compute_balance", async (input, ctx) => {
  const balance = Number(await ctx.storage.get(`points:${input.userId}`)) ?? 0;
  return { userId: input.userId, balance };
});
```

Steps are invoked by the workflow engine (see `@eks/workflow`); they are not directly callable via HTTP. A step may call `ctx.storage`, `ctx.apis.invoke`, etc., just like a route handler.

### 5.4 Scheduled jobs

```typescript
ctx.scheduled.register("nightly_digest", async (trigger, ctx) => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const users = await listActiveUsers(ctx, yesterday);
  for (const u of users) {
    const balance = Number(await ctx.storage.get(`points:${u.id}`)) ?? 0;
    await ctx.apis.invoke("ext:notifications", "sendEmail", {
      to: u.email,
      template: "loyalty_digest",
      variables: { balance, period: "yesterday" },
    });
  }
});
```

The `name` passed to `ctx.scheduled.register` must match a `name` in `manifest.scheduledJobs`. Unknown registrations throw at `setup()` time.

---

## 6. A complete "hello world" extension

### 6.1 Create the project

```bash
eks create my-hello --kind extension --slug hello-world --publisher pub_acme
cd my-hello
bun install
```

This produces the project layout from §2 with a minimal manifest and a "ping" handler.

### 6.2 The manifest (`eks.manifest.json5`)

```json5
{
  "slug": "hello-world",
  "name": "Hello World",
  "version": "0.1.0",
  "kind": "extension",
  "description": "A minimal Eks-Food extension that demonstrates the SDK surface.",
  "publisher": { "id": "pub_acme" },
  "license": "Apache-2.0",
  "capabilities": ["apis", "events", "storage", "cache", "metrics", "tracer"],
  "permissions": [
    "invoke.apis",
    "subscribe.events",
    "publish.events",
    "access.storage",
    "access.cache"
  ],
  "requiredAPIs": [],
  "requiredEvents": ["booking.created.v1"],
  "configurationSchema": {
    "type": "object",
    "properties": {
      "greeting": { "type": "string", "default": "hello" }
    }
  },
  "compatibilityRanges": { "eks-platform": "^3.0.0", "@eks/sdk": "^3.0.0" }
}
```

### 6.3 The entrypoint (`src/index.ts`)

```typescript
import { defineExtension, type DomainEvent } from "@eks/sdk";

interface BookingCreatedPayload {
  bookingId: string;
  customerId: string;
  regionId: string;
  total: { amount: number; currency: string };
}

export default defineExtension({
  setup(ctx) {
    // 1. Register a simple HTTP route.
    ctx.apis.register("greet:GET", async (req) => {
      const greeting = ctx.config.get<string>("greeting");
      const name = (req.query.name as string) ?? "world";
      const visits = Number(await ctx.storage.get(`visits:${name}`)) ?? 0;
      await ctx.storage.set(`visits:${name}`, visits + 1, { ttlSeconds: 86_400 });
      ctx.metrics.counter("greetings", { name });
      return { status: 200, body: { message: `${greeting}, ${name}!`, visits: visits + 1 } };
    });

    // 2. Subscribe to a domain event.
    ctx.events.subscribe<BookingCreatedPayload>(
      "booking.created.v1",
      async (event: DomainEvent<BookingCreatedPayload>) => {
        ctx.logger.info("booking_seen", {
          bookingId: event.payload.bookingId,
          customerId: event.payload.customerId,
        });
        // Cache the customer's last-seen booking for 1 hour.
        await ctx.cache.set(
          `last_booking:${event.payload.customerId}`,
          event.payload.bookingId,
          3_600,
        );
        // Publish an integration event so other extensions can react.
        await ctx.events.publish(
          "hello_world.booking_seen.v1",
          { bookingId: event.payload.bookingId, seenBy: ctx.installation.id },
          { aggregateId: event.payload.bookingId },
        );
      },
    );

    ctx.logger.info("hello_world_ready", { version: ctx.installation.version });
  },

  async shutdown(ctx) {
    ctx.logger.info("hello_world_shutdown");
  },
});
```

### 6.4 Run it locally

```bash
eks test                # run the Vitest suite under tests/
eks dev                 # spin up a local runtime at http://localhost:9100
```

In a separate terminal:

```bash
# Call the registered route
curl http://localhost:9100/api/v1/extensions/hello-world/route/greet?name=amara
# → { "message": "hello, amara!", "visits": 1 }

# Simulate an event delivery
eks events:replay --type booking.created.v1 --payload '{"bookingId":"b_1","customerId":"u_1","regionId":"r_1","total":{"amount":1000,"currency":"usd"}}'

# Inspect the captured logs
eks logs --tail
```

### 6.5 Test it

`tests/handlers/greet.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createExtensionHarness } from "@eks/testing";
import extension from "../src";

describe("hello-world/greet", () => {
  const harness = createExtensionHarness(extension, {
    config: { greeting: "kia ora" },
  });

  it("greets by name and counts visits", async () => {
    const r1 = await harness.invoke("greet:GET", { query: { name: "amara" } });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ message: "kia ora, amara!", visits: 1 });

    const r2 = await harness.invoke("greet:GET", { query: { name: "amara" } });
    expect(r2.body.visits).toBe(2);
  });

  it("subscribes to booking.created.v1 and publishes hello_world.booking_seen.v1", async () => {
    const events = await harness.deliverEvent("booking.created.v1", {
      bookingId: "b_1",
      customerId: "u_1",
      regionId: "r_1",
      total: { amount: 1000, currency: "usd" },
    });
    expect(events.published).toEqual([
      expect.objectContaining({ eventType: "hello_world.booking_seen.v1" }),
    ]);
  });
});
```

---

## 7. Testing locally with the CLI

The `eks` CLI provides three local workflows:

### 7.1 `eks test`

Runs the Vitest suite under `tests/` with the `@eks/testing` harness materialised. No network calls; no real Prisma. The harness captures every SDK call into queryable logs:

```bash
eks test
# ✓ tests/handlers/greet.spec.ts (2 tests) 12ms
# ✓ tests/subscribers/booking.created.spec.ts (1 test) 18ms
# 3 tests passed, 0 failed
```

### 7.2 `eks dev`

Spins up a local runtime at `http://localhost:9100` that mounts your extension exactly as production would, including:
- The M1 `apiHandler` and `@eks/auth/middleware` (with a fake Principal you can configure in `.eks/dev.json5`).
- The M1 `EventBus` (in-process; events are routed synchronously to your subscribers).
- An in-memory Prisma mock for `ExtensionStorage`.
- An in-memory cache.
- The egress proxy (with a recording mode that captures all outbound calls to `.eks/egress.log`).

```bash
eks dev --port 9100 --tenant org_dev
```

### 7.3 `eks validate`

Validates the manifest against the schema, checks compatibility ranges against the installed CLI version, and runs a dry-run of the bundler to catch syntax errors:

```bash
eks validate
# ✓ manifest is valid (slug, version, capabilities, permissions, configurationSchema)
# ✓ compatibility ranges satisfied (eks-platform ^3.0.0 → 3.1.2)
# ✓ bundler dry-run succeeded (4.2 KB output)
# ✓ no forbidden imports detected
```

The `--strict` flag enables extra checks: every `requiredSecrets` entry must have a corresponding `.eks/dev.json5` entry; every `requiredEvent` must have at least one fixture under `tests/fixtures/events/`; every `metricsDeclared` entry must be emitted by at least one test.

---

## 8. Packaging and publishing

Once local tests pass:

```bash
eks package              # produces dist/hello-world-0.1.0.ekx (signed, integrity-stamped)
eks publish              # pushes the package to the private registry
```

The `eks package` step is described in detail in `PACKAGING_GUIDE.md` (dependency locking, integrity verification, Ed25519 signing, tar+zstd compression, reproducible builds). The `eks publish` step is described in `PUBLISHING_GUIDE.md` (validation pipeline, compatibility checks, malware-scan hooks, staged rollout, rollback).

After publishing, your extension appears in the Developer Console under "Registry" and can be installed by tenants whose `Publisher` has been granted access to yours. The install flow is documented in `PUBLISHING_GUIDE.md` §4.

---

## 9. Common patterns

### 9.1 Idempotent event handler

```typescript
ctx.events.subscribe("booking.created.v1", async (event, ctx) => {
  const idempotencyKey = `award:${event.eventId}`;
  const alreadyHandled = await ctx.storage.get(idempotencyKey);
  if (alreadyHandled) {
    ctx.logger.debug("duplicate_event_skipped", { eventId: event.eventId });
    return;
  }
  await awardPoints(ctx, event.payload);
  await ctx.storage.set(idempotencyKey, "1", { ttlSeconds: 86_400 * 7 });
});
```

### 9.2 Transactional storage + event publish

```typescript
await ctx.storage.tx(async (tx) => {
  const balance = Number(await tx.get(`points:${userId}`)) ?? 0;
  await tx.set(`points:${userId}`, balance + 100);
  // The publish is staged in the same Prisma tx; durable + atomic.
  await ctx.events.publish("loyalty.awarded.v1", { userId, points: 100 });
});
```

### 9.3 Calling a connector with retry

```typescript
const order = await ctx.retry.withBackoff(
  () => ctx.apis.fetch("connector:acme-pos", `/orders/${orderId}`),
  { maxAttempts: 4, retryOn: (e) => e instanceof Error && e.name === "ConnectorUnavailableError" },
);
```

### 9.4 Reading a secret + making an outbound HTTP call

```typescript
const stripeKey = await ctx.secrets.get("STRIPE_SECRET_KEY");
const res = await ctx.apis.request("https://api.stripe.com/v1/charges", {
  method: "POST",
  headers: { Authorization: `Bearer ${stripeKey}` },
  body: new URLSearchParams({ amount: "1000", currency: "usd" }),
});
```

### 9.5 Scheduled cleanup job

```typescript
ctx.scheduled.register("purge_expired", async (trigger, ctx) => {
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  const expired = await ctx.storage.list("temp:");
  for (const { key, value } of expired) {
    if (value < cutoff) await ctx.storage.delete(key);
  }
  ctx.metrics.gauge("temp_keys_after_purge", (await ctx.storage.list("temp:")).length);
});
```

### 9.6 Health-aware graceful shutdown

```typescript
export default defineExtension({
  setup(ctx) {
    ctx.apis.register("health:GET", async () => ({ status: 200, body: { ok: true } }));
  },
  async shutdown(ctx) {
    // Drain in-flight invocations; the runtime gives 5s.
    const inFlight = await ctx.tracer.startSpan("drain_in_flight", async (span) => {
      let count = 0;
      while (count < 50) {
        const inflight = await ctx.metrics.currentInFlight();
        if (inflight === 0) break;
        await new Promise((r) => setTimeout(r, 100));
        count++;
      }
      return count;
    });
    ctx.logger.info("shutdown_drained", { iterations: inFlight });
  },
});
```

---

## 10. Anti-patterns to avoid

| Anti-pattern | Why it's bad | Do this instead |
|---|---|---|
| Importing `@prisma/client` | Bypasses tenancy, audit, permissions | Use `ctx.storage` |
| Using `setTimeout` for scheduling | Bypasses the platform scheduler; survives invocation | Use `manifest.scheduledJobs` + `ctx.scheduled.register` |
| Reading `process.env` | Bypasses config + secrets | Use `ctx.config` and `ctx.secrets` |
| Calling `fetch("https://...")` directly | Bypasses egress allowlist | Use `ctx.apis.request` |
| Storing PII in `ctx.logger` | PII leaks to `ExtensionLog` | Redact PII before logging |
| Catching errors silently | Hides failures from observability | Always `ctx.logger.error` then rethrow or return a structured error |
| Subscribing to events not in `requiredEvents` | Manifest mismatch; runtime will reject | Add the event to `requiredEvents` |
| Publishing events without a version suffix | Breaks schema evolution | Use `myaggregate.verb.v1` |
| Mutating config at runtime | Config is operator-managed | Use `ctx.storage` for runtime state |
| Holding the storage tx open across an outbound call | Holds a DB transaction during network I/O | Fetch first, then `ctx.storage.tx` |

---

## 11. Cross-references

| Topic | Document |
|---|---|
| The `ExtensionContext` API surface | `SDK_GUIDE.md` |
| Connector authoring (kind: "connector") | `CONNECTOR_SDK_GUIDE.md` |
| Packaging, signing, integrity | `PACKAGING_GUIDE.md` |
| Publishing, rollout, rollback | `PUBLISHING_GUIDE.md` |
| Runtime lifecycle, sandbox | `RUNTIME_ARCHITECTURE.md` |
| Capability permissions | `PERMISSION_MODEL.md` |
| Secret lifecycle | `SECURITY_MODEL.md` |
| `eks` CLI command reference | `CLI_GUIDE.md` |
| 30/60/90 onboarding | `DEVELOPER_ONBOARDING.md` |
