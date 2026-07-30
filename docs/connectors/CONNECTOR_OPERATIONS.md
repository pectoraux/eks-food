# Eks-Food Connector Ecosystem — Production Operations

> **Audience:** On-call integration SREs, support engineers, platform operators. Read alongside `PROVIDER_DEVELOPMENT.md` (the adapter authoring guide), `PROVIDER_SELECTION.md` (the routing engine), `DISASTER_RECOVERY.md` (failure-mode recovery), and the M4 `docs/integration/OPERATIONS_RUNBOOK.md` (the underlying universal-connector runbook).
>
> **Status:** Milestone 5 — operating the production connector ecosystem (`@eks/connectors`, the `/api/v1/providers/*` routes, and the `ExternalProvider` / `ProviderConfiguration` / `ProviderHealth` / `ProviderCapability` / `ProviderCredential` / `ProviderRegion` / `ConnectorCache` / `SynchronizationHistory` Prisma models).

---

## 1. The Operations Dashboard

The dashboard is the single pane of glass for the M5 connector ecosystem. It is served at `/api/v1/providers/dashboard` and rendered in the Console under **Integrations → Providers → Dashboard**.

### 1.1 Layout

The dashboard has six panels arranged around a top strip of tenant-scoped KPIs.

| Panel | Data source | Refresh | Sort by |
|---|---|---|---|
| **KPI strip** | aggregate counts across all `ProviderConfiguration` for the tenant | 30 s | n/a |
| **Unhealthy providers** | `ProviderHealth.status = UNHEALTHY` | 30 s | most recent `updatedAt` |
| **Degraded providers** | `ProviderHealth.status = DEGRADED` | 30 s | highest `errorRate5m` |
| **Quota burn-down** | `ProviderHealth.callsLastDay / ExternalProvider.rateLimitPerDay` | 60 s | highest burn % first |
| **Sync lag** | `ProviderHealth.syncLagSec > 300` | 60 s | largest lag first |
| **Circuit breakers OPEN** | `ProviderHealth.circuitState = OPEN` | 30 s | oldest OPEN first |
| **Cache hit rate** | `ConnectorCache.hits / (hits + misses)` per namespace | 60 s | lowest hit rate first |

### 1.2 The KPI strip

```
Providers: 14 active / 2 paused / 0 disabled   |   Avg availability 5m: 99.84%
Cache hit rate: 87% (geocode 96% / weather 71% / routes 64%)
Quota utilisation: Google Maps 38% / HERE 12% / Mapbox 6% / OSM N/A
Open circuit breakers: 1 (HERE — Accra region)
Webhook DLQ depth: 4 (Merchant — Stripe)
Sync lag p95: 142 s (Procurement — Sysco)
```

Each KPI links to the relevant drill-down panel. Hovering exposes the underlying query for reproduction in the API explorer.

---

## 2. Health Monitoring

### 2.1 The `ProviderHealth` model (recap)

```prisma
model ProviderHealth {
  configId        String  @unique
  status          String  // HEALTHY | DEGRADED | UNHEALTHY | UNKNOWN
  p50LatencyMs    Int?
  p99LatencyMs    Int?
  availability5m  Float   @default(1)
  errorRate5m     Float   @default(0)
  circuitState    String  @default("CLOSED")
  syncLagSec      Int     @default(0)
  cacheHitRate5m  Float   @default(0)
  callsLastMin    Int     @default(0)
  callsLastDay    Int     @default(0)
  quotaRemainingPct Float?
  lastError       String?
  updatedAt       DateTime @updatedAt
}
```

### 2.2 The health-refresh job

The M4 `HealthMonitor` from `@eks/integration` runs every 60 s and writes one `ProviderHealth` row per `ProviderConfiguration`. For each provider it:

