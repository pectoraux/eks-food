# Eks-Food Connector Ecosystem — Weather Integration Guide

> **Audience:** Platform engineers building demand-sensing and operations features, ops engineers monitoring weather providers, integration partners adding a new weather provider. Read alongside `PROVIDER_DEVELOPMENT.md`, `PROVIDER_SELECTION.md`, `CONNECTOR_OPERATIONS.md`, and the per-category guides.
>
> **Status:** Milestone 5. This document covers the **weather** category of the `@eks/connectors` package (`src/packages/connectors/weather/`), its production adapters (OpenWeather, WeatherAPI, AccuWeather, Open-Meteo), the canonical schema, the caching strategy, and the forecast-normalisation layer.

---

## 1. Why Weather Matters to Eks-Food

Weather drives food demand, supply logistics, and cook safety. Eks-Food uses weather data in:

- **Demand sensing** — the intelligence module (`src/components/modules/food-intelligence-module.tsx`) correlates weather with order volume. Hot days → cold drinks; rainy evenings → comfort food; harmattan haze → cough-syrup-friendly menus.
- **Cook dispatch** — severe-weather alerts trigger rescheduling prompts to customers in affected areas; heavy rain multiplies delivery ETA.
- **Procurement planning** — historical rainfall correlates with crop yield, which drives wholesale prices 2-4 weeks out. The procurement planner uses historical weather to anticipate price moves.
- **Catering contracts** — outdoor corporate-meal contracts include weather-contingent clauses; the merchant module surfaces forecast confidence on the contract dashboard.
- **Safety** — cook heat-stress risk on >35°C days triggers proactive hydration reminders via the notifications module.

Each weather call goes through `weather.<method>()` from `@eks/connectors/weather`. The selection engine picks one provider per call. The default strategy is `cost-aware` — weather is commodity-grade, and the cheapest provider with `qualityScore ≥ 70` is preferred.

---

## 2. The Four Providers

Eks-Food ships adapters for four weather providers. Each has a distinct commercial and data-density profile.

| Provider | Code | Strengths | Weaknesses | Cost (per 1k calls, USD) | Free tier |
|---|---|---|---|---|---|
| OpenWeather | `openweather` | Solid global coverage; severe-weather alerts API; good documentation | Station density thin in West Africa | $0 (free tier) → $40 (One Call 3.0) | 60 calls/min, 1M/month free |
| WeatherAPI | `weatherapi` | Cheap; astronomy data (sunrise/sunset); air quality | Forecast quality below AccuWeather | $0 → $25 | 1M/month free |
| AccuWeather | `accuweather` | Best forecast accuracy in most regions; 45-day forecast | Most expensive; per-location licensing model | $0.25 per call (no per-1k discount) | 50 calls/day free |
| Open-Meteo | `open-meteo` | Free; no API key; excellent historical archive (ERA5) | No severe-weather alerts; no SLA | $0 | 10k calls/day free (no key) |

The default install pins **OpenWeather** (weight 80, primary) with **Open-Meteo** (weight 70, free fallback) and **WeatherAPI** (weight 50, secondary fallback). AccuWeather is available as a paid upgrade for tenants needing 45-day forecast or superior accuracy.

---

## 3. The Prisma Model

The `WeatherProvider` model records per-tenant weather configuration — primarily the list of locations the tenant cares about (cook addresses, customer hubs, supplier regions) so the scheduler can prefetch forecasts in batches.

```prisma
model WeatherProvider {
  id              String   @id @default(cuid())
  organizationId  String
  providerConfigId String  // → ProviderConfiguration.id
  // The tenant's monitored locations (JSON array of {label, lat, lon})
  monitoredLocations String @default("[]")
  // Prefetch schedule: cron expression
  prefetchCron    String   @default("0 */3 * * *") // every 3 hours
  // Default forecast horizon (hours)
  defaultForecastHours Int  @default(48)
  // Alert subscriptions (severe weather types to subscribe to)
  alertSubscriptions String @default("[\"storm\",\"flood\",\"heat\",\"haze\"]")
  // Historical data window (days back from now)
  historicalDaysBack Int    @default(30)
  lastPrefetchAt  DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  provider        ProviderConfiguration @relation(fields: [providerConfigId], references: [id])

  @@unique([organizationId, providerConfigId])
}
```

---

## 4. The Canonical Schema

All four adapters normalise to `CanonicalWeather`, `CanonicalForecast`, and `CanonicalWeatherAlert`:

### 4.1 `CanonicalWeather` (current conditions)

