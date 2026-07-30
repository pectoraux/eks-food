# Eks-Food Connector Ecosystem — Maps Integration Guide

> **Audience:** Platform engineers building geospatial features, ops engineers monitoring map providers, integration partners adding a new maps provider. Read alongside `PROVIDER_DEVELOPMENT.md` (adapter authoring), `PROVIDER_SELECTION.md` (the routing engine), and `CONNECTOR_OPERATIONS.md` (operating production connectors).
>
> **Status:** Milestone 5. This document covers the **maps** category of the `@eks/connectors` package (`src/packages/connectors/maps/`), its four production adapters (Google Maps, HERE, Mapbox, OpenStreetMap), the canonical schemas, the caching strategy, and the failover behaviour that lets Eks-Food route map calls without business code knowing which provider answered.

---

## 1. Why Maps Matter to Eks-Food

Geospatial data underpins almost every Eks-Food surface:

- **Booking matching** — the matching engine (`src/lib/matching.ts`) computes cook-to-customer distance and travel time to score bookings.
- **Cook dispatch** — the scheduler plans multi-stop routes for cooks handling several bookings in a day.
- **Catalogue discoverability** — customers search for cooks "near me"; the catalogue filters by radius.
- **Procurement logistics** — supplier-to-kitchen delivery routes and ETAs feed the inventory planner.
- **Government compliance** — regulatory bodies sometimes require establishment coordinates; reverse-geocoding converts GPS pings to addresses for licensing.
- **Weather correlation** — severe-weather alerts are geofenced; the maps service provides the polygon-in-region test.
- **Restaurant + merchant** — catering delivery routes, corporate-meal drop-off windows.

Every one of these calls goes through `maps.<method>()` from `@eks/connectors/maps`. The selection engine picks one of four providers per call. Business code sees only the canonical result.

---

## 2. The Four Providers

Eks-Food ships adapters for four maps providers. Each has a distinct commercial and capability profile.

| Provider | Code | Strengths | Weaknesses | Cost (per 1k geocodes, USD) | Free tier |
|---|---|---|---|---|---|
| Google Maps | `google-maps` | Best geocoding quality; deepest POI database; traffic-aware routing; global coverage | Most expensive; tight per-second quota; ToS restricts caching to 30 days | $5.00 (after $200 monthly credit) | $200/mo credit |
| HERE | `here` | Excellent routing in emerging markets; offline-capable SDK; generous quotas | Geocoding quality below Google in West Africa | $1.00 | 250k/year |
| Mapbox | `mapbox` | Custom map rendering; flexible styling; good for customer-facing maps | Geocoding relies on open data; weaker in Africa | $0.75 | 50k/mo free |
| OpenStreetMap | `osm` | Free; community-maintained; no quota | Quality varies by region; no SLA; no traffic | $0 (Nominatim) | unlimited (with throttle) |

The default install for a Ghana-region tenant pins **Google Maps** (weight 100) with **HERE** (weight 60) and **Mapbox** (weight 30) as fallbacks and **OSM** (weight 10) as the cost-aware free-tier option. Operators can adjust weights per region via `ProviderConfiguration.config.regionWeights`.

---

## 3. The Canonical Schema

All four adapters normalise their responses to `CanonicalGeo` types declared in `src/packages/connectors/maps/types.ts`.

### 3.1 `CanonicalGeocode`

```typescript
export const CanonicalGeocode = z.array(z.object({
  lat: z.number(),
  lon: z.number(),
  label: z.string(),                       // full human-readable label
  addressLine: z.string().optional(),      // street + number
  city: z.string().optional(),
  region: z.string().optional(),           // state/province
  postcode: z.string().optional(),
  country: z.string().optional(),
  countryCode: z.string().length(2).optional(),
  confidence: z.number().min(0).max(1),    // 0..1; provider-reported or derived
  provider: z.string(),                    // for ops only
  providerMetadata: z.record(z.unknown()).optional(), // raw provider-specific fields
}));
```

### 3.2 `CanonicalRoute`