1. Calls the adapter's `healthCheck(ctx)` via `ConnectorRunner` (with a 5 s timeout and a single attempt — health checks do not retry).
2. Reads the last 5 minutes of `ConnectorExecution` rows and computes `availability5m` and `errorRate5m`.
3. Reads the last 5 minutes of `ConnectorCache` hit/miss counters and computes `cacheHitRate5m`.
4. Reads `ProviderCredential.expiresAt` and, if any are within 7 days of expiry, sets `status = DEGRADED` and `lastError = "credential_expiring"`.
5. Mirrors the in-memory `CircuitBreaker.state` into `circuitState`.
6. Computes `syncLagSec = now - lastSyncAt` (for sync-driven categories: procurement, government, restaurants).

### 2.3 Status transitions

| From | To | Trigger |
|---|---|---|
| HEALTHY | DEGRADED | `availability5m < 0.99` or `p99LatencyMs > categorySLO` or credential expiring |
| DEGRADED | UNHEALTHY | `availability5m < 0.95` or `circuitState = OPEN` |
| UNHEALTHY | DEGRADED | `availability5m ≥ 0.95` and breaker HALF_OPEN |
| DEGRADED | HEALTHY | `availability5m ≥ 0.99` for 5 consecutive checks |
| any | UNKNOWN | health job failed 3 times in a row (the engine stops routing to the provider) |

Each transition emits a `ProviderHealthChanged` event on the M1 `EventOutbox`. The M2 `@eks/notifications` service routes these to the on-call channel (PagerDuty for HEALTHY → UNHEALTHY; Slack for DEGRADED transitions).

### 2.4 Per-category SLOs

The latency threshold for DEGRADED is per-category, set in `src/packages/connectors/<category>/slo.ts`:

| Category | p99 SLO (ms) | Availability SLO |
|---|---|---|
| maps | 800 | 99.5% |
| weather | 1200 | 99.0% |
| calendar | 1500 | 99.5% |
| government | 5000 | 99.0% |
| restaurants | 2000 | 99.5% |
| procurement | 5000 | 99.0% |
| merchant | 2000 | 99.5% |
| notifications | 800 | 99.9% |
| communications | 600 | 99.9% |
| identity | 400 | 99.95% |

---

## 3. Sync Dashboard

For sync-driven categories (procurement supplier catalogues, government inspection databases, restaurant POS menus), the sync dashboard is the primary ops surface. Served at `/api/v1/providers/:configId/history` and rendered under **Integrations → Providers → [provider] → Sync**.

### 3.1 The `SynchronizationHistory` row (recap)

```prisma
model SynchronizationHistory {
  configId          String
  mode              String  // FULL | INCREMENTAL | DELTA | WEBHOOK
  status            String  // RUNNING | SUCCEEDED | FAILED | PARTIAL
  startedAt         DateTime
  completedAt       DateTime?
  durationMs        Int?
  cursorFrom        String?
  cursorTo          String?
  recordsProcessed  Int
  recordsCreated    Int
  recordsUpdated    Int
  recordsFailed     Int
  conflicts         Int
  errorMessage      String?
  syncJobId         String? // link to the M4 SynchronizationJob for checkpoint replay
}
```

### 3.2 Panel layout

- **Run list** — last 200 runs, filterable by `mode` and `status`. Each row shows mode badge, status badge, duration, records (created/updated/failed), cursor advance, error tooltip.
- **Throughput chart** — records/sec over the last 50 runs (sparkline).
- **Failure breakdown** — pie of error codes from the last 100 failed runs.
- **Cursor timeline** — monotonic advance of the cursor; flat lines indicate the source has no new data, regressions indicate a cursor reset (alert!).
- **Conflict log** — last 50 conflicts (records where the provider's data disagreed with Eks-Food's) with a link to the conflict-resolution UI.

### 3.3 Triggering a sync

Syncs can be triggered three ways:

1. **Scheduled** — the M4 `Scheduler` fires a sync per the `ProviderConfiguration.config.schedule` cron expression (e.g. procurement catalogues every 6 h, government notices every 24 h).
2. **Webhook-driven** — for providers that support change notifications (e.g. Stripe `product.updated`, Google Calendar `changed`), the webhook handler enqueues a DELTA sync scoped to the changed resource.
3. **Manual** — an operator clicks **Sync now** in the Console, which `POST /api/v1/providers/:configId/sync` with `{ mode: "INCREMENTAL" }` (or `FULL` to force a complete re-pull). The route returns the `SynchronizationHistory.id` for polling.