```typescript
export const CanonicalWeather = z.object({
  schemaVersion: z.literal("1.3.0"),
  observedAt: z.string().datetime(),
  location: z.object({ lat: z.number(), lon: z.number(), label: z.string().optional() }),
  temperatureC: z.number(),
  feelsLikeC: z.number().optional(),
  humidityPct: z.number().min(0).max(100).optional(),
  dewPointC: z.number().optional(),
  windKph: z.number().min(0).optional(),
  windBearingDeg: z.number().min(0).max(360).optional(),
  windGustKph: z.number().min(0).optional(),
  pressureHpa: z.number().optional(),
  visibilityM: z.number().optional(),
  cloudCoverPct: z.number().min(0).max(100).optional(),
  precipitationMm: z.number().min(0).default(0),
  uvIndex: z.number().min(0).optional(),
  conditions: z.array(z.object({
    code: z.string(),                  // provider-specific (e.g. "openweather:500")
    label: z.string(),                 // human-readable
    severity: z.enum(["none", "minor", "moderate", "severe", "extreme"]).default("none"),
  })),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
});
```

### 4.2 `CanonicalForecast` (hourly or daily)

```typescript
export const CanonicalForecastHourly = z.object({
  schemaVersion: z.literal("1.3.0"),
  location: z.object({ lat: z.number(), lon: z.number(), label: z.string().optional() }),
  generatedAt: z.string().datetime(),
  hours: z.array(z.object({
    validAt: z.string().datetime(),
    temperatureC: z.number(),
    feelsLikeC: z.number().optional(),
    precipitationMm: z.number().min(0).default(0),
    precipitationProbabilityPct: z.number().min(0).max(100).optional(),
    windKph: z.number().min(0).optional(),
    windBearingDeg: z.number().min(0).max(360).optional(),
    humidityPct: z.number().min(0).max(100).optional(),
    uvIndex: z.number().min(0).optional(),
    cloudCoverPct: z.number().min(0).max(100).optional(),
    conditions: z.array(z.object({ code: z.string(), label: z.string() })),
  })),
  provider: z.string(),
});

export const CanonicalForecastDaily = z.object({
  schemaVersion: z.literal("1.3.0"),
  location: z.object({ lat: z.number(), lon: z.number(), label: z.string().optional() }),
  generatedAt: z.string().datetime(),
  days: z.array(z.object({
    validDate: z.string(),               // YYYY-MM-DD
    tempMinC: z.number(),
    tempMaxC: z.number(),
    precipitationMm: z.number().min(0).default(0),
    precipitationProbabilityPct: z.number().min(0).max(100).optional(),
    windKphMax: z.number().min(0).optional(),
    uvIndexMax: z.number().min(0).optional(),
    sunriseUtc: z.string().datetime().optional(),
    sunsetUtc: z.string().datetime().optional(),
    conditions: z.array(z.object({ code: z.string(), label: z.string() })),
  })),
  provider: z.string(),
});
```

### 4.3 `CanonicalWeatherAlert` (severe weather)

```typescript
export const CanonicalWeatherAlert = z.object({
  schemaVersion: z.literal("1.3.0"),
  id: z.string(),                        // provider-specific alert ID
  alertType: z.enum(["storm", "flood", "heat", "cold", "haze", "wind", "dust", "fire", "other"]),
  severity: z.enum(["minor", "moderate", "severe", "extreme"]),
  headline: z.string(),
  description: z.string(),
  instructions: z.string().optional(),
  area: z.string().optional(),           // human-readable affected area
  polygon: z.array(z.array(z.tuple([z.number(), z.number()]))).optional(), // GeoJSON-style
  effectiveAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
});
```

### 4.4 `CanonicalHistoricalWeather`

```typescript
export const CanonicalHistoricalWeather = z.object({
  schemaVersion: z.literal("1.3.0"),
  location: z.object({ lat: z.number(), lon: z.number() }),
  from: z.string().datetime(),
  to: z.string().datetime(),
  hours: z.array(z.object({
    validAt: z.string().datetime(),
    temperatureC: z.number(),
    precipitationMm: z.number().min(0).default(0),
    humidityPct: z.number().min(0).max(100).optional(),
    windKph: z.number().min(0).optional(),
  })),
  provider: z.string(),
});
```

---

## 5. The Service Surface