```typescript
export const CanonicalRoute = z.object({
  distanceM: z.number(),
  durationSec: z.number(),                 // traffic-aware when provider supports
  geometry: z.string(),                    // encoded polyline (Google-style)
  steps: z.array(z.object({
    instruction: z.string(),
    distanceM: z.number(),
    durationSec: z.number(),
    maneuver: z.enum(["straight", "slight-left", "left", "sharp-left",
                       "slight-right", "right", "sharp-right",
                       "uturn", "roundabout", "arrive", "depart"]).default("straight"),
    maneuverLocation: z.object({ lat: z.number(), lon: z.number() }),
  })),
  tolls: z.array(z.object({
    name: z.string().optional(),
    estimatedCostUsdCents: z.number().optional(),
    currency: z.string().default("USD"),
  })).default([]),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
});
```

### 3.3 `CanonicalRouteMatrix`

```typescript
export const CanonicalRouteMatrix = z.object({
  rows: z.array(z.object({
    fromIndex: z.number().int(),
    toIndex: z.number().int(),
    distanceM: z.number(),
    durationSec: z.number(),
    status: z.enum(["ok", "no-route", "unknown"]).default("ok"),
  })),
  provider: z.string(),
});
```

### 3.4 `CanonicalPlace` (autocomplete / place-search)

```typescript
export const CanonicalPlace = z.object({
  placeId: z.string(),                     // provider-specific; do NOT persist across calls
  lat: z.number(),
  lon: z.number(),
  label: z.string(),
  categories: z.array(z.string()).default([]),
  provider: z.string(),
});
```

---

## 4. The Service Surface

Business code calls these methods only. They live in `src/packages/connectors/maps/index.ts`:

```typescript
export const maps = {
  // Address → coordinates
  geocode(input: { q: string; countryCode?: string; limit?: number }): Promise<CanonicalGeocode>,
  reverseGeocode(input: { lat: number; lon: number; language?: string }): Promise<CanonicalGeocode>,

  // Routing
  route(input: {
    origin: { lat: number; lon: number };
    destination: { lat: number; lon: number };
    waypoints?: Array<{ lat: number; lon: number }>;
    departAt?: Date;
    arriveBy?: Date;
    travelMode?: "driving" | "walking" | "cycling";
    avoidTolls?: boolean;
    trafficAware?: boolean;
  }): Promise<CanonicalRoute>,

  routeMatrix(input: {
    origins: Array<{ lat: number; lon: number }>;
    destinations: Array<{ lat: number; lon: number }>;
    departAt?: Date;
    travelMode?: "driving" | "walking" | "cycling";
  }): Promise<CanonicalRouteMatrix>,

  // ETA (lightweight — single origin/destination, no geometry)
  eta(input: {
    origin: { lat: number; lon: number };
    destination: { lat: number; lon: number };
    departAt?: Date;
    travelMode?: "driving" | "walking" | "cycling";
  }): Promise<{ durationSec: number; distanceM: number; provider: string }>,

  // Place search + autocomplete
  autocomplete(input: { q: string; lat?: number; lon?: number; radiusM?: number; language?: string }): Promise<CanonicalPlace[]>,
  placeSearch(input: { q: string; lat?: number; lon?: number; radiusM?: number }): Promise<CanonicalPlace[]>,

  // Route optimisation (travelling salesman with constraints)
  optimizeRoute(input: {
    origin: { lat: number; lon: number };
    destinations: Array<{ lat: number; lon: number; id: string; serviceSec?: number }>;
    departAt?: Date;
    travelMode?: "driving" | "walking" | "cycling";
    maxStops?: number;
    returnToOrigin?: boolean;
  }): Promise<{ order: string[]; route: CanonicalRoute }>,

  // Misc
  snapToRoad(input: { path: Array<{ lat: number; lon: number }>): Promise<Array<{ lat: number; lon: number }>>,
  elevation(input: { lat: number; lon: number }): Promise<{ meters: number; provider: string }>,
  timezone(input: { lat: number; lon: number }): Promise<{ id: string; offsetSec: number; provider: string }>,
};
```

Each method delegates to `selection.invoke("maps", "<capability>", input)` (see `PROVIDER_SELECTION.md`).

---

## 5. Caching Strategy

Maps calls are highly cacheable — addresses don't move, routes between fixed points rarely change, and customer search queries cluster heavily. The cache is the single biggest cost lever.

### 5.1 TTLs per capability