Manual syncs are rate-limited to one per `configId` per 30 s to prevent manual-spam from overlapping the scheduler.

### 3.4 Partial-failure handling

A sync is marked `PARTIAL` when:

- `recordsFailed > 0` and `recordsFailed < recordsProcessed * 0.1` (≤ 10% failure rate), OR
- any individual page failed but later pages succeeded.

The `SynchronizationHistory.errorMessage` lists the failure codes; the failed records are written to the M4 `WebhookDelivery` table with `status = DEAD_LETTERED` for replay (see §8 below).

---

## 4. Cache Inspector

The cache inspector is served at `/api/v1/providers/:configId/cache` and rendered under **Integrations → Providers → [provider] → Cache**. It queries the `ConnectorCache` table.

### 4.1 Panel layout

- **Namespace selector** — dropdown of namespaces present for this config (`geocode:v1`, `weather:forecast:hourly`, `oauth:tokens`, `signed:urls`, `negative:v1`).
- **Entry list** — paginated 50/page, showing the cache key (truncated SHA-256), value (first 200 chars), `ttlSec`, `expiresAt` countdown, `hits`, `misses`, `sizeBytes`.
- **Hit-rate chart** — `hits / (hits + misses)` over the last 24 h.
- **Size budget** — `SUM(sizeBytes)` against the tenant's per-config budget (default 50 MB; `ProviderConfiguration.config.cache.maxBytes`).
- **Actions** — *Invalidate* (single entry), *Flush namespace* (all entries in the selected namespace), *Flush all* (every entry for this config).

### 4.2 When to flush

| Symptom | Action |
|---|---|
| Geocode results are stale (a street was renamed) | Flush `geocode:v1` for the affected tenant |
| OAuth token cache holds a revoked token | Flush `oauth:tokens` — the next call re-authenticates |
| Weather forecast is wildly off | Flush `weather:forecast:hourly` — the next call hits the provider |
| Cache size exceeds budget | The runtime auto-evicts the lowest-hit entries; manual flush only if persistent |
| Tenant reports "wrong" data after a provider schema change | Flush all namespaces for the affected `configId` |

### 4.3 Programmatic access

```bash
# Inspect (paginated)
curl "/api/v1/providers/cfg_abc/cache?namespace=geocode:v1&limit=50&offset=0"

# Invalidate a single key
curl -X DELETE "/api/v1/providers/cfg_abc/cache?namespace=geocode:v1&key=accra"

# Flush a namespace
curl -X DELETE "/api/v1/providers/cfg_abc/cache?namespace=oauth:tokens"
```

Cache writes are async (the runtime writes the cache row after the response is returned to the caller). A cache flush is therefore eventual — in-flight responses may re-populate the cache within ~50 ms of the flush.

---

## 5. Webhook Monitor

The webhook monitor surfaces inbound webhook delivery health. It re-uses the M4 `WebhookEndpoint` and `WebhookDelivery` tables (see `docs/integration/WEBHOOK_GUIDE.md`) but adds a provider-aware view at `/api/v1/providers/:configId/webhooks`.

### 5.1 Panel layout

- **Endpoint list** — one row per `WebhookEndpoint` for this `configId`, showing the inbound slug, signed-secret fingerprint, event-type filter, verified flag, deliveries in the last 24 h, DLQ depth.
- **Delivery timeline** — last 500 deliveries for the selected endpoint, with `eventId`, `eventType`, `status` (DELIVERED / FAILED / RETRYING / DEAD_LETTERED), `attempts`, `responseStatus`, `errorMessage`.
- **DLQ depth** — count of `WebhookDelivery.status = DEAD_LETTERED` for this endpoint; > 0 shows a **Replay all** button.
- **Signature failures** — count of deliveries that failed HMAC verification in the last hour (a spike here means the provider rotated their signing key without telling us; see §6).

### 5.2 Verifying an endpoint

Each `WebhookEndpoint` exposes a verification challenge flow. For providers that support it (Stripe, Twilio, Google Calendar), the install flow exchanges the challenge automatically. For providers that don't (custom integrations), an operator runs:

