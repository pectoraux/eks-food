# Eks-Food Connector Ecosystem — Provider Development Guide

> **Audience:** Connector authors, platform engineers, integration partners. Read alongside `docs/developer/CONNECTOR_SDK_GUIDE.md` (the M3 `@eks/connector-sdk` contract), `docs/integration/CONNECTOR_DEVELOPMENT.md` (the M4 universal-connector authoring guide), `PROVIDER_SELECTION.md` (the routing engine that picks between providers), and `CONNECTOR_OPERATIONS.md` (operating production connectors).
>
> **Status:** Milestone 5 — Production Connector Implementations & External Service Integrations. This document describes the **target M5 architecture**: the `@eks/connectors` package (a layer above the M4 `@eks/integration` runtime), the extended Prisma schema (`ExternalProvider`, `ProviderConfiguration`, `ProviderHealth`, `ProviderCapability`, `ProviderCredential`, `ProviderRegion`, `ConnectorCache`, `SynchronizationHistory`, plus the domain connection models `CalendarConnection`, `WeatherProvider`, `MapProvider`, `RestaurantConnection`, `ProcurementConnection`, `MerchantConnection`, `GovernmentConnection`, `NotificationProvider`, `CommunicationProvider`), and the `/api/v1/providers/*` route surface.

---

## 1. The Provider Abstraction

M4 introduced the **Universal Connector Platform** (`@eks/integration`): a generic runtime that executes any connector implementing the `Connector` interface from `@eks/connector-sdk`. M5 builds **production connectors on top of that runtime** for the specific external-service categories Eks-Food actually uses: maps, weather, calendar, government, restaurants, procurement, merchant, notifications, communications, identity.

A **provider** is a concrete external service within a category — e.g. within the maps category, Google Maps, HERE, Mapbox, and OpenStreetMap are four providers. A **connector** is the adapter package that talks to one provider. Within a category, multiple connectors can be installed simultaneously and the **provider selection engine** (see `PROVIDER_SELECTION.md`) routes each business call to the best available connector for that tenant, region, capability set, and cost envelope.

Business code never imports a connector directly. It calls a typed **service surface** exported from the relevant `@eks/connectors/<category>` sub-package (e.g. `maps.geocode()`, `weather.current()`, `calendar.createEvent()`), and the selection engine resolves the call to a specific `ProviderConfiguration` row at runtime.

```
                Business code (e.g. matching engine)
                          │
                          ▼
        @eks/connectors/maps  ── maps.geocode(input)
                          │
                          ▼
              ProviderSelectionEngine ── picks one
                          │            (weighted + health + region + capability)
                ┌─────────┼─────────┐
                ▼         ▼         ▼
           GoogleMaps  HERE     Mapbox    ← Provider adapters
                │         │         │
                ▼         ▼         ▼
           @eks/integration runtime (retry, circuit-breaker, rate-limit, cache)
                          │
                          ▼
                 ExternalProvider (Google) ── actual HTTPS call
```

---

## 2. Package Layout

The `@eks/connectors` package lives at `src/packages/connectors/` and follows the M1/M2/M3/M4 package pattern: `package.json`, `index.ts` barrel, one sub-package per category.

```
src/packages/connectors/
├── package.json            (name: "@eks/connectors")
├── index.ts                (barrel: re-exports category barrels)
├── selection.ts            (ProviderSelectionEngine, the routing core)
├── cache.ts                (ConnectorCache helpers)
├── normalization.ts        (the canonical schema layer per category)
├── testing/
│   └── harness.ts          (provider simulation + VCR-style fixtures)
├── maps/
│   ├── index.ts            (service surface: geocode, route, eta, …)
│   ├── types.ts            (CanonicalGeo types)
│   ├── normalize.ts        (provider-specific → CanonicalGeo)
│   └── adapters/
│       ├── google-maps.ts
│       ├── here.ts
│       ├── mapbox.ts
│       └── osm.ts
├── weather/                (same shape: index/types/normalize/adapters/*)
├── calendar/
├── government/
├── restaurants/
├── procurement/
├── merchant/
├── notifications/
├── communications/
└── identity/
```

Each adapter file exports a default object that implements the **ProviderAdapter** interface (see §4 below). The barrel `index.ts` registers each adapter with the `ProviderSelectionEngine` at import time so business code only needs `import { maps } from "@eks/connectors"`.

---

## 3. The Prisma Schema

The M5 schema extends the M4 `Connector*` models with a provider-centric view. The two layers coexist: `Connector`/`ConnectorConfiguration` are the generic M4 runtime rows; `ExternalProvider`/`ProviderConfiguration`/etc. are the M5 provider-aware rows layered on top.

### 3.1 `ExternalProvider`

The catalog of provider identities Eks-Food knows about. Seeded by the platform; not tenant-editable.