| Capability | Namespace | TTL | Notes |
|---|---|---|---|
| `geocode` | `geocode:v1` | 7 days | Addresses change rarely; a street rename invalidates via flush |
| `reverse-geocode` | `reverse:v1` | 7 days | Same |
| `autocomplete` | `autocomplete:v1` | 24 h | Less cacheable (typed prefixes); shorter TTL |
| `place-search` | `places:v1` | 24 h | POIs change more often than addresses |
| `route` | `route:v1` | 1 h (traffic off) / 5 min (traffic on) | Traffic-aware routes decay fast |
| `route-matrix` | `matrix:v1` | 1 h | Matrices are large; cache aggressively |
| `eta` | `eta:v1` | 5 min | Traffic-aware |
| `optimize-route` | not cached | 0 | Custom per-request; provider-side optimisation is the bottleneck |
| `snap-to-road` | `snap:v1` | 7 days | Roads change rarely |
| `elevation` | `elevation:v1` | 30 days | Elevation is constant |
| `timezone` | `timezone:v1` | 365 days | Timezone boundaries change rarely |

### 5.2 Cache key derivation

The cache key is `sha256(JSON.stringify({ kind, input }))` — the canonical input, sorted by key, with `countryCode` and `language` included. Identical inputs across providers share the same cache entry (canonical schema, see `PROVIDER_SELECTION.md` §3).

### 5.3 Negative caching

404 responses on `geocode` (unknown address) are cached for 60 s under `negative:v1`. This prevents retry storms when a customer mistypes an address repeatedly.

### 5.4 Cache size budget

Each `ProviderConfiguration` has a default cache budget of 50 MB (`ProviderConfiguration.config.cache.maxBytes`). The runtime auto-evicts the lowest-hit entries when the budget is exceeded. Operators can raise the budget for high-volume tenants:

```bash
curl -X PATCH /api/v1/providers/cfg_abc \
  -d '{ "config": { "cache": { "maxBytes": 209715200 } } }'
```

---

## 6. Provider Failover and Health Scoring

### 6.1 The failover chain

For the default Ghana-region tenant with Google + HERE + Mapbox + OSM installed, the failover chain on a `geocode` call is:

1. **Google Maps** — primary. Highest quality score (98). Hits cache 90%+ of the time.
2. **HERE** — first fallback (if Google is unhealthy or 429s). Quality 88 in GH.
3. **Mapbox** — second fallback. Quality 78 in GH.
4. **OSM** — last resort. Quality 65 in GH. Free.

Each fallback is tried only if the previous one failed *and* the call is idempotent (geocode, route, eta, matrix — all are). Non-idempotent maps calls (none in the current surface) would disable fallback.

### 6.2 Health scoring

`ProviderHealth.qualityScore` for maps is computed from:

- `availability5m` (50% weight) — provider up-time in the last 5 min.
- `p99LatencyMs` (30% weight) — penalised if above the 800 ms SLO.
- `geocodePassRate` (20% weight) — quarterly rescore against the 1,000-query held-out test set.

The composite score is recomputed every 60 s and drives both the `weighted-health` strategy and the `DEGRADED`/`UNHEALTHY` transitions.

### 6.3 Region-aware fallback

If the request region is `GH` and Google Maps Ghana endpoint is unhealthy, the engine falls back to **HERE** (which has a Ghana-specific endpoint) before **Mapbox** (which uses global endpoints). The `ProviderRegion.qualityScore` per region governs the order.

If a regional provider is unhealthy *and* no regional fallback exists, the engine relaxes to `GLOBAL` providers (Google Maps global endpoint) with a `ProviderSelectionRegionRelaxed` event — accepted trade-off: slightly higher latency, but the call succeeds.

### 6.4 Quota-aware routing

Google Maps has a tight per-second quota. The selection engine tracks `ProviderHealth.callsLastMin` and proactively deweights Google when it approaches the per-second limit (within 80% of `ExternalProvider.rateLimitPerSec`). This pushes excess traffic to HERE / Mapbox before Google starts 429ing, which would otherwise cascade through retries.

---

## 7. Per-Provider Implementation Notes

### 7.1 Google Maps adapter (`google-maps.ts`)

**Endpoints:**
- Geocoding: `https://maps.googleapis.com/maps/api/geocode/json`
- Reverse: same endpoint with `latlng` parameter
- Directions: `https://maps.googleapis.com/maps/api/directions/json`
- Distance Matrix: `https://maps.googleapis.com/maps/api/distancematrix/json`
- Places Autocomplete: `https://maps.googleapis.com/maps/api/place/autocomplete/json`
- Places Details: `https://maps.googleapis.com/maps/api/place/details/json`
- Roads Snap-to-Road: `https://roads.googleapis.com/v1/snapToRoads`
- Timezone: `https://maps.googleapis.com/maps/api/timezone/json`
- Elevation: `https://maps.googleapis.com/maps/api/elevation/json`