```bash
curl -X POST /api/v1/providers/cfg_abc/webhooks/verify \
  -d '{ "endpointId": "ep_xyz", "samplePayload": "…", "sampleSignature": "…" }'
```

The route runs the adapter's `verifySignature` method and returns `{ verified: bool, detail: string }`. On success it sets `WebhookEndpoint.verified = true` and the runtime begins accepting deliveries.

---

## 6. API Usage Analytics

Served at `/api/v1/providers/:configId/usage` and rendered under **Integrations → Providers → [provider] → Usage**. Shows API-call volume against the provider's hard rate limit, so operators can spot a runaway tenant or a quota cliff.

### 6.1 Data sources

- `ProviderHealth.callsLastMin` and `callsLastDay` — refreshed every 60 s.
- `ConnectorExecution` rows — the granular per-call log (one row per invoke, retained 30 days then aggregated into `SynchronizationHistory`).
- `ExternalProvider.rateLimitPerSec` and `rateLimitPerDay` — the provider's published limits.

### 6.2 Panel layout

- **Burn-down chart** — `callsLastDay / rateLimitPerDay` over the last 24 h, with a horizontal line at 80% (yellow) and 95% (red).
- **Calls-per-minute sparkline** — last 60 min, overlaid with the per-second limit.
- **Top callers** — the business surfaces responsible for the most calls (e.g. `maps.geocode` 41%, `maps.autocomplete` 33%, `maps.route` 19%).
- **429 count** — rate-limit responses in the last 24 h; > 0 indicates the tenant is hitting the provider's limit and the selection engine should be re-weighted toward a secondary provider.

### 6.3 Cost rollup

Each `ProviderCapability` row carries `costPer1kUsdCents`. The usage page multiplies call volume by cost per 1k to produce a daily/monthly USD figure per provider and per capability. The tenant's finance team can export this via:

```bash
curl "/api/v1/providers/usage/export?organizationId=org_abc&from=2025-01-01&to=2025-01-31&format=csv"
```

---

## 7. Rate-Limit Management

### 7.1 The two-layer model

The M5 ecosystem enforces rate limits at **two** layers:

1. **Eks-Food → provider** — the M4 `RateLimiter` (token bucket) caps outbound calls at `ExternalProvider.rateLimitPerSec` (and per-day, if set). The bucket is shared across all tenants using that provider, so one tenant cannot exhaust the provider's quota for another.
2. **Provider → Eks-Food** — when a provider responds 429, the adapter returns `{ ok: false, retryable: true, error: "rate_limited" }`, the `ConnectorRunner` backs off, and the `ProviderHealth.callsLastMin` counter increments. After 3 consecutive 429s within 60 s, the provider's circuit breaker opens for 30 s.

### 7.2 Per-tenant quotas

Tenants can be capped independently of the provider's limit. `ProviderConfiguration.config.rateLimit` overrides the bucket:

```json
{ "rateLimit": { "perSec": 25, "perDay": 50000, "burst": 50 } }
```

This is the recommended pattern for tenants on a cheaper plan. The selection engine respects the per-tenant cap; calls beyond it fail fast with `RATE_LIMITED` (no provider call is made).

### 7.3 The 429-backoff hint

When a 429 is received, the adapter reads the provider's `Retry-After` header (if present) and returns it as a hint to the runtime. The runtime then suspends that provider for `Retry-After` seconds — during which the selection engine routes to fallbacks (if any). If no fallback is configured, the call returns `RATE_LIMITED` to the business surface, which surfaces a 429 to the end user with a `Retry-After` header.

### 7.4 Re-weighting on sustained 429

If a provider returns 429 on more than 5% of calls in a 15-min window, the selection engine auto-dewights it: `weight = weight * 0.5`. The deweight is logged as a `ProviderAutoDeweighted` event and surfaces as an alert in the dashboard. Recovery is automatic: when the 429 rate drops below 1% for 30 min, the engine restores the original weight.

---

## 8. Credential Rotation

### 8.1 The `ProviderCredential` row (recap)