```prisma
model ExternalProvider {
  id            String   @id @default(cuid())
  category      String   // maps | weather | calendar | government | restaurants | procurement | merchant | notifications | communications | identity
  code          String   // e.g. "google-maps", "here", "openweather", "ghana-fda"
  displayName   String
  documentationUrl String?
  status        String   @default("ACTIVE") // ACTIVE | DEPRECATED | RETIRED
  // Region coverage (ISO-3166-1 alpha-2 list, pipe-separated)
  regions       String   @default("")        // "GH|NG|KE|ZA"
  // Default capabilities (subset of ProviderCapability)
  capabilities  String   @default("[]")      // JSON array
  // Pricing envelope (per 1k calls, in USD cents, informational)
  costPer1kUsdCents Int?
  // Hard rate limits the provider enforces (used by the limiter)
  rateLimitPerSec   Int?
  rateLimitPerDay   Int?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  configurations ProviderConfiguration[]
  capabilities   ProviderCapability[]
  health         ProviderHealth[]
  regions_rel    ProviderRegion[]

  @@unique([category, code])
  @@index([category, status])
}
```

### 3.2 `ProviderConfiguration`

A tenant's installed instance of a provider. One row per (organization, provider) pair.

```prisma
model ProviderConfiguration {
  id              String   @id @default(cuid())
  organizationId  String
  providerId      String   // → ExternalProvider.id
  category        String   // denormalised from ExternalProvider for index efficiency
  // Tenant preferences (0..100 weight; the selection engine sums and normalises)
  weight          Int      @default(50)
  // Tenant-scoped config: API endpoint override, timeout overrides, feature toggles
  config          String   @default("{}") // JSON
  status          String   @default("ACTIVE") // ACTIVE | PAUSED | DISABLED
  installedAt     DateTime @default(now())
  pausedAt        DateTime?
  updatedAt       DateTime @updatedAt

  provider        ExternalProvider @relation(fields: [providerId], references: [id])
  credentials     ProviderCredential[]
  capabilities    ProviderCapability[]
  health          ProviderHealth[]
  cache           ConnectorCache[]
  syncHistory     SynchronizationHistory[]
  // Category-specific connection rows (only one is populated per row, by category)
  calendar        CalendarConnection?
  weather         WeatherProvider?
  maps            MapProvider?
  restaurant      RestaurantConnection?
  procurement     ProcurementConnection?
  merchant        MerchantConnection?
  government      GovernmentConnection?
  notification    NotificationProvider?
  communication   CommunicationProvider?

  @@unique([organizationId, providerId])
  @@index([organizationId, category, status])
}
```

### 3.3 `ProviderCredential`

Encrypted credentials, scoped to a `ProviderConfiguration`. Reuses the M4 `SecretReference` envelope (AES-256-GCM) — see `docs/integration/AUTHENTICATION_GUIDE.md`.

```prisma
model ProviderCredential {
  id              String   @id @default(cuid())
  configId        String   // → ProviderConfiguration.id
  organizationId  String
  name            String   // human label e.g. "Google Maps — prod key"
  authType        String   // api-key | oauth2 | bearer | basic | signed | mtls | custom
  // Encrypted payload (JSON-stringified EncryptedPayload from @eks/security)
  encryptedSecret String
  // Optional key fingerprint / last-4 hint for the UI
  hint            String?
  active          Boolean  @default(true)
  expiresAt       DateTime?
  lastRotatedAt   DateTime?
  lastUsedAt      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  config          ProviderConfiguration @relation(fields: [configId], references: [id])

  @@index([configId, active])
  @@index([organizationId, expiresAt])
}
```

### 3.4 `ProviderHealth`

A time-windowed rollup, refreshed every 60 s by the `@eks/integration` health job. One row per `ProviderConfiguration`.

```prisma
model ProviderHealth {
  id                  String   @id @default(cuid())
  configId            String   @unique
  organizationId      String
  status              String   @default("HEALTHY") // HEALTHY | DEGRADED | UNHEALTHY | UNKNOWN
  // Latency rollups (ms)
  p50LatencyMs        Int?
  p99LatencyMs        Int?
  // Availability in the last 5m window (0..1)
  availability5m      Float    @default(1)
  // Error rate (0..1) — failures / total in last 5m
  errorRate5m         Float    @default(0)
  // Circuit-breaker state mirrored from the runtime
  circuitState        String   @default("CLOSED") // CLOSED | OPEN | HALF_OPEN
  // Sync / cache observations
  lastSyncAt          DateTime?
  syncLagSec          Int      @default(0)
  cacheHitRate5m      Float    @default(0)
  // API usage counters (vs the provider's hard limit)
  callsLastMin        Int      @default(0)
  callsLastDay        Int      @default(0)
  quotaRemainingPct   Float?
  lastError           String?
  updatedAt           DateTime @updatedAt

  config              ProviderConfiguration @relation(fields: [configId], references: [id])

  @@index([organizationId, status])
  @@index([status, updatedAt])
}
```

### 3.5 `ProviderCapability`

