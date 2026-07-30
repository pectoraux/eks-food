# Eks-Food Connector Ecosystem — The Provider Selection Engine

> **Audience:** Platform engineers, integration architects, performance engineers. Read alongside `PROVIDER_DEVELOPMENT.md` (adapter authoring), `CONNECTOR_OPERATIONS.md` (operating the resulting system), and the per-category guides (`MAPS_INTEGRATION.md`, `CALENDAR_GUIDE.md`, `WEATHER_GUIDE.md`, `PROCUREMENT_GUIDE.md`, `GOVERNMENT_INTEGRATION.md`, `RESTAURANT_MERCHANT.md`).
>
> **Status:** Milestone 5. This document describes the **provider selection engine** — the routing core of `@eks/connectors` that picks one provider per business call from the pool of installed `ProviderConfiguration` rows, and the **normalization layer** that standardizes provider-specific schemas so business code never knows which provider answered.

---

## 1. Why a Selection Engine?

Eks-Food is multi-tenant and operates across multiple regions (Ghana, Nigeria, Kenya, South Africa, with more on the roadmap). Within each category — maps, weather, calendar, government, restaurants, procurement, merchant, notifications, communications, identity — there is rarely a single canonical provider that is best on every dimension:

- **Google Maps** has the best geocoding quality but is the most expensive and has tighter rate limits.
- **OpenStreetMap** is free and has good coverage in Europe but weaker geocoding in West Africa.
- **HERE** has excellent routing in emerging markets and a more permissive quota.
- **OpenWeather** has solid global coverage; **WeatherAPI** is cheaper but has sparser African station density.

Different tenants will prefer different providers. The same tenant may prefer different providers per capability (Google for geocoding, HERE for routing, OSM for autocomplete). A provider may go down, hit its quota, or start returning degraded responses. The selection engine absorbs all of this so business code — the booking matcher, the cook-dispatch scheduler, the procurement planner — never has to.

The contract:

> **Business code calls a typed service surface (`maps.geocode`, `weather.current`, `calendar.createEvent`). The selection engine returns a canonical value. The provider that produced it is invisible — recorded for ops diagnostics only.**

---

## 2. The Data Model (recap)

The selection engine is driven by six Prisma tables, all introduced in M5:

| Model | Role in selection |
|---|---|
| `ExternalProvider` | The catalog of providers Eks-Food knows about (platform-seeded). Carries `category`, `code`, `regions`, `capabilities`, `rateLimitPerSec`, `rateLimitPerDay`, `costPer1kUsdCents`. |
| `ProviderConfiguration` | A tenant's installed instance of a provider. Carries `weight` (0..100 tenant preference), `status` (ACTIVE/PAUSED/DISABLED), `config` (per-tenant overrides). |
| `ProviderCapability` | Per-capability support + quality score. `capability` (e.g. `"geocode"`), `supported`, `qualityScore` (0..100), `costPer1kUsdCents`. |
| `ProviderRegion` | Per-region quality + latency. `region` (ISO-3166-1 alpha-2 or `GLOBAL`), `qualityScore`, `avgLatencyMs`. |
| `ProviderHealth` | Live health rollup. `status`, `availability5m`, `p99LatencyMs`, `circuitState`, `quotaRemainingPct`. |
| `ProviderCredential` | Live credential state. The engine drops providers whose active credential is within 24 h of expiry (treats as DEGRADED). |

A seventh table, `ConnectorCache`, is consulted *before* the engine invokes any adapter — a cache hit short-circuits selection entirely.

---

## 3. The Selection Algorithm

Every call to a typed service surface runs through the same six-stage pipeline.

### Stage 1 — Cache check

```typescript
const cached = await cacheGet<Canonical>(configId, namespace, cacheKey(input));
if (cached) {
  metrics.recordCacheHit(namespace);
  return cached;
}
```

If any provider in the tenant's pool has a cached entry for this input and namespace, the cache returns it directly. No provider is invoked. The cache is shared across all providers in the pool (the canonical schema is provider-agnostic, so a Google Maps geocode response can satisfy a request that Mapbox would have answered).