```typescript
export const weather = {
  current(input: { lat: number; lon: number; label?: string }): Promise<CanonicalWeather>,
  forecastHourly(input: { lat: number; lon: number; hours?: number; label?: string }): Promise<CanonicalForecastHourly>,
  forecastDaily(input: { lat: number; lon: number; days?: number; label?: string }): Promise<CanonicalForecastDaily>,
  alerts(input: { lat: number; lon: number; radiusKm?: number }): Promise<CanonicalWeatherAlert[]>,
  historical(input: { lat: number; lon: number; from: Date; to: Date }): Promise<CanonicalHistoricalWeather>,
  // Convenience: returns true if any alert covers the location
  hasSevereWeather(input: { lat: number; lon: number }): Promise<{ severe: boolean; alerts: CanonicalWeatherAlert[] }>,
};
```

Each method delegates to `selection.invoke("weather", "<capability>", input)`.

---

## 6. Caching Strategy

Weather data is highly cacheable per capability. The cache is the primary cost lever — a free Open-Meteo call cached for 10 minutes is effectively $0.

### 6.1 TTLs per capability

| Capability | Namespace | TTL | Notes |
|---|---|---|---|
| `current` | `wx-current:v1` | 2 min | Conditions change slowly; 2 min is fresh enough for matching |
| `forecast-hourly` | `wx-fx-h:v1` | 10 min | Models update every 6 h; 10 min cache misses a negligible window |
| `forecast-daily` | `wx-fx-d:v1` | 30 min | Same |
| `alerts` | `wx-alerts:v1` | 60 s | Severe weather is time-sensitive; 60 s is the floor |
| `historical` | `wx-hist:v1` | 30 days | Historical data is immutable |

### 6.2 Cache key derivation

The cache key is `sha256(JSON.stringify({ kind, lat: round(lat, 3), lon: round(lon, 3) }))` — coordinates rounded to ~100 m precision. This means cook addresses within 100 m share a cache entry, which is fine-grained enough for accurate weather but coarse enough to maximise cache hits.

The `label` field is *not* part of the cache key — it's a display-only attribute.

### 6.3 Prefetch

For tenants with a `WeatherProvider` row configured, the M4 `Scheduler` runs a prefetch job per `prefetchCron` (default: every 3 h). The prefetch iterates `monitoredLocations`, calls `forecastHourly` for each, and writes the result to the cache. This shifts the cache-miss cost from the matching engine (latency-sensitive) to the scheduler (background).

Prefetch failures are non-fatal — the cache will be populated on-demand by the first matching call. But sustained prefetch failures surface as `wx-prefetch-failed` alerts.

### 6.4 Negative caching