Capabilities the provider actually supports *for this tenant* (e.g. a tenant's Google Maps plan might exclude the Distance Matrix API). The selection engine consults this table when matching a request to a provider.

```prisma
model ProviderCapability {
  id              String   @id @default(cuid())
  configId        String   // → ProviderConfiguration.id (null for catalog-level caps)
  providerId      String   // → ExternalProvider.id
  capability      String   // e.g. "geocode", "reverse-geocode", "route", "eta", "matrix", "autocomplete"
  supported       Boolean  @default(true)
  // Quality score 0..100 for this capability (e.g. Google Maps geocode ≈ 98, OSM ≈ 80)
  qualityScore    Int      @default(80)
  // Soft cost per 1k calls (tenant's negotiated rate, USD cents)
  costPer1kUsdCents Int?
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  config          ProviderConfiguration? @relation(fields: [configId], references: [id])
  provider        ExternalProvider @relation(fields: [providerId], references: [id])

  @@unique([configId, capability])
  @@index([providerId, capability, supported])
}
```

### 3.6 `ProviderRegion`

Per-region availability and routing hints. The selection engine prefers a provider whose region matches the request's region.

```prisma
model ProviderRegion {
  id              String   @id @default(cuid())
  providerId      String   // → ExternalProvider.id
  region          String   // ISO-3166-1 alpha-2 (e.g. "GH") or "GLOBAL"
  // Quality score 0..100 for this region (e.g. OSM quality in GH is lower than Google)
  qualityScore    Int      @default(80)
  // Average observed latency (ms) for this region
  avgLatencyMs    Int?
  // True if the provider has a regional endpoint here
  regionalEndpoint String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  provider        ExternalProvider @relation(fields: [providerId], references: [id])

  @@unique([providerId, region])
  @@index([region])
}
```

### 3.7 `ConnectorCache`

A tenant-and-provider-scoped cache namespace. Used for response caching (geocode results, weather forecasts) and token caching (OAuth refresh tokens, signed-URL signatures). Backed by the M1 `@eks/cache` registry.

```prisma
model ConnectorCache {
  id              String   @id @default(cuid())
  configId        String   // → ProviderConfiguration.id
  organizationId  String
  namespace       String   // e.g. "geocode:v1", "weather:forecast:hourly", "oauth:tokens"
  key             String   // hashed cache key (sha256)
  value           String   // serialised value (may be encrypted for tokens)
  ttlSec          Int      @default(300)
  expiresAt       DateTime
  // Size in bytes for budget enforcement
  sizeBytes       Int      @default(0)
  // Hit/miss counters for the inspector
  hits            Int      @default(0)
  misses          Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  config          ProviderConfiguration @relation(fields: [configId], references: [id])

  @@unique([configId, namespace, key])
  @@index([organizationId, namespace, expiresAt])
}
```

### 3.8 `SynchronizationHistory`

Per-provider sync history (complements the M4 `SynchronizationJob` with provider-aware rollups). One row per sync run.

```prisma
model SynchronizationHistory {
  id              String   @id @default(cuid())
  configId        String   // → ProviderConfiguration.id
  organizationId  String
  category        String
  mode            String   // FULL | INCREMENTAL | DELTA | WEBHOOK
  status          String   // RUNNING | SUCCEEDED | FAILED | PARTIAL
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  durationMs      Int?
  cursorFrom      String?
  cursorTo        String?
  recordsProcessed Int     @default(0)
  recordsCreated   Int     @default(0)
  recordsUpdated   Int     @default(0)
  recordsFailed    Int     @default(0)
  conflicts        Int     @default(0)
  errorMessage     String?
  // Optional link to the M4 SynchronizationJob for full checkpoint replay
  syncJobId       String?

  config          ProviderConfiguration @relation(fields: [configId], references: [id])

  @@index([configId, startedAt])
  @@index([organizationId, category, status])
}
```

### 3.9 Category connection models

The remaining nine models (`CalendarConnection`, `WeatherProvider`, `MapProvider`, `RestaurantConnection`, `ProcurementConnection`, `MerchantConnection`, `GovernmentConnection`, `NotificationProvider`, `CommunicationProvider`) hold the category-specific configuration that doesn't fit in `ProviderConfiguration.config` — e.g. `CalendarConnection` carries the synced calendar ID + sync token; `GovernmentConnection` carries the regulatory body code + establishment license number; `MapProvider` carries the tenant's default bounding box and language. Their shapes are documented in the per-category guides (`CALENDAR_GUIDE.md`, `WEATHER_GUIDE.md`, `MAPS_INTEGRATION.md`, `RESTAURANT_MERCHANT.md`, `PROCUREMENT_GUIDE.md`, `GOVERNMENT_INTEGRATION.md`).

---

## 4. The `Connector` Interface (recap)

M4's `Connector` interface from `@eks/connector-sdk` remains the contract every adapter fulfils. The M5 `ProviderAdapter` interface below extends it with **provider-aware** methods; the selection engine calls these typed methods and the adapter translates them into provider-specific HTTP calls.

```typescript
// src/packages/connector-sdk/types.ts (M4, unchanged in M5)
export interface Connector {
  readonly code: string;
  readonly name: string;
  authenticate(ctx: ConnectorContext): Promise<{ ok: boolean; detail?: string }>;
  poll(ctx: ConnectorContext, cursor?: string): Promise<PollResult>;
  handleWebhook?(ctx: ConnectorContext, payload: unknown, headers: Record<string, string>): Promise<WebhookResult>;
  sync(ctx: ConnectorContext, cursor?: string): Promise<SyncResult>;
  mapSchema(ctx: ConnectorContext, source: Record<string, unknown>): Promise<Record<string, unknown>>;
  healthCheck(ctx: ConnectorContext): Promise<HealthCheckResult>;
}
```

The M5 adapter interface adds **typed call dispatch** for the operations the category surface exposes. Adapters do not implement the call-routing logic — the selection engine picks which adapter to invoke. Adapters only know how to translate one canonical request into one provider call.

```typescript
// src/packages/connectors/types.ts (M5, new)
import type { Connector, ConnectorContext } from "@eks/connector-sdk";

export interface ProviderAdapter<Canonical, CallKind extends string> extends Connector {
  readonly providerCode: string;     // matches ExternalProvider.code
  readonly category: string;          // matches ExternalProvider.category
  readonly supportedCalls: readonly CallKind[];

  /** Invoke one canonical call against this provider. */
  invoke(
    ctx: ConnectorContext,
    kind: CallKind,
    input: unknown,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: string; retryable: boolean }>;

  /** Normalise a provider-specific response into the canonical schema. */
  normalize(kind: CallKind, raw: unknown): Canonical;
}
```

---

## 5. The Provider Adapter Pattern

Every adapter follows the same four-step pattern:

1. **Implement `authenticate`** — validate the credentials, cache the OAuth token (or signed URL) in the `ConnectorCache` table under the `oauth:tokens` / `signed:urls` namespace.
2. **Implement `invoke`** — translate the canonical input into the provider's request shape, call the provider via the M4 runtime (`ConnectorRunner.execute`), translate the response back, and return it.
3. **Implement `normalize`** — a pure function that maps provider-specific JSON into the canonical schema for the category. No I/O. Called by the selection engine after a successful `invoke`.
4. **Implement `healthCheck`** — call the provider's lightweight endpoint (e.g. Google Maps `geocode` with a known query, OpenWeather `health` endpoint) and return `{ healthy, latencyMs, detail }`.

The M4 `Connector.sync` / `poll` / `handleWebhook` methods are inherited unchanged for full-catalog sync (e.g. procurement supplier catalogues, government inspection databases).

---

## 6. Configuration

Per-tenant configuration lives in `ProviderConfiguration.config` as JSON. The shape is **declared in the adapter** via a Zod schema, validated at install time, and surfaced in the Developer Console.

```typescript
// src/packages/connectors/weather/adapters/openweather.ts
import { z } from "zod";

export const OpenWeatherConfig = z.object({
  baseUrl: z.string().url().default("https://api.openweathermap.org"),
  units: z.enum(["metric", "imperial"]).default("metric"),
  lang: z.string().length(2).default("en"),
  timeoutMs: z.number().int().min(500).max(30_000).default(5_000),
  defaultForecastHours: z.number().int().min(1).max(168).default(48),
});

export type OpenWeatherConfigT = z.infer<typeof OpenWeatherConfig>;
```

At install time the `/api/v1/providers/install` route validates the tenant's `config` blob against `OpenWeatherConfig`, persists it on `ProviderConfiguration.config`, and stores the API key on `ProviderCredential.encryptedSecret` via the M4 `AuthProvider` (encrypted with the tenant master key).

---

## 7. Credentials

Credentials are never read by business code. The adapter receives a decrypted `credentials` object on its `ConnectorContext` (already populated by the M4 runtime from `ProviderCredential.encryptedSecret` via `@eks/security`), and never persists them.

```typescript
// Adapter uses credentials from ctx; never reads the DB.
async function invoke(ctx, kind, input) {
  const cfg = OpenWeatherConfig.parse(ctx.config.config);
  const apiKey = ctx.config.credentials.apiKey as string;   // decrypted by runtime
  const url = `${cfg.baseUrl}/data/2.5/weather?q=${encodeURIComponent((input as { q: string }).q)}&units=${cfg.units}&appid=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(cfg.timeoutMs) });
  if (!res.ok) {
    return { ok: false, error: `openweather_${res.status}`, retryable: res.status === 429 || res.status >= 500 };
  }
  return { ok: true, value: await res.json() };
}
```

The credential shape is declared on the adapter so the install UI can render the right form fields:

```typescript
export const OpenWeatherCredentialSchema = z.object({
  apiKey: z.string().min(16).max(64),
});
```

Rotation is performed via `POST /api/v1/providers/:configId/credentials/rotate` — the runtime hot-swaps the active credential, marks the old one `active=false`, and updates `ProviderCredential.lastRotatedAt`. See `CONNECTOR_OPERATIONS.md` §6.

---

## 8. Health Checks

Adapters must implement `healthCheck(ctx)` returning `{ healthy, latencyMs, detail }`. The M4 `HealthMonitor` calls each adapter's `healthCheck` every 60 s and writes the result to `ProviderHealth`.

The contract:

- **Healthy** — provider responded 2xx in under `p99LatencyMs * 2`.
- **Degraded** — responded 2xx but exceeded the latency threshold, or returned a 5xx that retried successfully.
- **Unhealthy** — returned 4xx (other than 429), timed out, or the circuit breaker is OPEN.

The selection engine weights providers by `ProviderHealth.status`: HEALTHY=1.0, DEGRADED=0.5, UNHEALTHY=0.0. A provider with `availability5m < 0.95` is automatically excluded from selection (see `PROVIDER_SELECTION.md` §3).

---

## 9. Schema Validation

Every category declares a **canonical schema** (Zod) and every adapter declares a `normalize` function that produces values matching that schema. The selection engine runs `canonical.parse(adapter.normalize(kind, raw))` after every successful `invoke`; a parse failure is logged, the response is rejected, and the engine tries the next-best provider.

```typescript
// src/packages/connectors/weather/types.ts (canonical)
export const CanonicalWeather = z.object({
  observedAt: z.string().datetime(),
  location: z.object({ lat: z.number(), lon: z.number(), label: z.string().optional() }),
  temperatureC: z.number(),
  feelsLikeC: z.number().optional(),
  humidityPct: z.number().min(0).max(100).optional(),
  windKph: z.number().min(0).optional(),
  windBearingDeg: z.number().min(0).max(360).optional(),
  pressureHpa: z.number().optional(),
  visibilityM: z.number().optional(),
  conditions: z.array(z.object({
    code: z.string(),
    label: z.string(),
    severity: z.enum(["none", "minor", "moderate", "severe", "extreme"]).default("none"),
  })),
});
export type CanonicalWeather = z.infer<typeof CanonicalWeather>;
```

The OpenWeather `normalize` for the `current` call:

```typescript
function normalize(kind, raw): CanonicalWeather {
  const r = raw as OpenWeatherCurrentResponse;
  return {
    observedAt: new Date((r.dt ?? Date.now() / 1000) * 1000).toISOString(),
    location: { lat: r.coord.lat, lon: r.coord.lon, label: r.name },
    temperatureC: r.main.temp,
    feelsLikeC: r.main.feels_like,
    humidityPct: r.main.humidity,
    windKph: (r.wind.speed ?? 0) * 3.6,
    windBearingDeg: r.wind.deg,
    pressureHpa: r.main.pressure,
    visibilityM: r.visibility,
    conditions: (r.weather ?? []).map(w => ({
      code: `openweather:${w.id}`,
      label: w.description,
      severity: severeWeatherCodes.has(w.id) ? "severe" : "none",
    })),
  };
}
```

---

## 10. The Provider Selection Engine

The selection engine is the routing core of `@eks/connectors`. Its public surface:

```typescript
import { ProviderSelectionEngine } from "@eks/connectors/selection";