**Auth:** API key (`?key=...`). The adapter supports restricting the key to specific referrers/IPs at the Google Cloud Console; the install flow surfaces this in the docs.

**Quirks:**
- The Directions API returns `legs[].steps[].polyline.points` as an encoded polyline (Google's algorithm). The adapter decodes it to populate `geometry` in the canonical schema.
- `status = "ZERO_RESULTS"` is a 200 response, not an error. The adapter returns an empty `CanonicalGeocode` array.
- `OVER_QUERY_LIMIT` is a 200 response with `status`. The adapter translates this to `{ ok: false, retryable: true, error: "rate_limited" }`.
- Distance Matrix caps at 25 origins × 25 destinations per request. Larger matrices are batched; the adapter handles the batching internally.

### 7.2 HERE adapter (`here.ts`)

**Endpoints:**
- Geocoding: `https://geocode.search.hereapi.com/v1/geocode`
- Reverse: `https://revgeocode.search.hereapi.com/v1/revgeocode`
- Routing: `https://router.hereapi.com/v8/routes`
- Matrix: `https://matrix.router.hereapi.com/v8/matrix`
- Places Autosuggest: `https://autosuggest.search.hereapi.com/v1/autosuggest`

**Auth:** OAuth2 client-credentials. The adapter caches the access token in `ConnectorCache` under `oauth:tokens` with TTL = `expires_in - 60s`.

**Quirks:**
- HERE returns `items[]` rather than `results[]`. The adapter normalises.
- Routing v8 returns `routes[].sections[]` — each section is a leg between two waypoints. The adapter flattens sections into the canonical `steps[]`.
- The matrix endpoint accepts up to 15 origins × 100 destinations per request. Larger matrices are batched.

### 7.3 Mapbox adapter (`mapbox.ts`)

**Endpoints:**
- Geocoding: `https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json`
- Reverse: same with `{lon},{lat}.json`
- Directions: `https://api.mapbox.com/directions/v5/mapbox/{profile}/{coordinates}`
- Matrix: `https://api.mapbox.com/directions-matrix/v1/mapbox/{profile}/{coordinates}`
- Geocoding autocomplete: not supported in v5 (uses forward geocoding with `autocomplete=true`)

**Auth:** Access token (`?access_token=...`). Public tokens are scoped to URL patterns; secret tokens are used server-side.

**Quirks:**
- Mapbox's `relevance` field is 0..1; the adapter maps it to `confidence`.
- Mapbox does not include `postcode` in the top-level response; the adapter extracts it from `context[]`.
- Mapbox's Directions v5 returns `routes[].legs[].steps[].maneuver.type` — the adapter maps HERE/Google maneuver types to the canonical enum.

### 7.4 OpenStreetMap adapter (`osm.ts`)

**Endpoints:**
- Geocoding: `https://nominatim.openstreetmap.org/search`
- Reverse: `https://nominatim.openstreetmap.org/reverse`
- Routing: `https://router.project-osrm.org/route/v1/{profile}/{coordinates}` (OSRM demo server)
- Matrix: same OSRM server with `?sources=...&destinations=...`

**Auth:** None. The adapter sends a `User-Agent` header per the Nominatim usage policy.

**Quirks:**
- Nominatim's usage policy requires ≤ 1 request/sec and a valid HTTP Referer or User-Agent. The adapter enforces this with a per-config `RateLimiter` set to 1 req/sec.
- OSRM demo server has no SLA and is rate-limited. The adapter treats OSRM as best-effort: failures are not retried as aggressively (maxAttempts = 1) and fallback to other providers is fast.
- OSM has no Places Autocomplete API. The `autocomplete` capability is marked `supported = false` for OSM in the catalog.
- OSM has no traffic-aware routing. The `trafficAware` input parameter is ignored; the route duration is free-flow only.

---

## 8. Route Optimisation

The `optimizeRoute` capability is implemented per-provider:

| Provider | Implementation |
|---|---|
| Google Maps | Not directly supported. The adapter falls back to calling `route` with all permutations for ≤ 8 stops; for > 8 stops, it uses a nearest-neighbour heuristic and then a single `route` call. |
| HERE | Tour Planning API (`https://tourplanning.hereapi.com/v3/problems`) — supports up to 70 stops with vehicle constraints. |
| Mapbox | Optimization API (`https://api.mapbox.com/optimized-trips/v1/mapbox/{profile}/{coordinates}`) — up to 12 stops. |
| OSM | Not supported. The adapter marks `supported = false`. |

The selection engine picks the provider based on stop count:

- ≤ 8 stops → Mapbox (cheap, fast)
- 9-12 stops → Mapbox (still within limit) or HERE
- 13-70 stops → HERE
- > 70 stops → returns `CAPABILITY_NOT_SUPPORTED`; business code must split the route

The engine returns both the optimised order (`string[]` of destination IDs) and a `CanonicalRoute` for the full optimised path. The business surface (typically the cook-dispatch scheduler) uses the order to sequence stops and the route to render the polyline on the cook's mobile map.

---

## 9. Worked Example — Booking Matching

The matching engine (`src/lib/matching.ts`) calls maps during a booking request. The flow:

```typescript
import { maps } from "@eks/connectors/maps";

async function scoreBooking(cook: Cook, customer: Customer): Promise<BookingScore> {
  // 1. Geocode the cook and customer addresses
  const [cookGeo] = await maps.geocode({ q: cook.address, countryCode: cook.countryCode });
  const [customerGeo] = await maps.geocode({ q: customer.address, countryCode: customer.countryCode });

  // 2. Compute the route (traffic-aware, current departure)
  const route = await maps.route({
    origin: { lat: cookGeo.lat, lon: cookGeo.lon },
    destination: { lat: customerGeo.lat, lon: customerGeo.lon },
    departAt: new Date(),
    travelMode: "driving",
    trafficAware: true,
  });

  // 3. Score the booking (distance + travel time + cook rating + ...)
  return {
    distanceKm: route.distanceM / 1000,
    travelTimeMin: route.durationSec / 60,
    // ... other dimensions
  };
}
```

Under the hood:

1. `maps.geocode(cook.address)` — checks the cache for `geocode:v1:sha256(...)`. On hit, returns immediately. On miss, the selection engine picks Google Maps (highest weight + quality), invokes the adapter, normalises the response, writes the cache (TTL 7 days), and returns.
2. `maps.geocode(customer.address)` — same flow, likely a cache hit if the customer has booked before.
3. `maps.route(...)` — checks the cache for `route:v1:sha256(...)` (TTL 5 min for traffic-aware). On miss, the engine picks Google Maps, calls Directions API, decodes the polyline, normalises, caches, returns.

If Google Maps is unhealthy for the route call, the engine falls back to HERE (also traffic-aware). If HERE is also unhealthy, to Mapbox (no traffic data; `trafficAware` ignored). If all three fail, the matching engine surfaces a `MAPS_UNAVAILABLE` error to the customer and the booking request is rejected with a retry-after hint.

The total cost per booking match: typically 0 provider calls (cache hits) for repeat customers; up to 3 calls (geocode × 2 + route) for new customers. At Google's $5/1k geocodes and $5/1k directions, that's ~$0.015 per new-customer booking — manageable.

---

## 10. Per-Region Configuration

Eks-Food operates in multiple countries. The maps configuration is region-aware:

```json
{
  "regionWeights": {
    "GH": { "google-maps": 100, "here": 80, "mapbox": 30, "osm": 10 },
    "NG": { "google-maps": 100, "here": 90, "mapbox": 30, "osm": 10 },
    "KE": { "google-maps": 100, "here": 70, "mapbox": 40, "osm": 15 },
    "ZA": { "google-maps": 100, "here": 60, "mapbox": 50, "osm": 20 }
  }
}
```

The weights reflect each provider's observed quality in each region. HERE's stronger weight in NG reflects its better routing data there; Mapbox's stronger weight in ZA reflects its improved African coverage.

Per-region weights are tuned quarterly based on the `ProviderRegion.qualityScore` rescore (see `PROVIDER_SELECTION.md` §8.4).

---

## 11. ToS Compliance

Each provider's terms of service constrain how Eks-Food may use their data. The adapter layer enforces these constraints:

- **Google Maps** — cached results may be stored for up to 30 consecutive days. The maps cache TTL for `geocode` is set to 7 days (well within the limit). The `route` TTL is 5 min (traffic-aware). The adapter never persists Google Maps content beyond the cache.
- **HERE** — cached results may be stored indefinitely for use within the Eks-Food application. No external redistribution.
- **Mapbox** — similar to HERE; caching is permitted for internal use.
- **OSM** — Open Database License (ODbL). Derived data must be shared back under ODbL. The adapter never persists OSM data outside the cache; the cache is internal-only and not redistributed.

The compliance posture is documented in `docs/SECURITY.md` and audited annually.

---

## 12. Operations — Maps-Specific Alerts

Beyond the generic provider alerts (see `CONNECTOR_OPERATIONS.md` §11), the maps category surfaces these specific alerts:

| Alert | Expression | Action |
|---|---|---|
| MapsCacheHitRateLow | `cache_hit_rate{namespace="geocode:v1"} < 0.85` | Investigate cache eviction; consider raising cache budget |
| MapsGeocodeQualityDrop | `quality_score{provider="google-maps", capability="geocode"} < 90` | Run quarterly rescore early; investigate provider-side regression |
| MapsQuotaBurningFast | `calls_last_day{provider="google-maps"} / rate_limit_per_day > 0.8 by 12:00 UTC` | Re-weight to HERE / Mapbox; check for runaway caller |
| MapsRouteDurationSkew | `p99_latency_ms{capability="route"} > 2000` | Investigate; likely traffic-aware routing hitting a slow provider endpoint |
| MapsOptimizeUnsupported | `invocations{capability="optimize-route", status="CAPABILITY_NOT_SUPPORTED"} > 0` | Business code is requesting > 70 stops; needs to split |

---

## 13. Testing

The maps adapters have a comprehensive test harness in `src/packages/connectors/maps/adapters/__tests__/`:

- **Fixture replay** — recorded provider responses in `__fixtures__/<provider>/<capability>.json` are replayed through `normalize()` and asserted against the canonical schema.
- **VCR-style integration tests** — live provider calls are recorded once and replayed; re-recording requires a `RECORD=1` env var and valid credentials.
- **Quality benchmark** — the 1,000-query geocoding test set is run against each provider quarterly; results feed the `qualityScore` rescore.
- **Cache integration** — `cacheGet`/`cacheSet` are exercised against a real SQLite `ConnectorCache` table in the test database.

A representative test:

```typescript
describe("google-maps geocode normalize", () => {
  it("maps a full Google response to the canonical schema", () => {
    const raw = require("../__fixtures__/google-maps/geocode-accra.json");
    const out = googleMapsAdapter.normalize("geocode", raw);
    expect(() => CanonicalGeocode.parse(out)).not.toThrow();
    expect(out[0].label).toBe("Accra, Ghana");
    expect(out[0].countryCode).toBe("GH");
    expect(out[0].confidence).toBeGreaterThan(0.8);
    expect(out[0].provider).toBe("google-maps");
  });
});
```

---

## 14. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Calling Google Maps directly from a route handler | Bypasses cache, breaker, fallback; quota burns 5x | Use `maps.<method>()` exclusively |
| Persisting the `placeId` across user sessions | Place IDs are provider-specific and may rotate | Persist the address string; re-geocode on demand (cache makes this cheap) |
| Forgetting `trafficAware: true` on dispatch routes | ETA is free-flow only; misses rush-hour traffic | Default to `trafficAware: true` for any route involving a real driver |
| Mixing `travelMode` defaults across providers | OSM defaults to driving; Google defaults to driving; Mapbox requires explicit profile | Always pass `travelMode` explicitly |
| Treating OSRM demo server as production-grade | Random 5xx; no SLA | Treat OSM/OSRM as best-effort fallback only; never the primary |
| Caching traffic-aware routes for > 5 min | Customer sees stale ETA | Use the per-capability TTL; do not override upward |
| Requesting > 25 origins in a Google Matrix | Google returns 400 | Adapter batches automatically; do not bypass the adapter |
| Reverse-geocoding GPS pings in real time (every second) | Quota burn; cache miss every time | Throttle to one reverse-geocode per minute per device; interpolate between |

---

## 15. Further Reading

- `PROVIDER_DEVELOPMENT.md` — the adapter authoring pattern (`invoke` + `normalize` + `healthCheck`).
- `PROVIDER_SELECTION.md` — the routing engine that picks between the four providers.
- `CONNECTOR_OPERATIONS.md` — operating maps in production (cache inspector, quota management, alerts).
- `DISASTER_RECOVERY.md` — maps-specific DR (provider outage, cache rebuild, region failover).
- `docs/integration/CONNECTOR_DEVELOPMENT.md` — the M4 universal-connector authoring guide (underlying runtime).