```prisma
model ProviderCredential {
  configId        String
  authType        String  // api-key | oauth2 | bearer | basic | signed | mtls | custom
  encryptedSecret String  // AES-256-GCM envelope
  hint            String? // last-4 of API key, OAuth subject, etc.
  active          Boolean @default(true)
  expiresAt       DateTime?
  lastRotatedAt   DateTime?
  lastUsedAt      DateTime?
}
```

### 8.2 Rotation flow

Rotation is initiated by `POST /api/v1/providers/:configId/credentials/rotate`:

1. The operator supplies the new credential payload (or, for OAuth2, the new refresh token).
2. The route encrypts the new credential via `@eks/security` and writes a new `ProviderCredential` row with `active = true`.
3. The old credential's row is set `active = false` (NOT deleted — retained for audit and rollback for 90 days).
4. The route publishes a `CredentialRotated` event on the M1 `EventOutbox`.
5. The next `invoke` picks up the new credential via the M4 `AuthProvider`, which always returns the most-recent `active = true` row.
6. The runtime fires a `healthCheck` to validate the new credential. On failure, the route rolls back: re-activates the old credential, marks the new one `active = false`, and returns `{ ok: false, detail: "health_check_failed" }`.

### 8.3 Scheduled rotation

For providers that support short-lived credentials (OAuth2 access tokens, signed URLs), rotation is automatic and invisible. The adapter's `authenticate` method refreshes the token before expiry; the refreshed value is written to `ConnectorCache` under `oauth:tokens` with a TTL of `expires_in - 60s`.

For long-lived credentials (API keys, service-account keys), scheduled rotation is the operator's responsibility. The dashboard surfaces credentials within 7 days of `expiresAt` as DEGRADED; within 1 day as UNHEALTHY. PagerDuty is paged for UNHEALTHY credentials.

### 8.4 Master-key rotation

The tenant master key (used to encrypt all `ProviderCredential.encryptedSecret` values) is rotated annually. The M4 `@eks/integration` secrets module runs a background job that re-encrypts every `ProviderCredential` row with the new master key and atomically swaps the active key. See `docs/integration/AUTHENTICATION_GUIDE.md` §9.

---

## 9. Circuit Breaker Recovery

### 9.1 Recovery flow

When a circuit breaker transitions OPEN → HALF_OPEN → CLOSED, the runtime:

1. Emits a `CircuitBreakerTransition` event with `{ from: "OPEN", to: "HALF_OPEN", configId, providerCode }`.
2. Allows one trial `invoke` (or `healthCheck`).
3. On success: transitions to CLOSED, emits `CircuitBreakerTransition { from: "HALF_OPEN", to: "CLOSED" }`, restores the provider's `ProviderHealth.status` from UNHEALTHY to DEGRADED (HEALTHY requires 5 consecutive healthy checks per §2.3).
4. On failure: transitions back to OPEN, doubles the cooldown (max 5 min), emits `CircuitBreakerTransition { from: "HALF_OPEN", to: "OPEN" }`.

### 9.2 Forced reset

When an operator has confirmed (out-of-band) that the provider is healthy and the breaker is stuck OPEN due to a stale state, the forced-reset endpoint is used:

```bash
curl -X POST /api/v1/providers/cfg_abc/circuit-breaker/reset
# → { ok: true, previousState: "OPEN", newState: "CLOSED" }
```

This sets `ProviderHealth.circuitState = CLOSED`, clears the in-memory breaker state, and emits a `CircuitBreakerForceReset` event (audited as `INTEGRATION_AUDIT_ACTIONS.CIRCUIT_BREAKER_RESET`). The next `invoke` will be a trial; if it fails, the breaker re-opens immediately.

### 9.3 When to force reset

| Symptom | Force-reset? |
|---|---|
| Provider had a regional outage, now confirmed recovered, breaker still OPEN | Yes |
| Provider returned 429s for 5 min, breaker opened, 429s stopped | Yes — after confirming 429 rate is 0 for 5 min |
| Breaker keeps re-opening immediately after reset | No — the provider is still unhealthy; investigate the underlying error |
| Breaker OPEN but `ProviderHealth.status = HEALTHY` (state desync) | Yes — and file a bug; this should not happen |