export const selection = new ProviderSelectionEngine({
  // Per-category policies (see PROVIDER_SELECTION.md §4 for the full table)
  policies: {
    maps:     { strategy: "weighted-health", preferRegion: true,  fallbackChain: true },
    weather:  { strategy: "cost-aware",       preferRegion: false, fallbackChain: true },
    calendar: { strategy: "tenant-pinned",    preferRegion: false, fallbackChain: false },
    government: { strategy: "region-exact",   preferRegion: true,  fallbackChain: false },
  },
});

// Inside the maps service surface:
export const maps = {
  async geocode(input: GeocodeInput): Promise<CanonicalGeocode> {
    return selection.invoke("maps", "geocode", input);
  },
};
```

The engine:

1. **Loads** all `ProviderConfiguration` rows for `(organizationId, category)` where `status = ACTIVE`.
2. **Filters** by `ProviderCapability` — drops any provider whose row for `capability = "geocode"` has `supported = false`.
3. **Filters** by `ProviderHealth` — drops any provider with `status = UNHEALTHY` or `availability5m < 0.95`.
4. **Filters** by region — if the request specifies a region (e.g. the cook's address is in GH), drops providers whose `ProviderRegion` quality score for GH is `< 30`.
5. **Scores** the survivors — `score = weight * healthFactor * capabilityQuality * (1 - costPenalty) * regionFactor`.
6. **Picks** the top-scored provider (or, for `weighted-health`, picks probabilistically by score share).
7. **Invokes** the adapter's `invoke(ctx, kind, input)` via the M4 `ConnectorRunner` (retry + circuit breaker).
8. **On failure** — if `retryable=true` and the strategy allows fallback, the engine tries the next provider in the sorted list, marking the failed provider's health as DEGRADED.

Business code receives the canonical value. It never knows which provider answered. See `PROVIDER_SELECTION.md` for the full algorithm.

---

## 11. Normalization

Normalization is the pure-function layer that lets business code stay provider-agnostic. It is implemented per-category in `src/packages/connectors/<category>/normalize.ts` and per-adapter in `adapters/<provider>.ts`. The category file declares the canonical Zod schema; each adapter declares how its raw response maps to it.

Normalization rules:

- **Pure** — no I/O, no `Date.now()` (timestamps come from the raw response or are passed in).
- **Total** — every field in the canonical schema must be populated or marked optional; partial normalization is a bug.
- **Lossless** — provider-specific codes (e.g. `openweather:200` for thunderstorm) are preserved in a structured `code` field so downstream code can still differentiate.
- **Unit-normalised** — every temperature is °C, every distance is metres, every duration is seconds, every timestamp is ISO-8601 UTC. The adapter converts from provider-native units.

A normalisation unit-test harness in `src/packages/connectors/testing/harness.ts` replays recorded provider responses through the adapter and asserts the canonical output. Fixtures live in `__fixtures__/<provider>/<call-kind>.json` next to the adapter.

---

## 12. Caching

Three cache layers, all backed by the `ConnectorCache` table:

1. **Response cache** — for idempotent reads (geocode, weather current, place lookup). TTL is per-category (geocode 7 days, weather current 2 min, forecast 10 min). Key is the canonical input hash.
2. **Token cache** — for OAuth access tokens, signed-URL signatures, session cookies. TTL = provider-reported expiry minus 60 s. Stored encrypted (re-using the M4 `SecretReference` envelope).
3. **Negative cache** — for "not found" responses (404 on geocode, place lookup). TTL 60 s to prevent retry storms.

The selection engine checks the cache before invoking any adapter. On a hit, it returns the cached canonical value directly (no provider call, no rate-limit consumption). Cache writes happen after a successful `invoke` + `normalize` + `canonical.parse`.

```typescript
// src/packages/connectors/cache.ts (excerpt)
import { db } from "@/lib/db";