> **Caveat:** the cache is keyed by the *canonical* input hash, not the provider-specific request. Two providers with different request shapes still share the same cache entry. This is intentional — it maximises cache hit rate — and is safe because the cached value is the normalised canonical schema, not a raw provider response.

### Stage 2 — Candidate loading

```typescript
const candidates = await db.providerConfiguration.findMany({
  where: { organizationId, category, status: "ACTIVE" },
  include: {
    provider: { include: { regions_rel: true, capabilities: { where: { configId: { not: null } } } } },
    health: true,
    credentials: { where: { active: true } },
  },
});
```

All `ACTIVE` providers for `(organizationId, category)` are loaded. PAUSED providers are skipped (operator-paused, e.g. during a billing dispute). DISABLED providers are skipped (permanently removed but kept for audit).

### Stage 3 — Capability filtering

```typescript
const capable = candidates.filter(c =>
  c.provider.capabilities.some(cap =>
    cap.capability === kind && cap.supported && (cap.configId === c.id || cap.configId === null)
  )
);
```

Any provider whose `ProviderCapability` row for the requested `kind` is missing or has `supported = false` is dropped. The `configId === null` case covers catalog-level capabilities (default-on for every tenant); the `configId === c.id` case covers tenant-specific overrides (e.g. a tenant's Google plan that excludes Distance Matrix).

### Stage 4 — Health + credential + circuit filtering

```typescript
const healthy = capable.filter(c => {
  const h = c.health;
  if (!h) return false;
  if (h.status === "UNHEALTHY") return false;
  if (h.availability5m < 0.95) return false;
  if (h.circuitState === "OPEN") return false;
  const activeCred = c.credentials.find(x => x.active);
  if (!activeCred) return false;
  if (activeCred.expiresAt && activeCred.expiresAt.getTime() < Date.now() + 24 * 3600_000) return false;
  return true;
});
```

If the healthy list is empty, the engine *relaxes* the filters in this order (each relaxation emits a `ProviderSelectionDegraded` event):

1. Drop the `expiresAt` check (allow soon-to-expire credentials).
2. Drop the `availability5m < 0.95` check (allow degraded providers).
3. Drop the `circuitState === OPEN` check (allow OPEN providers — the runtime will fail-fast, but at least the call doesn't 404).
4. If still empty, return `NO_PROVIDER_AVAILABLE` to the business surface.

### Stage 5 — Region matching

If the request carries a region hint (e.g. the cook's address is in `GH`), the engine filters out providers whose `ProviderRegion` row for that region has `qualityScore < 30`. This drops, for example, OSM from a Ghana-region request when the operator has configured a stricter threshold.

If no providers survive the region filter, the engine relaxes to `GLOBAL` providers and then to all survivors (with a `ProviderSelectionRegionRelaxed` event).

### Stage 6 — Scoring + selection

The survivors are scored and the engine picks one. The scoring function depends on the category's `strategy` (see §4 below). The general form:

```
score = weight × healthFactor × capabilityQuality × regionFactor × (1 − costPenalty) × tenantPin
```

where:

- `weight` — from `ProviderConfiguration.weight` (0..100, tenant preference).
- `healthFactor` — `availability5m × (1 − errorRate5m) × (p99SLO / max(p99LatencyMs, p99SLO))`.
- `capabilityQuality` — `ProviderCapability.qualityScore / 100`.
- `regionFactor` — `ProviderRegion.qualityScore / 100` for the request region, or 1.0 if no hint.
- `costPenalty` — `min(costPer1kUsdCents / 100, 0.5)` (caps the cost penalty at 50% so cheap-but-bad providers don't always win).
- `tenantPin` — 0.0 or 1.0 for `tenant-pinned` strategy (the pinned provider gets 1.0, everyone else gets 0.0).

### Stage 7 — Invocation + fallback

The engine invokes the selected adapter via the M4 `ConnectorRunner`:

```typescript
const adapter = registry.get(selected.providerCode);
const result = await runner.execute(adapter, ctx, kind);
```

If the result is `{ ok: false, retryable: true }` and the strategy allows fallback, the engine removes the failed provider from the candidate list, marks `ProviderHealth.status = DEGRADED` for that provider, re-scores the survivors, and tries the next one. Up to 3 fallbacks are tried per call (configurable via `ProviderConfiguration.config.maxFallbacks`).

If all fallbacks fail, the engine returns `PROVIDER_INVOCATION_FAILED` to the business surface.

### Stage 8 — Normalization + cache write

On success, the engine runs:

```typescript
const canonical = adapter.normalize(kind, result.value);
const parsed = CanonicalSchema.parse(canonical); // throws on malformed
await cacheSet(configId, organizationId, namespace, cacheKey(input), parsed, ttlFor(kind));
return parsed;
```

A normalisation failure is treated as a provider failure: the engine logs it, marks the provider DEGRADED, and falls back.

---

## 4. Strategies

The `strategy` field on the category policy controls how scoring weights combine. Six built-in strategies ship with M5:

### 4.1 `weighted-health` (default)

Pure score-share sampling: the engine picks a provider with probability proportional to its score. This spreads load across healthy providers and naturally favours higher-quality ones without pinning to a single provider.

Used by: `maps` (default), `communications`, `notifications`.

### 4.2 `cost-aware`

Picks the cheapest provider whose `capabilityQuality ≥ 70` and `availability5m ≥ 0.99`. Falls back to the next cheapest on failure. The cost penalty in the scoring function dominates; quality is a *qualifier*, not a *driver*.

Used by: `weather` (forecasts are commodity-grade; cost matters), `procurement` (catalogue sync is non-interactive).

### 4.3 `tenant-pinned`

Honours `ProviderConfiguration.weight`: the provider with `weight = 100` is always picked (if healthy). Other providers are fallbacks only. This is the right strategy when a tenant has negotiated a commercial relationship with a specific provider (e.g. an enterprise SLA with Google Maps) and wants to pin to it except during outages.

Used by: `calendar` (tenants usually have one calendar provider per user — Google Workspace or Microsoft 365), `identity` (SSO is provider-specific).

### 4.4 `region-exact`

Picks the highest-scoring provider *for the request region*. If the request has no region hint, falls back to `weighted-health`. Providers with no `ProviderRegion` row for the region are dropped entirely (no relaxation). This is the right strategy when regional quality varies wildly (e.g. government APIs are country-specific).

Used by: `government` (each country has its own regulatory APIs; cross-country routing makes no sense).

### 4.5 `quality-first`

Picks the highest `capabilityQuality` provider, ignoring cost. Falls back to the next-highest quality on failure. Used when the cost of a wrong answer dwarfs the per-call cost — e.g. a wrong ETA in cook dispatch causes a missed booking.

Used by: `restaurants` (POS data integrity is critical), `merchant` (catering contracts have SLAs).

### 4.6 `round-robin`

Picks providers in turn (per `organizationId × category × kind`), ignoring score. Useful for load-testing a new provider alongside an existing one, or for fair quota-sharing across equally-good providers.

Used by: no category by default; operators can switch a category to `round-robin` via `PATCH /api/v1/providers/:configId` with `{ "strategy": "round-robin" }`.

### 4.7 Strategy matrix

| Category | Default strategy | Region hint? | Fallback chain? |
|---|---|---|---|
| maps | `weighted-health` | yes (from cook/customer address) | yes (3 fallbacks) |
| weather | `cost-aware` | yes (from lat/lon) | yes (2 fallbacks) |
| calendar | `tenant-pinned` | no | no (one provider per user) |
| government | `region-exact` | yes (mandatory, from organisation country) | no |
| restaurants | `quality-first` | yes (from restaurant address) | yes (2 fallbacks) |
| procurement | `cost-aware` | no | yes (2 fallbacks) |
| merchant | `quality-first` | no | yes (2 fallbacks) |
| notifications | `weighted-health` | yes (from recipient phone country code) | yes (3 fallbacks) |
| communications | `weighted-health` | yes (from recipient phone country code) | yes (3 fallbacks) |
| identity | `tenant-pinned` | no | no |

---

## 5. The Normalization Layer

The normalization layer is what makes the selection engine safe. Because every adapter's response is normalised to the same canonical schema, the engine can swap providers mid-flight without the business code noticing.

### 5.1 The canonical schemas

Each category declares its canonical Zod schema in `src/packages/connectors/<category>/types.ts`. The schemas are **strict** (no `unknown` fields) and **stable** (versioned with a `schemaVersion` field). A sample:

```typescript
// maps
export const CanonicalGeocode = z.array(z.object({
  lat: z.number(),
  lon: z.number(),
  label: z.string(),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  countryCode: z.string().length(2).optional(),
  confidence: z.number().min(0).max(1),
  provider: z.string(), // for ops only; business code MUST NOT branch on this
}));

// weather
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

// calendar
export const CanonicalCalendarEvent = z.object({
  id: z.string(),
  calendarId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  startUtc: z.string().datetime(),
  endUtc: z.string().datetime(),
  isAllDay: z.boolean().default(false),
  isRecurring: z.boolean().default(false),
  recurrenceRule: z.string().optional(), // iCal RRULE
  attendees: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional(),
    status: z.enum(["needs_action", "accepted", "declined", "tentative"]).default("needs_action"),
  })).default([]),
  reminders: z.array(z.object({
    minutesBefore: z.number().int().min(0),
    method: z.enum(["email", "popup", "sms"]).default("popup"),
  })).default([]),
  provider: z.string(),
});
```

### 5.2 The normalisation contract

Every adapter's `normalize(kind, raw)` method is:

- **Pure** — no I/O, no `Date.now()`, no `Math.random()`. The same `raw` always produces the same canonical value.
- **Total** — every required field in the canonical schema is populated or the function throws.
- **Lossless** — provider-specific data (e.g. Google's `place_id`, Mapbox's `context[]`) is preserved in a `providerMetadata` extension field if the canonical schema allows it (opt-in per field).
- **Unit-normalised** — °C, metres, seconds, ISO-8601 UTC. The adapter converts.
- **Timezone-normalised** — all timestamps are UTC. Local timezone is a separate `timezone` field if the schema includes one (e.g. `CanonicalCalendarEvent` carries `startUtc` and the calendar's `timezone` separately).

### 5.3 Versioning

Canonical schemas are versioned. The `schemaVersion` field on every canonical value records which version produced it:

```typescript
export const CanonicalWeather = z.object({
  schemaVersion: z.literal("1.2.0"),
  // …
});
```

When the schema changes in a backward-incompatible way, the version is bumped. Cached values written under `1.1.0` are migrated lazily on read (the `cacheGet` helper runs a `migrate()` function before returning). After 30 days of no `1.1.0` reads, the cache namespace is rotated (`geocode:v1` → `geocode:v2`) and old entries are evicted.

### 5.4 The provider-agnostic guarantee

Business code MUST NOT branch on the `provider` field. The only legitimate use of `provider` is:

- Ops dashboards (showing which provider answered).
- Audit logs (recording which provider produced a given canonical value).
- Debug traces (correlating a canonical value back to the raw response in the adapter's log).

The codebase enforces this via an ESLint rule (`@eks/connector-sdk/no-provider-branching`) that flags any code path reading `provider` outside the `@eks/connectors` package and the `@eks/observability` audit module.

---

## 6. Failover Semantics

### 6.1 The failover contract

When the primary provider fails *and* the strategy allows fallback, the engine:

1. Marks the failed provider `DEGRADED` (via `ProviderHealth`).
2. Removes it from the candidate list for this call.
3. Re-scores the survivors and invokes the next-best provider.
4. If the second provider also fails, tries the third, up to `maxFallbacks` (default 3).
5. On the last fallback's failure, returns `PROVIDER_INVOCATION_FAILED` with a structured error listing the providers tried.

Crucially, **fallback happens at the engine level, not the adapter level**. The adapter does not know it is a fallback. It does not retry the previous provider. The engine orchestrates all of this.

### 6.2 Fallback and idempotency

For non-idempotent calls (e.g. `calendar.createEvent`), fallback is disabled by default — a partial-success-then-failure would create duplicate events on the provider. The category's `idempotencyKey` strategy governs this:

- **Idempotent calls** (`maps.geocode`, `weather.current`, `maps.route`) — fallback enabled.
- **Idempotent-with-key calls** (`calendar.createEvent` with a client-supplied `idempotencyKey`, `procurement.createPurchaseOrder` with a PO number) — fallback enabled, the key deduplicates on the provider side.
- **Non-idempotent calls** (`calendar.deleteEvent`, `merchant.cancelContract`) — fallback disabled. The engine returns the failure to the business surface, which must handle retry logic itself.

### 6.3 Cross-region failover

For `region-exact` strategies (government), cross-region failover is **disabled by design** — a Ghana-region request never fails over to a Nigerian provider, because the data wouldn't be relevant. If all Ghana-government providers are unhealthy, the call returns `NO_PROVIDER_AVAILABLE_FOR_REGION` and the business surface must surface a graceful degradation (e.g. "regulatory check temporarily unavailable — proceeding with manual review").

For `weighted-health` strategies (maps, weather), cross-region failover is enabled. If all Ghana-region providers are down, the engine tries `GLOBAL` providers (Google Maps has global endpoints) and accepts the slightly higher latency.

---

## 7. Cost-Aware Routing

### 7.1 The cost model

Every `ProviderCapability` row carries `costPer1kUsdCents` — the tenant's negotiated rate per 1,000 calls for that capability. The selection engine uses this in two ways:

1. **Filtering** — providers above the tenant's cost ceiling (`ProviderConfiguration.config.maxCostPer1kUsdCents`) are dropped.
2. **Scoring** — under `cost-aware` strategy, the `costPenalty` term biases toward cheaper providers.

The cost model is **per-tenant** because the same provider (e.g. Google Maps) charges different rates depending on the tenant's contract. The catalog `ExternalProvider.costPer1kUsdCents` is a list-price default; the per-tenant override on `ProviderCapability.costPer1kUsdCents` takes precedence.

### 7.2 The monthly budget guard

Each `ProviderConfiguration` may carry `config.budget.monthlyUsdCents`. The engine tracks cumulative spend per `configId` per month (via the M5 `ProviderUsage` rollup, derived from `ConnectorExecution` + `ProviderCapability.costPer1kUsdCents`). When cumulative spend crosses 80% of the budget, the engine emits a `ProviderBudgetWarning` event. At 100%, the engine **pauses the provider** (`ProviderConfiguration.status = PAUSED`) and emits a `ProviderBudgetExceeded` event.

The pause is automatic and recoverable: the operator either raises the budget (`PATCH /api/v1/providers/:configId` with `{ "budget": { "monthlyUsdCents": 200000 } }`) or waits for the month to roll over.

### 7.3 The free-tier optimisation

For tenants on the free tier, the engine prefers `ExternalProvider.costPer1kUsdCents = 0` providers (OSM for maps, Nominatim for geocoding, government open data for weather) and falls back to paid providers only when free ones are unavailable or quality-insufficient. This is implemented as a strategy override: when `Organization.tier = "free"`, the engine forces `cost-aware` for all categories and sets `maxCostPer1kUsdCents = 0` unless an explicit override exists.

---

## 8. Capability Matching

### 8.1 The capability taxonomy

Each category declares its capability set in `src/packages/connectors/<category>/capabilities.ts`. The taxonomy is closed (the engine rejects unknown capabilities at install time). Examples:

```typescript
// maps
export const MAPS_CAPABILITIES = [
  "geocode", "reverse-geocode", "place-search", "autocomplete",
  "route", "route-matrix", "eta", "optimize-route", "snap-to-road",
  "elevation", "timezone",
] as const;

// weather
export const WEATHER_CAPABILITIES = [
  "current", "forecast-hourly", "forecast-daily", "alerts",
  "historical", "air-quality", "uv-index",
] as const;

// calendar
export const CALENDAR_CAPABILITIES = [
  "list-calendars", "list-events", "get-event", "create-event",
  "update-event", "delete-event", "free-busy", "availability",
  "push-notifications",
] as const;
```

### 8.2 Capability discovery

Capabilities are populated two ways:

1. **Catalog defaults** — at platform-seed time, `ProviderCapability` rows are created with `configId = null` for every capability the provider supports out of the box (e.g. Google Maps supports all 11 maps capabilities; OSM supports 6 of them).
2. **Tenant overrides** — at install time, the tenant may override a capability (`PATCH /api/v1/providers/:configId/capabilities`). For example, a tenant whose Google Maps plan excludes Distance Matrix sets `capability = "route-matrix", supported = false` for their config.

The engine consults tenant overrides first; if none exist, the catalog default applies.

### 8.3 Capability-based filtering

A business call specifies which capability it needs. The engine filters candidates by `ProviderCapability.supported` for that capability. If no candidate supports it, the call returns `CAPABILITY_NOT_SUPPORTED` and the business surface is expected to degrade gracefully (e.g. the matching engine falls back to straight-line distance if `route-matrix` is unavailable).

### 8.4 Quality scoring

Within a capability, `qualityScore` (0..100) differentiates providers. The scores are seeded from the catalog (Google Maps geocode: 98, OSM geocode: 75) and can be overridden per-tenant (`ProviderCapability.qualityScore`). The engine uses quality scores in `quality-first` strategy and as a multiplier in `weighted-health`.

Quality scores are recomputed quarterly from a held-out test set: 1,000 known geocoding queries, 500 known routes, etc. The engine runs each provider against the test set and updates `qualityScore` from the pass rate. The recomputation is logged as a `ProviderQualityRescored` event and the old score is archived for trend analysis.

---

## 9. The Routing Decision Log

Every selection decision is logged for observability and audit. The log is written to the M1 `@eks/observability` audit module and includes:

```json
{
  "timestamp": "2025-01-15T10:23:45Z",
  "organizationId": "org_abc",
  "category": "maps",
  "kind": "geocode",
  "input": { "q": "accra", "countryCode": "GH" },
  "cacheHit": false,
  "candidates": [
    { "providerCode": "google-maps", "score": 78.4, "excluded": false, "selected": true },
    { "providerCode": "here",        "score": 64.2, "excluded": false, "selected": false },
    { "providerCode": "mapbox",      "score": 51.7, "excluded": false, "selected": false },
    { "providerCode": "osm",         "score": 22.1, "excluded": true, "excludedReason": "region_quality_below_threshold" }
  ],
  "selectedProvider": "google-maps",
  "fallbacksTried": [],
  "outcome": "success",
  "durationMs": 142,
  "cacheWrite": { "namespace": "geocode:v1", "ttlSec": 604800 }
}
```

This log is queryable via `/api/v1/providers/decisions?organizationId=…&category=…&from=…&to=…` and is the primary debugging surface for "why did this call go to provider X?" questions.

---

## 10. Tenant Preferences

### 10.1 The `weight` field

`ProviderConfiguration.weight` (0..100) is the tenant's primary preference lever. It is **not** a probability — it is a multiplier in the scoring function. Setting `weight = 0` excludes the provider entirely (equivalent to pausing). Setting `weight = 100` maximises its score (but does not guarantee selection — quality, health, and cost still apply).

### 10.2 The `pin` shortcut

A common operator pattern is "pin to provider X unless it fails". This is achieved by setting `weight = 100` for the preferred provider and `weight = 10` for the fallbacks. The `weighted-health` strategy then picks the preferred provider ~90% of the time (depending on quality and health multipliers).

For categories that use `tenant-pinned` strategy (calendar, identity), the pinning is stricter: the pinned provider is always selected (if healthy); other providers are fallbacks only.

### 10.3 Per-capability pinning

Operators can pin per-capability by setting a per-capability override on `ProviderCapability.qualityScore`. For example, a tenant might pin Google for geocoding (`qualityScore = 100`) and HERE for routing (`qualityScore = 100`, Google's `route` quality downgraded to 70). The engine applies these per-capability scores during selection.

### 10.4 Region-based pinning

For tenants operating in multiple regions, per-region weights can be set via `ProviderConfiguration.config.regionWeights`:

```json
{
  "regionWeights": {
    "GH": { "google-maps": 100, "here": 80, "osm": 20 },
    "NG": { "google-maps": 80, "here": 100, "osm": 30 }
  }
}
```

The engine multiplies `weight` by the region-specific value at selection time.

---

## 11. The Service Surface

Business code interacts with the selection engine only through the typed service surfaces exported by each sub-package:

```typescript
import { maps } from "@eks/connectors/maps";
import { weather } from "@eks/connectors/weather";
import { calendar } from "@eks/connectors/calendar";

// In the matching engine:
const origin = await maps.geocode({ q: cook.address, countryCode: "GH" });
const dest = await maps.geocode({ q: customer.address, countryCode: "GH" });
const route = await maps.route({ origin: origin[0], destination: dest[0], departAt: new Date() });
const forecast = await weather.forecastHourly({ lat: origin[0].lat, lon: origin[0].lon, hours: 24 });
```

Each service surface method:

1. Validates the input against the canonical input Zod schema.
2. Calls `selection.invoke(category, kind, input)` — passing the tenant and request context via the M2 `TenantContext` ALS.
3. Returns the canonical output, typed.

Business code never sees the `ProviderConfiguration` row, the adapter, the provider code, or the fallback chain. It sees only the canonical input and output types.

---

## 12. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Branching on `provider` field | Failover breaks; can't switch providers without code changes | Use only the canonical schema; if provider-specific behaviour is needed, expose it as a `ProviderCapability` row |
| Setting `weight = 100` expecting guaranteed selection | Other providers still win when quality/health dominate | Use `tenant-pinned` strategy or set fallbacks to `weight = 0` |
| Forgetting to refresh `ProviderCapability.qualityScore` | Quality drifts; selection becomes stale | Quarterly rescore job; alert if `qualityScore` is older than 90 days |
| Calling the adapter directly (bypassing the engine) | No retry, no breaker, no cache, no fallback, no audit | Always use the typed service surface |
| Caching provider-specific raw responses | Cache hits return wrong schema for a different provider | Cache only the canonical value, keyed by canonical input hash |
| Forcing fallback on non-idempotent calls | Duplicate events / orders on the provider | Disable fallback in the strategy for non-idempotent calls; let the business surface handle retry |
| Relaxing region filter for `government` | Ghana request goes to a Nigerian provider; data is irrelevant | Don't relax — `region-exact` strategy is intentionally strict |
| Treating `costPer1kUsdCents = null` as free | Catalog default is missing; engine should treat as "unknown cost" | Filter on `costPer1kUsdCents = 0` explicitly for free-tier routing |

---

## 13. Further Reading

- `PROVIDER_DEVELOPMENT.md` — building a new adapter (the `invoke` + `normalize` + `healthCheck` contract).
- `CONNECTOR_OPERATIONS.md` — operating the resulting system (health monitoring, cache inspector, DLQ replay).
- `MAPS_INTEGRATION.md` — the maps category as a worked example (4 providers, failover, route optimisation).
- `DISASTER_RECOVERY.md` — provider-outage runbook (when the engine exhausts all fallbacks).
- `docs/integration/ARCHITECTURE.md` — the M4 universal-connector architecture underlying the engine.
- `docs/integration/AUTHENTICATION_GUIDE.md` — the credential layer that gates provider eligibility.