---

## 10. DLQ Replay

### 10.1 What lands in the DLQ

Two kinds of records reach the dead-letter queue:

1. **Webhook deliveries** that exhausted all retries (default 5 attempts over ~3 h, per the M4 `RetryPolicy`). Rows in `WebhookDelivery` with `status = DEAD_LETTERED`.
2. **Sync records** that failed mapping or transformation during a sync run. The M4 sync engine writes these to `WebhookDelivery` as well (reusing the table) with `eventType = "sync.record.failed"`.

### 10.2 The DLQ view

Served at `/api/v1/providers/:configId/dlq` and rendered under **Integrations → Providers → [provider] → DLQ**. Shows:

- Depth (count of `DEAD_LETTERED` rows for this config).
- Age of oldest entry.
- Error-code breakdown.
- Per-entry: payload (truncated), headers, error message, attempts, first-attempt time, last-attempt time.

### 10.3 Replay flow

```bash
# Replay a single delivery
curl -X POST /api/v1/providers/cfg_abc/dlq/dlv_xyz/replay

# Replay all DLQ entries for a config (batched, 10 at a time)
curl -X POST /api/v1/providers/cfg_abc/dlq/replay-all \
  -d '{ "filter": { "eventType": "sync.record.failed" }, "maxBatch": 100 }'
```

Replay re-runs the adapter's `handleWebhook` (or `mapSchema` for sync failures) against the original payload. On success, the `WebhookDelivery.status` transitions to `REPLAYED`; on failure, it remains `DEAD_LETTERED` and the attempts counter increments.

### 10.4 Replay safety

Replay is **idempotent**: the adapter is expected to deduplicate by `eventId` (for webhooks) or by record `dedupeKey` (for sync records). The M4 `WebhookPlatform` enforces this via the unique `(endpointId, eventId)` index. Replaying the same delivery twice does not produce duplicate side effects.

### 10.5 When to drain the DLQ

| DLQ depth | Action |
|---|---|
| < 10 | Monitor; individual replays as needed |
| 10–100 | Investigate root cause; bulk replay after fix |
| 100–1000 | Pause the provider; bulk replay in batches of 100; alert on-call |
| > 1000 | Page on-call; the provider or adapter has a systemic issue — see `DISASTER_RECOVERY.md` §4 |

---

## 11. Alerting

The M5 ecosystem exports the following Prometheus metrics (labelled by `organization_id`, `provider_code`, `category`, `capability`):

| Metric | Type | Description |
|---|---|---|
| `eks_provider_invocations_total` | counter | Adapter invocations, labelled by `kind`, `status` |
| `eks_provider_latency_ms` | histogram | End-to-end invoke latency (including cache check) |
| `eks_provider_cache_hits_total` | counter | Cache hits, labelled by `namespace` |
| `eks_provider_cache_misses_total` | counter | Cache misses, labelled by `namespace` |
| `eks_provider_circuit_state` | gauge | 0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN |
| `eks_provider_quota_burn_pct` | gauge | `callsLastDay / rateLimitPerDay * 100` |
| `eks_provider_sync_lag_seconds` | gauge | `syncLagSec` from `ProviderHealth` |
| `eks_provider_dlq_depth` | gauge | Count of `DEAD_LETTERED` deliveries |
| `eks_provider_rate_limited_total` | counter | 429 responses received from the provider |
| `eks_provider_health_status` | gauge | 0 = HEALTHY, 1 = DEGRADED, 2 = UNHEALTHY, 3 = UNKNOWN |
| `eks_provider_credential_expires_in_days` | gauge | Days until `ProviderCredential.expiresAt` (active only) |

### 11.1 Alert rules