export async function cacheGet<T>(configId: string, namespace: string, key: string): Promise<T | null> {
  const row = await db.connectorCache.findFirst({
    where: { configId, namespace, key: sha256(key), expiresAt: { gt: new Date() } },
  }).catch(() => null);
  if (!row) return null;
  await db.connectorCache.update({ where: { id: row.id }, data: { hits: { increment: 1 } } }).catch(() => null);
  return JSON.parse(row.value) as T;
}

export async function cacheSet<T>(configId: string, organizationId: string, namespace: string, key: string, value: T, ttlSec: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSec * 1000);
  await db.connectorCache.upsert({
    where: { configId_namespace_key: { configId, namespace, key: sha256(key) } },
    create: { configId, organizationId, namespace, key: sha256(key), value: JSON.stringify(value), ttlSec, expiresAt, sizeBytes: Buffer.byteLength(JSON.stringify(value)) },
    update: { value: JSON.stringify(value), ttlSec, expiresAt, sizeBytes: Buffer.byteLength(JSON.stringify(value)) },
  }).catch(() => null);
}
```

Cache inspector UI: see `CONNECTOR_OPERATIONS.md` §3.

---

## 13. Retries

Adapters do not implement their own retry loops. The M4 `ConnectorRunner` wraps every `invoke` in `withRetry` from `@eks/common`:

- **Max attempts**: 3 (configurable per `ProviderConfiguration.config.retry.maxAttempts`).
- **Base delay**: 200 ms (exponential: `baseDelayMs * 2^(attempt-1)`).
- **Jitter**: full jitter (random between 0 and the computed delay).
- **Retryable**: 5xx, 429, network errors, timeouts. **Non-retryable**: 4xx (other than 429), 3xx, AUTH_FAILED.
- **Budget**: 10 retries per minute per `configId` (the M4 `RetryBudget`). Exceeding the budget opens the circuit breaker.

```typescript
// ConnectorRunner (M4, unchanged) — invoked by the selection engine
const result = await withRetry(async (attempt) => {
  attempts = attempt;
  return adapter.invoke(ctx, kind, input);
}, {
  maxAttempts: 3,
  baseDelayMs: 200,
  retryIf: (e) => !String(e).includes("AUTH_FAILED") && !String(e).includes("400_"),
});
```

---

## 14. Circuit Breakers

One circuit breaker per `ProviderConfiguration.id`, persisted via `ProviderHealth.circuitState`. The M4 `CircuitBreaker` (from `@eks/common`):

- **CLOSED** — normal operation. Requests pass through.
- **OPEN** — `failureThreshold` (default 5) failures within `windowMs` (60 s) → all requests fail fast with `CIRCUIT_OPEN` for `cooldownMs` (30 s).
- **HALF_OPEN** — after `cooldownMs`, one trial request is allowed. Success → CLOSED; failure → OPEN (with a fresh cooldown).

The selection engine skips providers whose breaker is OPEN. When a breaker transitions OPEN → CLOSED, the engine emits a `ProviderCircuitRecovered` event (M5 integration event, fanned out via the M1 `EventOutbox`).

Forced reset: `POST /api/v1/providers/:configId/circuit-breaker/reset` — sets `ProviderHealth.circuitState = CLOSED` and clears the in-memory breaker state. Use only after confirming the underlying provider is healthy (see `DISASTER_RECOVERY.md` §6).

---

## 15. End-to-End: Building a New Connector

This walkthrough builds a fictional **Mapbox**-backed geocoding adapter, end to end. (Mapbox is one of the four real providers shipped with M5; the others — Google Maps, HERE, OSM — follow the same pattern.)

### Step 1 — Declare the adapter file

```typescript
// src/packages/connectors/maps/adapters/mapbox.ts
import { z } from "zod";
import type { ProviderAdapter } from "../../types";
import type { CanonicalGeocode } from "../types";
import { CanonicalGeocodeSchema } from "../types";