A 404 on `historical` (date range outside the provider's archive) is cached for 1 h to prevent repeated lookups for unsupported ranges.

---

## 7. Provider Failover and Forecast Normalisation

### 7.1 The failover chain

For the default tenant with OpenWeather + Open-Meteo + WeatherAPI installed, the failover chain on a `current` call is:

1. **OpenWeather** — primary (cost-aware: free tier, quality 78 in GH).
2. **Open-Meteo** — fallback (free, quality 75 in GH).
3. **WeatherAPI** — fallback (free tier, quality 72 in GH).

AccuWeather (weight 30) is only picked if the first three fail or if the tenant has explicitly pinned to it (e.g. for 45-day forecast capability, which only AccuWeather supports).

### 7.2 Forecast reconciliation

When the engine falls back from OpenWeather to Open-Meteo mid-forecast, the two providers' predictions won't agree perfectly. The canonical schema preserves the `provider` field on each forecast, so downstream code can detect the switch. But the canonical value is the *latest provider's* forecast — the engine does not merge or average.

This is intentional: averaging forecasts from different models produces worse results than picking one and trusting it. The `provider` field lets downstream code weight its confidence accordingly (e.g. the demand-sensing model down-weights a forecast that switched providers mid-horizon).

### 7.3 Severe-weather alert reconciliation

Severe-weather alerts from different providers don't always agree. The engine deduplicates by `(alertType, polygon-hash, effectiveAt-expiresAt-overlap)`: if OpenWeather and WeatherAPI both report a "storm" alert for roughly the same area at roughly the same time, only one is returned (the higher-severity one).

The deduplication is conservative: alerts with no polygon (text-only area descriptions) are kept as separate entries, since their geographic scope can't be reliably compared.

### 7.4 Forecast confidence

Each provider reports its own confidence metric (OpenWeather: not exposed; WeatherAPI: `chance_of_rain`; AccuWeather: `preciptext`). The adapter normalises to `precipitationProbabilityPct` in the canonical schema. Other confidence metrics are preserved in `providerMetadata`.

The downstream demand-sensing model weights forecast confidence as: OpenWeather 0.85, Open-Meteo 0.80, WeatherAPI 0.75, AccuWeather 0.92. These weights are tunable in `src/components/modules/food-intelligence-module.tsx`.

---

## 8. Per-Provider Implementation Notes

### 8.1 OpenWeather adapter (`openweather.ts`)

**Endpoints:**
- Current: `https://api.openweathermap.org/data/2.5/weather`
- Forecast (3h, 5 day): `https://api.openweathermap.org/data/2.5/forecast`
- One Call (current + hourly + daily + alerts): `https://api.openweathermap.org/data/3.0/onecall`
- Air Pollution: `https://api.openweathermap.org/data/2.5/air_pollution`

**Auth:** API key (`?appid=...`).

**Quirks:**
- The free tier (`2.5/weather`) doesn't include alerts; the One Call 3.0 API does, but requires a separate subscription ($0.001 per call).
- Wind speed is in m/s; the adapter multiplies by 3.6 for kph.
- The `weather[].id` field encodes the condition (e.g. 2xx = thunderstorm, 5xx = rain). The adapter maps to canonical `code` and `severity` (e.g. 200-232 → "storm" / "severe").
- Historical data is via One Call 3.0's `timemachine` endpoint, which only supports 5 days back. For longer historical queries, the adapter falls back to Open-Meteo.

### 8.2 WeatherAPI adapter (`weatherapi.ts`)

**Endpoints:**
- Current: `https://api.weatherapi.com/v1/current.json`
- Forecast (hourly + daily): `https://api.weatherapi.com/v1/forecast.json`
- Alerts: `https://api.weatherapi.com/v1/forecast.json` (alerts nested under `alerts.alert[]`)
- Astronomy: `https://api.weatherapi.com/v1/astronomy.json`
- History: `https://api.weatherapi.com/v1/history.json`

**Auth:** API key (`?key=...`).

**Quirks:**
- Forecast days is capped at 3 (free) / 7 (Pro) / 14 (Developer) / 30 (Enterprise). The adapter caps `days` based on the tenant's plan.
- `forecast.json` returns current + location + forecast in one call. The adapter splits into `CanonicalWeather` (current), `CanonicalForecastHourly` (forecast.forecastday[0].hour), `CanonicalForecastDaily` (forecast.forecastday).
- Astronomy (sunrise/sunset) is in the daily forecast via the `astro` field.
- Historical data goes back 7 days on free tier, 30 days on Pro, unlimited on Enterprise.

### 8.3 AccuWeather adapter (`accuweather.ts`)

**Endpoints:**
- Locations (geoposition search): `https://dataservice.accuweather.com/locations/v1/cities/geoposition/search`
- Current conditions: `https://dataservice.accuweather.com/currentconditions/v1/{locationKey}`
- Forecast (12h / 1d / 5d / 10d / 15d / 25d / 30d / 45d): `https://dataservice.accuweather.com/forecasts/v1/...`
- Alerts: `https://dataservice.accuweather.com/alerts/v1/{locationKey}`

**Auth:** API key (`?apikey=...`).

**Quirks:**
- AccuWeather uses `locationKey` (an opaque integer) instead of lat/lon. The adapter first calls `geoposition/search` to translate lat/lon → locationKey, caches the result (TTL 365 days — AccuWeather location keys are stable), then calls the data endpoints.
- The free tier is 50 calls/day. This is sufficient for a prefetch job that runs every 3 hours against ~20 monitored locations (8 calls/cycle = 64 calls/day — too many). Tenants on the free tier must either reduce monitored locations or upgrade.
- Forecasts return imperial units by default; the adapter requests metric via `?metric=true`.
- AccuWeather's `RealFeelTemperature` maps to canonical `feelsLikeC`.

### 8.4 Open-Meteo adapter (`open-meteo.ts`)

**Endpoints:**
- Forecast: `https://api.open-meteo.com/v1/forecast`
- Historical forecast: `https://archive-api.open-meteo.com/v1/archive`
- Air quality: `https://air-quality-api.open-meteo.com/v1/air-quality`
- Marine: `https://marine-api.open-meteo.com/v1/marine`
- Geocoding: `https://geocoding-api.open-meteo.com/v1/search`

**Auth:** None required. The adapter sends `User-Agent: Eks-Food/1.0 (https://eks-food.com)` per the usage policy.

**Quirks:**
- Open-Meteo supports up to 100 days of historical data via the archive API, but the archive API is rebuilt daily and only goes back to 1940 (ERA5 reanalysis). For real-time historical (last 7 days), use the regular forecast API with `past_days` parameter.
- No severe-weather alerts endpoint — the adapter marks `alerts` capability as `supported = false`.
- Wind speed is in km/h by default (matches canonical).
- The forecast API accepts a `hourly` parameter listing the variables to return. The adapter requests a superset: `temperature_2m, relative_humidity_2m, apparent_temperature, precipitation, precipitation_probability, weather_code, wind_speed_10m, wind_direction_10m, cloud_cover, uv_index`.
- The `weather_code` (WMO code) is mapped to canonical `code` and `label` via the WMO interpretation table.

---

## 9. Worked Example — Demand Sensing

The food-intelligence module uses weather to anticipate demand spikes:

```typescript
import { weather } from "@eks/connectors/weather";

async function predictDemandSpike(hub: { lat: number; lon: number; label: string }): Promise<DemandPrediction> {
  // 1. Get the 48-hour forecast (cached for 10 min)
  const forecast = await weather.forecastHourly({ lat: hub.lat, lon: hub.lon, hours: 48, label: hub.label });

  // 2. Get current conditions (cached for 2 min)
  const current = await weather.current({ lat: hub.lat, lon: hub.lon, label: hub.label });

  // 3. Get any severe-weather alerts (cached for 60 s)
  const alerts = await weather.alerts({ lat: hub.lat, lon: hub.lon, radiusKm: 25 });

  // 4. Score the demand prediction
  let demandMultiplier = 1.0;
  // Rain in the next 6 hours → comfort food demand up 15%
  const rainHours = forecast.hours.slice(0, 6).filter(h => h.precipitationMm > 0.5).length;
  if (rainHours >= 3) demandMultiplier *= 1.15;
  // Heat wave (3+ hours > 35°C) → cold drinks up 25%
  const heatHours = forecast.hours.slice(0, 12).filter(h => h.temperatureC > 35).length;
  if (heatHours >= 3) demandMultiplier *= 1.25;
  // Severe storm alert → demand drops 40% (customers stay home)
  if (alerts.some(a => a.severity === "severe" || a.severity === "extreme")) {
    demandMultiplier *= 0.6;
  }

  return { hub, demandMultiplier, confidence: forecast.provider === "accuweather" ? 0.92 : 0.80, alerts };
}
```

The total cost per prediction: typically 0 provider calls (3 cache hits) for repeat hubs within the cache window. For a cold cache, 3 calls to OpenWeather (free tier) = $0.00. AccuWeather users would pay ~$0.0003 per cold prediction.

---

## 10. Historical Weather for Procurement

The procurement planner uses historical rainfall to anticipate crop yields and wholesale prices:

```typescript
import { weather } from "@eks/connectors/weather";

async function correlateRainfallWithPrice(supplierRegion: { lat: number; lon: number }): Promise<PriceForecast> {
  // Pull 30 days of historical weather for the supplier's region
  const historical = await weather.historical({
    lat: supplierRegion.lat,
    lon: supplierRegion.lon,
    from: new Date(Date.now() - 30 * 86_400_000),
    to: new Date(),
  });

  // Aggregate rainfall
  const totalRainMm = historical.hours.reduce((sum, h) => sum + h.precipitationMm, 0);
  const rainyDays = new Set(historical.hours.filter(h => h.precipitationMm > 1).map(h => h.validAt.slice(0, 10))).size;

  // Heuristic: > 200mm in 30 days → expected price drop (good yield)
  //             < 50mm in 30 days → expected price spike (drought)
  let expectedPriceDeltaPct = 0;
  if (totalRainMm > 200) expectedPriceDeltaPct = -8;
  else if (totalRainMm < 50) expectedPriceDeltaPct = +15;

  return { totalRainMm, rainyDays, expectedPriceDeltaPct };
}
```

This call hits Open-Meteo's archive API (free, no key) and is cached for 30 days — the historical data is immutable.

---

## 11. Severe-Weather Response Flow

When a severe-weather alert is detected, Eks-Food's response is automated:

1. The scheduler polls `weather.alerts` every 60 s for each tenant's monitored locations.
2. On a new alert with `severity ≥ moderate`, the scheduler publishes a `SevereWeatherAlert` event on the M1 `EventOutbox`.
3. The notifications module (`@eks/notifications`) picks up the event and:
   - Sends a push notification to affected cooks ("Severe weather expected in your area. Consider rescheduling outdoor bookings.").
   - Sends an SMS to cooks without push (via the communications provider).
   - Sends an in-app notification to affected customers with active bookings.
4. The matching engine receives the alert via the event bus and down-weights bookings in the affected area for the alert window (multiplies the demand score by 0.6).
5. The merchant module surfaces the alert on any active catering contracts with outdoor clauses — the operator can proactively offer a contingency.

The alert response is logged for audit (M2 `AuditLog` with `WEATHER_ALERT_RESPONSE` action code).

---

## 12. Per-Region Configuration

Eks-Food's monitored locations span West Africa, where station density varies wildly. The provider weights are region-aware:

```json
{
  "regionWeights": {
    "GH": { "openweather": 80, "open-meteo": 70, "weatherapi": 50, "accuweather": 30 },
    "NG": { "openweather": 80, "open-meteo": 75, "weatherapi": 60, "accuweather": 30 },
    "KE": { "openweather": 80, "open-meteo": 75, "weatherapi": 60, "accuweather": 35 },
    "ZA": { "openweather": 80, "open-meteo": 80, "weatherapi": 65, "accuweather": 45 }
  }
}
```

The weights reflect that Open-Meteo's ERA5 reanalysis is denser in southern Africa (closer to research-grade weather stations), while OpenWeather's interpolated grid is denser in coastal West Africa.

---

## 13. Operations

### 13.1 Health monitoring

The M4 `HealthMonitor` calls each adapter's `healthCheck` every 60 s. For weather adapters, the health check is a `current` call for a known location (Accra coordinates) with a 5 s timeout. The latency and status feed `ProviderHealth`.

### 13.2 Quota

OpenWeather free tier: 60 calls/min, 1M/month. Open-Meteo: 10k calls/day (no key). WeatherAPI: 1M/month. AccuWeather: 50 calls/day.

For a tenant with 20 monitored locations on a 3-hour prefetch cycle, the daily call count is ~160 (OpenWeather) + 160 (Open-Meteo) = 320 calls/day, well within free tiers. The cache hit rate for on-demand calls from the matching engine is ~90%, so the actual call volume is dominated by prefetch.

### 13.3 Alert fatigue

The 60 s alert polling can produce alert fatigue if a provider sends repeated alerts for the same storm. The engine deduplicates by `(provider, alertId)` — the same alert from the same provider is only delivered once. Cross-provider deduplication is conservative (see §7.3).

Operators can mute specific alert types per region via `WeatherProvider.alertSubscriptions`:

```json
{ "alertSubscriptions": ["storm", "flood", "heat"] }
```

Muted types (`haze`, `wind`, `dust`, `fire`, `cold`, `other`) are still polled but do not trigger notifications.

---

## 14. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Polling `current` every 5 seconds | Quota burn; cache miss every time | Use 2-min TTL; the matching engine doesn't need second-by-second precision |
| Trusting `precipitationProbabilityPct` as deterministic | Forecast models disagree; binary decisions fail | Treat as probability; set thresholds at 70% (likely) / 30% (unlikely) |
| Cross-provider forecast averaging | Averaged forecast is *worse* than either source | Use the canonical `provider` field; weight downstream models by provider |
| Forgetting to convert m/s → km/h | OpenWeather wind speed 5x too low | The adapter handles this; do not re-implement |
| Calling AccuWeather per-booking | 50/day limit exhausted in minutes | Use AccuWeather only for prefetch; cache aggressively |
| Treating `historical` as free for any range | OpenWeather's free tier limits to 5 days back | Use Open-Meteo's archive API for > 5-day historical |
| Caching alerts for > 60 s | Customer sees expired storm warning | 60 s is the floor; severe weather is time-sensitive |
| Geocoding cook address to lat/lon on every weather call | Wasted maps calls + cache misses | Geocode once, persist the lat/lon on the cook record, reuse |

---

## 15. Further Reading

- `PROVIDER_DEVELOPMENT.md` — the adapter authoring pattern.
- `PROVIDER_SELECTION.md` — the `cost-aware` strategy used for weather.
- `CONNECTOR_OPERATIONS.md` — cache inspector, prefetch monitoring, alert fatigue.
- `PROCUREMENT_GUIDE.md` — how historical weather feeds procurement planning.
- `DISASTER_RECOVERY.md` — weather-specific DR (provider outage during severe-weather event, cache rebuild).
- `docs/integration/SYNCHRONIZATION_GUIDE.md` — the M4 sync engine (used for prefetch scheduling).