| Alert | Expression | For | Severity |
|---|---|---|---|
| ProviderUnhealthy | `eks_provider_health_status == 2` | 2 min | warning |
| ProviderCircuitOpen | `eks_provider_circuit_state == 2` | 5 min | warning |
| ProviderQuotaBurning | `eks_provider_quota_burn_pct > 80` | 10 min | warning |
| ProviderQuotaCritical | `eks_provider_quota_burn_pct > 95` | 5 min | critical |
| ProviderSyncLagHigh | `eks_provider_sync_lag_seconds > 1800` | 10 min | warning |
| ProviderSyncLagCritical | `eks_provider_sync_lag_seconds > 7200` | 5 min | critical |
| ProviderDLQOverflow | `eks_provider_dlq_depth > 100` | 5 min | warning |
| ProviderDLQFlood | `eks_provider_dlq_depth > 1000` | 1 min | critical |
| ProviderRateLimited | `rate(eks_provider_rate_limited_total[5m]) > 0.1` | 5 min | warning |
| ProviderCredentialExpiring | `eks_provider_credential_expires_in_days < 7` | n/a | warning |
| ProviderCredentialExpired | `eks_provider_credential_expires_in_days < 0` | n/a | critical |

---

## 12. On-Call Runbook

### 12.1 Triage checklist

When paged for a connector alert, run through this checklist before acting:

1. Open the dashboard. Is the alert still firing? (Half of all pages are stale.)
2. Identify the affected `configId` and `providerCode` from the alert labels.
3. Drill into the provider's health panel. Read `lastError` and the last 5 `ConnectorExecution` rows.
4. Check `circuitState`. If OPEN, the runtime has already isolated the provider; the alert is informational.
5. Check the DLQ. Depth > 0 means data is queued for replay, not lost.
6. Check credential expiry. A surprising fraction of "provider down" pages are credential expiry.
7. Check the provider's status page (linked from `ExternalProvider.documentationUrl`).
8. Only after steps 1–7 should you consider intervention.

### 12.2 The three interventions

Most pages resolve to one of three actions:

1. **Rotate the credential** (§8) — for `ProviderCredentialExpiring` / `ProviderCredentialExpired` / `AUTH_FAILED` errors.
2. **Force-reset the breaker** (§9) — for `ProviderCircuitOpen` after confirming the provider has recovered.
3. **Drain the DLQ** (§10) — for `ProviderDLQOverflow` after fixing the underlying mapping / transformation bug.

For everything else, see `DISASTER_RECOVERY.md`.

---

## 13. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Flushing the cache after every error | Cache hit rate collapses; provider quota burns 10x faster | Flush only the namespace for the affected capability; let the rest stay warm |
| Forcing a breaker reset before the provider recovers | Breaker re-opens immediately; trial request consumes quota | Wait for `availability5m ≥ 0.95` before resetting |
| Replaying the entire DLQ at once | Bursts the provider; secondary 429s; more DLQ entries | Use `maxBatch = 100` and pause between batches |
| Triggering a FULL sync when an INCREMENTAL would do | Provider rate-limited; sync takes hours | Always start with INCREMENTAL; escalate to FULL only if cursors are corrupt |
| Reading `ProviderHealth.status` more than 60 s after `updatedAt` | Stale health view; wrong triage | The health job runs every 60 s; if `updatedAt` is older, the job itself is failing (page on `health_job_lag` alert) |
| Trusting `quotaRemainingPct` from the provider's headers | Provider overstates remaining quota | Track `callsLastDay` independently; treat provider headers as advisory only |
| Branching on `provider` field in business code | Failover breaks; can't switch providers without code changes | Use the canonical schema; the `provider` field is for ops only |

---

## 14. Further Reading

- `PROVIDER_DEVELOPMENT.md` — building a new connector end to end.
- `PROVIDER_SELECTION.md` — the routing engine that picks between providers.
- `DISASTER_RECOVERY.md` — provider-outage runbooks, cache rebuild, multi-region failover.
- `docs/integration/OPERATIONS_RUNBOOK.md` — the M4 universal-connector runbook (underlying runtime, sync engine, webhook platform).
- `docs/integration/AUTHENTICATION_GUIDE.md` — the 8 auth strategies, secret envelope, master-key rotation.
- `docs/integration/WEBHOOK_GUIDE.md` — webhook delivery, signatures, retries, DLQ (M4 foundation).
- `docs/identity/NOTIFICATIONS.md` — the M2 notification service that routes provider alerts to on-call.