export const MapboxConfig = z.object({
  baseUrl: z.string().url().default("https://api.mapbox.com"),
  timeoutMs: z.number().int().min(500).max(30_000).default(5_000),
  defaultLimit: z.number().int().min(1).max(10).default(5),
  countries: z.string().optional(), // ISO-3166-1 comma-separated, e.g. "gh,ng"
});
export type MapboxConfigT = z.infer<typeof MapboxConfig>;

export const MapboxCredentialSchema = z.object({
  accessToken: z.string().min(20).max(128),
});

export const mapboxAdapter: ProviderAdapter<CanonicalGeocode, "geocode" | "reverse-geocode"> = {
  providerCode: "mapbox",
  category: "maps",
  name: "Mapbox Geocoding",
  code: "mapbox",
  supportedCalls: ["geocode", "reverse-geocode"],

  async authenticate(ctx) {
    const creds = MapboxCredentialSchema.parse(ctx.config.credentials);
    // Mapbox has no auth endpoint; we validate by hitting a tiny endpoint.
    const res = await fetch(`${ctx.config.config.baseUrl ?? "https://api.mapbox.com"}/geocoding/v5/mapbox.places/accra.json?access_token=${creds.accessToken}&limit=1`, {
      signal: AbortSignal.timeout(5_000),
    });
    return { ok: res.ok, detail: res.ok ? undefined : `mapbox_${res.status}` };
  },

  async invoke(ctx, kind, input) {
    const cfg = MapboxConfig.parse(ctx.config.config);
    const creds = MapboxCredentialSchema.parse(ctx.config.credentials);
    let url: string;
    if (kind === "geocode") {
      const { q } = input as { q: string };
      url = `${cfg.baseUrl}/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${creds.accessToken}&limit=${cfg.defaultLimit}${cfg.countries ? `&country=${cfg.countries}` : ""}`;
    } else {
      const { lat, lon } = input as { lat: number; lon: number };
      url = `${cfg.baseUrl}/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${creds.accessToken}&limit=${cfg.defaultLimit}`;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(cfg.timeoutMs) });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        return { ok: false, error: `mapbox_${res.status}`, retryable };
      }
      return { ok: true, value: await res.json() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
    }
  },

  normalize(kind, raw) {
    const r = raw as MapboxGeocodeResponse;
    return r.features.map(f => ({
      lat: f.center[1],
      lon: f.center[0],
      label: f.place_name,
      addressLine: f.text,
      city: f.context?.find(c => c.id.startsWith("place"))?.text,
      region: f.context?.find(c => c.id.startsWith("region"))?.text,
      country: f.context?.find(c => c.id.startsWith("country"))?.text,
      countryCode: f.context?.find(c => c.id.startsWith("country"))?.short_code?.toUpperCase(),
      confidence: f.relevance ?? 0.5,
      provider: "mapbox" as const,
    })) as unknown as CanonicalGeocode;
  },

  async mapSchema(_ctx, source) { return source; },
  async poll(_ctx) { return { records: [], hasMore: false }; },
  async sync(_ctx) {
    return { recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0, recordsDeleted: 0, conflicts: 0, errors: [] };
  },
  async healthCheck(ctx) {
    const start = Date.now();
    const r = await this.authenticate!(ctx);
    return { healthy: r.ok, latencyMs: Date.now() - start, detail: r.detail };
  },
};
```

### Step 2 — Register the adapter with the selection engine

```typescript
// src/packages/connectors/maps/index.ts
import { selection } from "../selection";
import { mapboxAdapter } from "./adapters/mapbox";
import { googleMapsAdapter } from "./adapters/google-maps";
import { hereAdapter } from "./adapters/here";
import { osmAdapter } from "./adapters/osm";

selection.register(googleMapsAdapter, hereAdapter, mapboxAdapter, osmAdapter);

export const maps = {
  async geocode(input: { q: string; countryCode?: string }) {
    return selection.invoke("maps", "geocode", input);
  },
  async reverseGeocode(input: { lat: number; lon: number }) {
    return selection.invoke("maps", "reverse-geocode", input);
  },
  // … route, eta, matrix, autocomplete, optimizeRoute …
};
```

### Step 3 — Add fixtures and tests

```
src/packages/connectors/maps/adapters/__fixtures__/mapbox/
├── geocode-accra.json     (recorded Mapbox response)
└── reverse-gh.json
```

```typescript
// src/packages/connectors/maps/adapters/__tests__/mapbox.spec.ts
import { describe, it, expect } from "vitest";
import { mapboxAdapter } from "../mapbox";
import fixture from "../__fixtures__/mapbox/geocode-accra.json";
import { CanonicalGeocodeSchema } from "../../types";

describe("mapbox adapter", () => {
  it("normalises a geocode response into the canonical schema", () => {
    const out = mapboxAdapter.normalize("geocode", fixture);
    expect(() => CanonicalGeocodeSchema.parse(out)).not.toThrow();
    expect(out[0].label).toBe("Accra, Greater Accra, Ghana");
    expect(out[0].countryCode).toBe("GH");
  });
});
```

### Step 4 — Install via the API

```bash
curl -X POST /api/v1/providers/install \
  -H 'Content-Type: application/json' \
  -d '{
    "organizationId": "org_abc",
    "providerCode": "mapbox",
    "category": "maps",
    "config": { "countries": "gh,ng", "defaultLimit": 5 },
    "credentials": { "accessToken": "pk.eyJ1Ijo…" },
    "weight": 40
  }'
```

The route validates config against `MapboxConfig`, encrypts credentials via `@eks/security`, writes `ProviderConfiguration` + `ProviderCredential`, and runs the adapter's `authenticate` to confirm. On success, the engine picks up the new provider on the next selection cycle (≤ 60 s).

### Step 5 — Verify

```bash
curl /api/v1/providers/org_abc/maps/geocode?q=accra
# → 200 OK; { "provider": "mapbox", "results": [ … ] }
```

The `provider` field in the response is for ops/diagnostics only. Business code should not branch on it.

---

## 16. API Route Surface

The `/api/v1/providers/*` routes form the M5 provider-management surface, layered on the M4 `/api/v1/integrations/*` routes. All routes are multi-tenant (require `organizationId`, enforced by the M2 RBAC + tenant-isolation middleware).

| Method | Route | Purpose |
|---|---|---|
| `GET`    | `/api/v1/providers` | List installed providers for the tenant (filter by `category`, `status`) |
| `GET`    | `/api/v1/providers/catalog` | List all `ExternalProvider` rows in the catalog (platform-seeded) |
| `POST`   | `/api/v1/providers/install` | Install a provider (creates `ProviderConfiguration` + `ProviderCredential`) |
| `GET`    | `/api/v1/providers/:configId` | Inspect one installed provider (config, credential hint, health, capabilities) |
| `PATCH`  | `/api/v1/providers/:configId` | Update `config` or `weight` |
| `POST`   | `/api/v1/providers/:configId/pause` | Pause (sets `status = PAUSED`) |
| `POST`   | `/api/v1/providers/:configId/resume` | Resume |
| `DELETE` | `/api/v1/providers/:configId` | Remove (cascades to credentials, health, cache) |
| `GET`    | `/api/v1/providers/:configId/credentials` | List credential hints (no secrets) |
| `POST`   | `/api/v1/providers/:configId/credentials/rotate` | Rotate the active credential |
| `GET`    | `/api/v1/providers/:configId/health` | Latest `ProviderHealth` row |
| `GET`    | `/api/v1/providers/:configId/capabilities` | Capability table for this config |
| `PATCH`  | `/api/v1/providers/:configId/capabilities` | Override a capability (e.g. mark matrix unsupported) |
| `GET`    | `/api/v1/providers/:configId/cache` | Cache inspector (paginated) |
| `DELETE` | `/api/v1/providers/:configId/cache` | Flush cache (by namespace or all) |
| `POST`   | `/api/v1/providers/:configId/sync` | Trigger a sync (FULL / INCREMENTAL / DELTA) |
| `GET`    | `/api/v1/providers/:configId/history` | `SynchronizationHistory` rows |
| `POST`   | `/api/v1/providers/:configId/circuit-breaker/reset` | Force-reset the breaker |
| `POST`   | `/api/v1/providers/:category/invoke` | Generic invoke (`{ kind, input }`) — used by service surfaces |
| `GET`    | `/api/v1/providers/dashboard` | Cross-provider dashboard (health rollups, quota usage) |

The per-category service surfaces (`maps.geocode`, `weather.current`, `calendar.createEvent`, etc.) call `POST /api/v1/providers/:category/invoke` internally — but business code calls the typed surface, not the raw HTTP route.

---

## 17. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Branching on `provider` field in business code | Tenant can't failover; provider lock-in | Use only the canonical schema; if provider-specific behaviour is needed, expose it as a `ProviderCapability` row |
| Calling a provider directly from a route handler | Bypasses retry, breaker, rate-limit, cache, audit | Use the typed service surface from `@eks/connectors/<category>` |
| Storing credentials in `ProviderConfiguration.config` | Plaintext at rest | Use `ProviderCredential.encryptedSecret`; the install route does this automatically |
| Long-running sync inside a webhook handler | Webhook times out, DLQ piles up | Webhooks should record an event and return; sync runs in the M4 worker |
| Reading `Date.now()` inside `normalize` | Cache hits become non-deterministic | Source timestamps from the raw response or the request input |
| Implementing per-adapter retry loops | Double-retry on top of the runner's loop | Adapters throw; the M4 `ConnectorRunner` does all retries |
| Tightening a Zod schema after release | Health-check starts failing on old cached responses | Bump the canonical schema version; cache entries store the schema version they were written under |
| Returning provider-specific error codes to the UI | Customers see `mapbox_422` they can't act on | Map to `CONN_ERRORS` from `@eks/connector-sdk`; provider codes go to logs only |

---

## 18. Further Reading

- `PROVIDER_SELECTION.md` — the routing engine internals (weighted routing, health-based, regional, cost-aware, capability matching, failover).
- `CONNECTOR_OPERATIONS.md` — operating production connectors (health monitoring, cache inspector, webhook monitor, rate-limit management, credential rotation, DLQ replay).
- `MAPS_INTEGRATION.md` — the maps category end to end (4 providers, route optimization, failover).
- `CALENDAR_GUIDE.md` — Google Calendar, Outlook, CalDAV; incremental sync.
- `WEATHER_GUIDE.md` — current + forecast + severe weather alerts; caching strategy.
- `PROCUREMENT_GUIDE.md` — supplier catalogues, inventory feeds, purchase orders.
- `GOVERNMENT_INTEGRATION.md` — country-specific plugins; licensing + inspections.
- `RESTAURANT_MERCHANT.md` — POS + reservations + kitchen + merchant catering + invoicing.
- `DISASTER_RECOVERY.md` — provider outage runbook, credential rotation, cache rebuild, DLQ replay.
- `docs/developer/CONNECTOR_SDK_GUIDE.md` — the M3 `Connector` interface contract.
- `docs/integration/CONNECTOR_DEVELOPMENT.md` — the M4 universal-connector authoring guide.
- `docs/integration/AUTHENTICATION_GUIDE.md` — the 8 auth strategies, secret envelope, rotation.
