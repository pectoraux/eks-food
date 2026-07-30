# Eks-Food Connector Ecosystem — Disaster Recovery

> **Audience:** On-call integration SREs, incident commanders, platform engineers. Read alongside `CONNECTOR_OPERATIONS.md` (the day-to-day ops surface), `PROVIDER_SELECTION.md` (the failover model), `PROVIDER_DEVELOPMENT.md` (the adapter contract), and the M4 `docs/integration/DISASTER_RECOVERY.md` (the underlying universal-connector DR).
>
> **Status:** Milestone 5. This document covers failure modes specific to the production connector ecosystem — provider outages, credential rotation emergencies, cache rebuild, sync-checkpoint corruption, webhook DLQ floods, circuit-breaker storms, multi-region failover — and the runbooks for recovering from each.

---

## 1. Failure-Mode Catalogue

The M5 ecosystem extends the M4 failure-mode catalogue with provider-aware failure modes. Severity is the *impact on Eks-Food business operations*; RTO is the *target time to recovery*.

| # | Failure mode | Severity | RTO | Runbook |
|---|---|---|---|---|
| 1 | Single-provider outage (e.g. Google Maps down) | Sev-3 | 0 min (automatic failover) | §3 |
| 2 | All providers in a category down (e.g. all weather APIs down) | Sev-2 | 30 min | §3.5 |
| 3 | Credential expiry / revocation | Sev-3 | 15 min | §4 |
| 4 | Master-key compromise | Sev-1 | 4 h | §4.4 |
| 5 | Cache rebuild (mass eviction / corruption) | Sev-3 | 30 min | §5 |
| 6 | Sync checkpoint corruption | Sev-2 | 1 h | §6 |
| 7 | Webhook DLQ flood | Sev-2 | 30 min | §7 |
| 8 | Circuit-breaker storm (cascade OPEN) | Sev-2 | 15 min | §8 |
| 9 | Region outage (e.g. Ghana AWS region down) | Sev-1 | 1 h | §9 |
| 10 | Provider schema change (breaking) | Sev-2 | 1 h | §10 |
| 11 | Normalisation regression (adapter bug) | Sev-2 | 30 min | §11 |
| 12 | Selection engine runaway (wrong provider picked) | Sev-3 | 15 min | §12 |
| 13 | Cross-tenant data leak (provider mix-up) | Sev-1 | immediate | §13 |
| 14 | Government authority outage (no fallback) | Sev-3 | 4 h (graceful degrade) | §14 |

Each failure mode is detailed below with diagnosis steps, recovery procedure, and post-incident actions.

---

## 2. Incident Severity Definitions

| Severity | Definition | Response |
|---|---|---|
| Sev-1 | Customer-visible data loss, security breach, or complete platform outage | Page on-call immediately; incident commander; war room; exec comms |
| Sev-2 | Customer-visible degradation affecting a category; no data loss | Page on-call; incident commander; status-page update |
| Sev-3 | Localised degradation; automatic failover absorbs most impact | On-call investigates during business hours; status-page update if > 30 min |
| Sev-4 | Background issue; no customer impact | Track in backlog |

---

## 3. Provider Outage Runbooks

### 3.1 Diagnosis: is it really the provider?

Before assuming a provider outage, rule out:

1. **Credential expiry** — check `ProviderCredential.expiresAt` for the affected `configId`. If expired or within 24h, follow §4 instead.
2. **Quota exhaustion** — check `ProviderHealth.callsLastDay` vs `ExternalProvider.rateLimitPerDay`. If burn > 95%, the provider is 429ing; follow §3.4.
3. **Circuit breaker OPEN** — check `ProviderHealth.circuitState`. If OPEN, the runtime has isolated the provider; check whether the breaker is stuck (§8) or correctly OPEN.
4. **DNS / network** — verify the provider's host resolves from the Eks-Food VPC. A DNS issue at the provider (or upstream) can mimic an outage.
5. **Provider status page** — check `ExternalProvider.documentationUrl` for the provider's status page. If they've declared an incident, follow §3.3 (coordinated failover).

### 3.2 Single-provider outage (automatic failover)

For categories with `fallbackChain: true` (maps, weather, communications, notifications, restaurants, merchant, procurement), the selection engine absorbs single-provider outages automatically:

1. The provider's `healthCheck` starts failing. `ProviderHealth.status` transitions to `DEGRADED` then `UNHEALTHY`.
2. The selection engine stops routing to the provider (Stage 4 filter in `PROVIDER_SELECTION.md` §3).
3. Surviving providers absorb the traffic. Cache hit rate may dip slightly (cache was warm for the failed provider's responses).
4. The failed provider's circuit breaker OPENS after 5 failures in 60 s.

**Operator action: usually none.** Verify via the dashboard that the surviving providers' quota burn is sustainable. If the failed provider's quota was substantial (e.g. Google Maps at 60% of maps traffic), the surviving providers may approach their own quotas — in that case, follow §3.3.

### 3.3 Coordinated failover (manual re-weighting)

When automatic failover is absorbing the impact but the surviving providers are burning quota too fast, the operator manually re-weights to spread load more evenly:

```bash
# Deweight the surviving providers' primary, uplift the tertiary
curl -X PATCH /api/v1/providers/cfg_google_maps -d '{ "weight": 0 }' # already down
curl -X PATCH /api/v1/providers/cfg_here         -d '{ "weight": 100 }'
curl -X PATCH /api/v1/providers/cfg_mapbox       -d '{ "weight": 80 }'
curl -X PATCH /api/v1/providers/cfg_osm          -d '{ "weight": 50 }'
```

This shifts the surviving traffic toward the providers with the most spare quota. Monitor `ProviderHealth.callsLastDay` for each; if any crosses 80%, deweight further.

### 3.4 Quota-exhaustion failover

When a provider is 429ing (not down, just rate-limited), the engine auto-deweights (`PROVIDER_OPERATIONS.md` §7.4). If the deweight isn't keeping up:

```bash
# Manually pause the rate-limited provider temporarily
curl -X POST /api/v1/providers/cfg_google_maps/pause
# The selection engine routes 100% to fallbacks
# After 30 min, resume:
curl -X POST /api/v1/providers/cfg_google_maps/resume
```

Pausing is safer than deweighting in extreme cases — the engine skips PAUSED providers entirely, so no quota is wasted on 429 retries.

### 3.5 All providers in a category down

The "no fallback" scenario. For categories with `region-exact` strategy (government) this is the expected state for cross-region requests; for others it's a genuine Sev-2.

Diagnosis:

1. Check all providers' `ProviderHealth.status` — if all are `UNHEALTHY`, this is a category-wide outage.
2. Check whether the failure is provider-side (all providers' status pages report issues) or Eks-Food-side (e.g. a bug in the canonical schema validation rejecting all responses).
3. If Eks-Food-side, follow §11 (normalisation regression).

Recovery options, in order of preference:

1. **Activate a backup provider** — if a provider is installed but `PAUSED` (e.g. AccuWeather for weather, paused because of cost), resume it.
2. **Relax selection filters** — the engine automatically relaxes (availability threshold, credential expiry) but operators can force-relax further via `POST /api/v1/providers/dashboard/relax-filters` with `{ "category": "weather", "level": "aggressive" }`. This is risky (it routes to degraded providers) but better than no service.
3. **Activate degraded mode** — for categories with a graceful-degradation path (e.g. maps can fall back to straight-line distance for the matching engine), trigger it via `POST /api/v1/providers/dashboard/degraded-mode` with `{ "category": "maps", "fallback": "straight-line" }`. This is business-surface-specific; each category documents its degraded mode.
4. **Status-page + customer comms** — if degraded mode is unacceptable, post a status-page update and notify affected customers.

### 3.6 The incident runbook — provider outage (template)

1. **Detect** — alert fires (`ProviderUnhealthy` or `ProviderCircuitOpen` for > 5 min).
2. **Acknowledge** — on-call acknowledges within 5 min.
3. **Diagnose** — run §3.1 checklist.
4. **Decide** — is automatic failover absorbing it? If yes, monitor only. If no, proceed.
5. **Communicate** — post status-page update if customer-visible.
6. **Recover** — apply §3.2, §3.3, or §3.5 as needed.
7. **Verify** — confirm `ProviderHealth.status = HEALTHY` for the recovered provider; confirm `cacheHitRate` returns to baseline.
8. **Close** — resolve the alert; update status page.
9. **Post-incident** — within 48 h, write a post-mortem covering root cause, time-to-detect, time-to-recover, and preventative actions.

---

## 4. Credential Rotation Runbooks

### 4.1 Routine rotation

Routine rotation (credential within 7 days of expiry) is non-urgent and follows `CONNECTOR_OPERATIONS.md` §8:

```bash
curl -X POST /api/v1/providers/cfg_abc/credentials/rotate \
  -d '{ "credentials": { "apiKey": "..." } }'
```

The runtime hot-swaps, validates via `healthCheck`, and rolls back on failure. No customer impact.

### 4.2 Emergency rotation (credential leaked)

If a credential is leaked (e.g. committed to a public repo, exposed in a log), rotate immediately:

1. **Revoke at the provider** — log into the provider's console (Google Cloud, Stripe, etc.) and revoke the leaked credential directly. This stops the bleeding even before Eks-Food rotates.
2. **Rotate in Eks-Food** — `POST /api/v1/providers/cfg_abc/credentials/rotate` with a new credential.
3. **Verify** — confirm `ProviderHealth.status = HEALTHY` after rotation.
4. **Audit** — pull `ConnectorExecution` rows for the affected `configId` in the leak window (typically the last 7 days). Look for unusual call patterns (spikes, off-hours calls, calls from unexpected IPs).
5. **Notify** — if the audit shows abuse, notify the provider's security team and the affected tenants.

### 4.3 OAuth revocation (provider-side)

If a user (or the provider) revokes an OAuth grant without telling Eks-Food:

1. The next `invoke` fails with `AUTH_FAILED`.
2. The adapter marks `ProviderConfiguration.status = ERROR` and `CalendarConnection.status = ERROR` (for calendar) or equivalent.
3. The selection engine routes around the failed provider.
4. The user must re-authenticate via the standard OAuth flow (`POST /api/v1/providers/calendar/connect/initiate`).

There is **no automatic recovery** for OAuth revocation — the user must consent again. The notifications module surfaces the re-auth requirement to the user via in-app + email.

### 4.4 Master-key compromise

If the tenant master key (used to encrypt all `ProviderCredential.encryptedSecret` values) is compromised, this is a Sev-1. The recovery procedure:

1. **Generate a new master key** — via the M4 `@eks/integration` secrets module (`POST /api/v1/integrations/secrets/master-key/rotate`).
2. **Re-encrypt all credentials** — the secrets module runs a background job that:
   - Decrypts each `ProviderCredential.encryptedSecret` with the old key.
   - Re-encrypts with the new key.
   - Updates the row atomically (using a transactional outbox pattern).
   - Marks the old key as `RETIRED` (kept for audit, but not used for new decryptions).
3. **Revoke old credentials at providers** — for each `ProviderCredential`, log into the provider's console and revoke the credential. (Re-encryption doesn't invalidate the old plaintext credential at the provider — an attacker who captured the old encrypted blob and has the old key could still use the plaintext.)
4. **Issue new credentials** — for each provider, generate a new credential, rotate via §4.2.
5. **Verify** — confirm all `ProviderConfiguration` rows have `ProviderHealth.status = HEALTHY`.
6. **Audit** — pull `ConnectorExecution` rows for the compromise window. Look for abuse.

This procedure takes 2-4 hours for a tenant with ~20 providers. The master-key rotation job itself runs in ~10 minutes; the manual provider-side revocation is the long pole.

---

## 5. Cache Rebuild

### 5.1 Mass eviction

Mass eviction happens when:

- The cache budget is exceeded (e.g. a tenant's geocode traffic spikes 10x).
- A canonical schema version bump requires a namespace rotation (`geocode:v1` → `geocode:v2`).
- A bug in the cache key derivation causes hash collisions (very rare; surfaces as "wrong" cached responses).

After mass eviction, the cache hit rate drops to 0% and provider quota burn spikes 5-10x. Recovery:

1. **Throttle inbound traffic** — if the dashboard shows quota burn approaching limits, enable the rate-limit override on each `ProviderConfiguration`:
   ```bash
   curl -X PATCH /api/v1/providers/cfg_abc -d '{ "config": { "rateLimit": { "perSec": 25, "burst": 50 } } }'
   ```
   This caps the burn and lets the cache refill gradually.
2. **Prefetch hot keys** — for weather (where the monitored locations are known), trigger the prefetch job immediately:
   ```bash
   curl -X POST /api/v1/providers/cfg_openweather/prefetch
   ```
   The prefetch iterates `WeatherProvider.monitoredLocations` and warms the cache.
3. **Monitor hit-rate recovery** — the cache hit rate should recover to baseline (> 80%) within 30 min for weather, 2 h for maps (larger key space).

### 5.2 Cache corruption

Cache corruption (wrong value cached under a key) is rare but devastating — every customer hitting the corrupted key sees the wrong response. Recovery:

1. **Identify the corrupted entries** — look for "wrong" responses in customer reports. The `provider` field in the response tells you which provider's cached value is wrong.
2. **Flush the affected namespace**:
   ```bash
   curl -X DELETE "/api/v1/providers/cfg_abc/cache?namespace=geocode:v1"
   ```
3. **Investigate root cause** — typically a bug in the cache key derivation (e.g. forgetting to include `countryCode` in the key) or a normalisation bug (the adapter returned the wrong canonical value, which was cached).
4. **Deploy the fix** — if a code fix is needed, deploy via the standard release process. The cache flush in step 2 prevents stale-corrupted entries from being served after the fix.
5. **Verify** — re-issue the affected requests and confirm correct responses.

### 5.3 Cache rebuild from sync history

For sync-driven categories (procurement, government, restaurants), the `ConnectorCache` table can be rebuilt from `SynchronizationHistory` if the cache is lost entirely (e.g. table corruption, accidental DROP):

1. **Restore the table** — `ConnectorCache` is backed by SQLite; restore from the latest PITR backup.
2. **If PITR is unavailable** — the cache can be rebuilt by replaying sync. For each `ProviderConfiguration`:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/sync -d '{ "mode": "FULL" }'
   ```
   This triggers a full sync; the adapter re-fetches all data and the cache is repopulated as a side effect.
3. **Verify** — confirm `ProviderHealth.cacheHitRate5m` returns to baseline after the rebuild.

---

## 6. Sync Checkpoint Recovery

### 6.1 Checkpoint corruption

The `SynchronizationCheckpoint` (M4 model) and the per-provider `catalogSyncToken` / `orderSyncToken` / `inspectionSyncToken` (M5 fields) can become corrupt:

- The provider issues a new sync token format and rejects the old one (returns 410 Gone or 400).
- A bug in the adapter persists a malformed token.
- A DB restore rolls back the token to a stale value.

Symptoms: the sync job repeatedly fails with `SYNC_TOKEN_INVALID` or `SYNC_TOKEN_EXPIRED`.

Recovery:

1. **Identify the corrupt token** — the sync dashboard (see `CONNECTOR_OPERATIONS.md` §3) shows the failing `SynchronizationHistory` row with `errorMessage = "sync_token_invalid"`.
2. **Reset the token** — clear the per-provider token:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/sync/reset-token -d '{ "resource": "catalog" }'
   ```
   This nulls `ProcurementConnection.catalogSyncToken` (or equivalent).
3. **Trigger a full resync**:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/sync -d '{ "mode": "FULL" }'
   ```
   The adapter starts from scratch, fetches the full catalogue (or full order history), and writes a new sync token.
4. **Verify** — confirm the next `INCREMENTAL` sync succeeds with the new token.

### 6.2 Cursor regression

A cursor regression — the sync token moves backward in time — is a red flag. It usually means:

- The provider's API has a bug (rare but documented for some providers).
- A DB restore rolled back the token.
- A second sync process is running concurrently with an older token.

Recovery:

1. **Stop all sync processes for the affected `configId`** — `POST /api/v1/providers/cfg_abc/pause`.
2. **Identify the cause** — check `SynchronizationHistory` for the regression timestamp; correlate with deploy / restore events.
3. **Reset the cursor** to the latest known-good value:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/sync/reset-token -d '{ "resource": "catalog", "cursor": "<last-good-value>" }'
   ```
4. **Replay forward** — trigger an `INCREMENTAL` sync; the adapter picks up from the reset cursor.
5. **Verify** — confirm the cursor advances monotonically across the next 3 syncs.
6. **Resume** — `POST /api/v1/providers/cfg_abc/resume`.

---

## 7. Webhook DLQ Flood

### 7.1 Diagnosis

A DLQ flood is detected by the `ProviderDLQFlood` alert (`eks_provider_dlq_depth > 1000` for 1 min). Common causes:

- A provider sends a burst of webhooks (e.g. a regulatory notice flood, a Stripe retroactive refund batch).
- The adapter's `handleWebhook` has a bug that fails on a specific payload shape (e.g. a new event type the adapter doesn't handle).
- The webhook signature verification fails (provider rotated their signing key).
- The downstream consumer (matching engine, notifications module) is down and the webhook handler can't enqueue the work.

### 7.2 Recovery procedure

1. **Pause the webhook endpoint** — stop the bleeding:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/webhooks/ep_xyz/pause
   ```
   This stops accepting new deliveries; the provider's retries buffer at their end (most providers retry for 24-72 h).
2. **Diagnose the cause** — pull the last 10 `DEAD_LETTERED` deliveries:
   ```bash
   curl "/api/v1/providers/cfg_abc/dlq?status=DEAD_LETTERED&limit=10"
   ```
   Look at `errorMessage` to identify the pattern.
3. **Fix the underlying issue**:
   - **Adapter bug** — deploy a fix; the DLQ entries will replay successfully after.
   - **Signature verification failure** — rotate the signing secret (`POST /api/v1/providers/cfg_abc/webhooks/ep_xyz/rotate-secret`), update at the provider, then replay.
   - **Downstream consumer down** — restore the consumer first; then replay.
   - **Legitimate flood** (e.g. recall notice) — the DLQ entries are valid; just replay them in batches.
4. **Replay in batches** — do NOT replay all at once:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/dlq/replay-all -d '{ "maxBatch": 100 }'
   ```
   Wait 30 s between batches. Monitor `ProviderHealth.errorRate5m` — if it rises above 5%, slow down.
5. **Resume the endpoint**:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/webhooks/ep_xyz/resume
   ```
6. **Verify** — DLQ depth returns to 0; webhook delivery success rate returns to > 99%.

### 7.3 DLQ overflow (> 10k entries)

If the DLQ has grown beyond 10k entries (sustained flood + delayed diagnosis), batch replay may take hours. Options:

1. **Selective replay** — replay only critical event types (`order.created`, `recall.alert`) and discard the rest:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/dlq/replay-all -d '{ "filter": { "eventType": ["order.created"] }, "maxBatch": 100 }'
   curl -X DELETE "/api/v1/providers/cfg_abc/dlq?status=DEAD_LETTERED&excludeEventTypes=order.created"
   ```
2. **Snapshot + offline replay** — export the DLQ to a file, replay offline via a worker, then truncate the table. This is a last resort.

---

## 8. Circuit Breaker Storm

### 8.1 Diagnosis

A "circuit breaker storm" is when breakers OPEN in cascade across multiple providers, typically because:

- A shared dependency (e.g. the outbound HTTP client, the OAuth token cache) is failing.
- A correlated outage (e.g. AWS us-east-1 region down) takes down multiple providers simultaneously.
- A bug in the breaker logic (e.g. sharing state across configs that should be isolated).

The dashboard shows multiple `circuitState = OPEN` rows across providers that shouldn't be correlated.

### 8.2 Recovery

1. **Identify the shared dependency** — if all Google-family providers (Maps, Calendar) are OPEN simultaneously, suspect the OAuth token cache or the outbound HTTP client.
2. **Fix the dependency**:
   - **OAuth token cache** — flush `oauth:tokens` namespace; the next `authenticate` call re-fetches tokens.
     ```bash
     curl -X DELETE "/api/v1/providers/cfg_abc/cache?namespace=oauth:tokens"
     ```
   - **Outbound HTTP client** — restart the runtime worker (`POST /api/v1/integrations/runtime/restart`).
3. **Reset breakers individually** — do NOT bulk-reset; verify each provider's underlying health first:
   ```bash
   # For each OPEN provider:
   curl -X POST /api/v1/providers/cfg_abc/circuit-breaker/reset
   # Confirm healthCheck passes
   curl /api/v1/providers/cfg_abc/health
   ```
4. **Verify** — confirm `circuitState = CLOSED` for all affected providers and that they stay CLOSED for 5 min.

### 8.3 Stuck breakers

A breaker that keeps re-OPENing immediately after reset indicates the provider is still unhealthy. Do not repeatedly reset — each trial request consumes quota. Instead:

1. **Leave the breaker OPEN** — the runtime correctly isolates the provider; this is the desired state.
2. **Investigate the underlying error** — the `lastError` field on `ProviderHealth` shows the failure reason.
3. **Fix the root cause** — only then reset the breaker.

---

## 9. Multi-Region Provider Routing

### 9.1 Region outage

If an AWS region (or a provider's regional endpoint) goes down:

1. The selection engine's region filter (Stage 5 in `PROVIDER_SELECTION.md` §3) detects no regional providers are available.
2. For categories with `preferRegion: true` and `fallbackChain: true` (maps, weather, communications, notifications), the engine relaxes to `GLOBAL` providers.
3. For categories with `region-exact` strategy (government), no relaxation — the call returns `NO_PROVIDER_AVAILABLE_FOR_REGION`. Business surfaces degrade gracefully (see `GOVERNMENT_INTEGRATION.md` §11).

### 9.2 Cross-region failover

For tenants operating in multiple regions, the selection engine's region-weight overrides (`ProviderConfiguration.config.regionWeights`) determine failover priority. If a region's primary providers are all down:

```bash
# Deweight the failed region's providers
curl -X PATCH /api/v1/providers/cfg_google_maps -d '{
  "config": { "regionWeights": { "GH": 0, "GLOBAL": 100 } }
}'
```

This routes Ghana-region traffic to Google's global endpoint (higher latency, but available).

### 9.3 Eks-Food's own region outage

If Eks-Food's own AWS region is down (not the provider's), the platform fails over to the standby region (documented in `docs/DEPLOYMENT_GUIDE.md`). The connector ecosystem handles this transparently:

- The `ConnectorCache` table is replicated to the standby region (multi-AZ write-through).
- The `ProviderHealth` rollups re-converge within 60 s of failover.
- The `ConnectorRunner`'s in-memory circuit breakers are lost on failover (they're process-local state). The first few calls after failover may hit an unhealthy provider before the breaker re-OPENS. This is acceptable — the breaker re-converges within seconds.

---

## 10. Provider Schema Change (Breaking)

### 10.1 Diagnosis

Providers occasionally ship breaking API changes (despite versioning). Symptoms:

- The adapter's `normalize` function starts throwing Zod parse errors on responses that previously parsed.
- `ProviderHealth.errorRate5m` spikes.
- The DLQ fills with `normalize_failed` entries.

### 10.2 Recovery

1. **Pause the affected provider**:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/pause
   ```
2. **Capture a sample of the new response shape** — pull a raw response from `ConnectorExecution` (the `response` column stores the last 2 KB).
3. **Update the adapter's `normalize` function** to handle the new shape. Bump the canonical `schemaVersion` if the new shape requires new fields.
4. **Add fixture tests** for the new shape (`__fixtures__/<provider>/<capability>-v2.json`).
5. **Deploy the fix**.
6. **Resume the provider**:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/resume
   ```
7. **Replay the DLQ** — entries that failed normalisation should now succeed.

### 10.3 Prevention

The adapter's `normalize` function should be **defensive**: optional fields should default, unknown fields should be ignored (or stored in `providerMetadata`), and the canonical Zod schema should accept reasonable variations. Defensive normalisation is the difference between "the provider added a new optional field, we don't care" and "the provider added a new optional field, our sync broke".

The fixture-test harness (see `PROVIDER_DEVELOPMENT.md` §11) catches most schema changes before they hit production — the quarterly rescore job runs against the fixtures and fails if the response shape has drifted.

---

## 11. Normalisation Regression (Adapter Bug)

### 11.1 Diagnosis

An adapter bug — a regression in `normalize` that produces malformed canonical values — is detected by:

- The selection engine's `canonical.parse(adapter.normalize(...))` step throws.
- `ProviderHealth.errorRate5m` spikes for one provider.
- The DLQ fills with `schema_validation_failed` entries.

### 11.2 Recovery

1. **Roll back the adapter** — if the bug was introduced in a recent deploy, roll back:
   ```bash
   curl -X POST /api/v1/providers/cfg_abc/rollback -d '{ "version": "<previous-version>" }'
   ```
2. **Diagnose** — pull the malformed canonical value from the engine's decision log (`/api/v1/providers/decisions?status=normalize_failed`).
3. **Fix** — update the adapter's `normalize` function. Add a fixture test that reproduces the bug.
4. **Deploy the fix**.
5. **Replay the DLQ**.

### 11.3 Prevention

Every adapter PR must include fixture tests for the changed normalisation. The CI gate enforces this: a PR that touches `normalize` without touching `__tests__/` is blocked.

The quarterly rescore job (see `PROVIDER_SELECTION.md` §8.4) also serves as a regression check — if a provider's `qualityScore` drops > 10 points quarter-over-quarter, it's investigated as a possible normalisation regression.

---

## 12. Selection Engine Runaway

### 12.1 Diagnosis

A "runaway" selection engine picks the wrong provider repeatedly. Symptoms:

- A high-cost provider gets 90% of traffic when it should get 30%.
- A low-quality provider wins despite higher-quality alternatives being available.
- The decision log shows `excludedReason: "region_quality_below_threshold"` for providers that should be eligible.

### 12.2 Recovery

1. **Inspect the decision log** — `GET /api/v1/providers/decisions?organizationId=...&category=...&from=...&to=...`. Look at the `score` and `excludedReason` for each candidate.
2. **Check `ProviderConfiguration.weight` overrides** — a misconfigured weight (e.g. 100 for the wrong provider) is the most common cause.
3. **Check `ProviderCapability.qualityScore` overrides** — a misconfigured quality score (e.g. 100 for a low-quality provider) is the second most common.
4. **Check `ProviderRegion.qualityScore`** — a stale regional score can drop a provider that should be eligible.
5. **Fix the misconfiguration**:
   ```bash
   curl -X PATCH /api/v1/providers/cfg_abc -d '{ "weight": 50 }'
   curl -X PATCH /api/v1/providers/cfg_abc/capabilities -d '{ "capability": "geocode", "qualityScore": 85 }'
   ```
6. **Verify** — confirm the next 100 decisions route correctly.

---

## 13. Cross-Tenant Data Leak

### 13.1 Diagnosis

A cross-tenant data leak — tenant A's request returns tenant B's data — is the most severe failure mode (Sev-1). It's typically caused by:

- A cache key that doesn't include `organizationId` (cache pollution).
- A selection engine that doesn't filter by `organizationId` (candidate loading bug).
- An adapter that shares state across tenants (e.g. a singleton HTTP client with a shared cookie jar).

### 13.2 Recovery

1. **Pause all connectors immediately**:
   ```bash
   curl -X POST /api/v1/providers/dashboard/pause-all
   ```
2. **Identify the leak vector** — pull the affected requests from the decision log; correlate with the cache / candidate-loading / adapter state.
3. **Fix the bug** — this is a code fix; deploy immediately.
4. **Flush all caches**:
   ```bash
   curl -X DELETE /api/v1/providers/dashboard/flush-all-caches
   ```
5. **Audit the leak window** — pull `ConnectorExecution` rows for the affected `configId`s in the leak window. Identify which tenants' data was exposed to which other tenants.
6. **Notify affected tenants** — Sev-1 comms; legal involvement.
7. **Resume connectors** — only after the fix is deployed and caches are flushed:
   ```bash
   curl -X POST /api/v1/providers/dashboard/resume-all
   ```

### 13.3 Prevention

- The cache key derivation function (`cacheGet` in `src/packages/connectors/cache.ts`) always includes `organizationId` and `configId`. CI enforces this via a unit test that asserts the key contains both.
- The selection engine's candidate loader always filters by `organizationId`. CI enforces this via an integration test that asserts a cross-tenant query returns 0 candidates.
- Adapters are stateless (no singletons). The M4 `ConnectorRuntime` creates a fresh `ConnectorContext` per invocation.

---

## 14. Government Authority Outage (No Fallback)

For the `government` category, the `region-exact` strategy means there is no cross-region fallback. If a country's authority (e.g. Ghana FDA) is down, the verification workflow returns "unknown" (see `GOVERNMENT_INTEGRATION.md` §11) and the cook is flagged for manual review.

Recovery options:

1. **Wait it out** — government authority outages are typically 1-4 hours. The graceful-degradation path (manual review) is acceptable for short outages.
2. **Switch to manual verification** — for high-priority cooks (e.g. a popular caterer with an active contract), the operations team can manually verify the license by calling the authority directly. The manual verification is recorded on the `VerificationRequest` model.
3. **Status-page + comms** — if the outage exceeds 4 hours, post a status-page update. Notify affected cooks that compliance verification is delayed.

There is **no automatic recovery** for a government authority outage — the connector will resume normal operation when the authority's API recovers.

---

## 15. DR Drills

### 15.1 Quarterly drills

Every quarter, the on-call team runs a DR drill covering:

1. **Provider outage simulation** — pause a primary provider in staging; verify automatic failover; verify the dashboard surfaces it.
2. **Credential rotation** — rotate a staging credential; verify hot-swap; verify rollback on failure.
3. **Cache rebuild** — flush a staging cache; verify prefetch warms it within 30 min.
4. **DLQ replay** — inject 100 synthetic webhook deliveries into staging DLQ; verify batch replay.
5. **Circuit breaker reset** — force-OPEN a staging breaker; verify reset; verify re-OPEN on persistent failure.

The drill is documented in `/docs/drills/<YYYY-MM-DD>-connector-drill.md` and the results feed the next quarter's improvements.

### 15.2 Annual drills

Once a year, the team runs a full Sev-1 drill:

1. **Master-key rotation** — rotate the staging tenant master key; verify all credentials re-encrypt.
2. **Region failover** — fail over staging to the standby region; verify the connector ecosystem re-converges.
3. **Cross-tenant leak response** — simulate a cache-pollution bug in staging; verify the pause-all / flush-all / audit / resume-all flow.

The annual drill is a multi-hour exercise involving the on-call team, the incident commander, and the comms team.

---

## 16. Recovery Verification Checklist

After any recovery procedure, verify:

- [ ] `ProviderHealth.status = HEALTHY` for all previously-affected providers.
- [ ] `ProviderHealth.circuitState = CLOSED` for all previously-OPEN breakers.
- [ ] `ProviderHealth.errorRate5m < 0.01` (1%).
- [ ] `ProviderHealth.syncLagSec < 300` for sync-driven categories.
- [ ] `ProviderHealth.cacheHitRate5m > 0.80` for cache-heavy categories (maps, weather).
- [ ] `ProviderHealth.callsLastDay` is within the post-recovery expected range (not burning 2x to recover).
- [ ] DLQ depth is 0 (or decreasing).
- [ ] The decision log shows correct provider selection for the last 100 calls.
- [ ] The status page is updated (if customer-visible).
- [ ] A post-mortem is scheduled within 48 h.

---

## 17. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Force-resetting breakers in a storm | Quota burn on trial requests; cascade continues | Investigate the shared dependency first; reset only after root cause is fixed |
| Bulk-replaying the DLQ all at once | Provider 429s; DLQ refills faster than it drains | Use `maxBatch = 100`; pause 30 s between batches |
| Restoring the cache from a corrupt backup | Corruption returns | Restore from PITR to a point before the corruption; verify with a sample of known-good keys |
| Treating "unknown" verification as a Sev-1 | On-call pages for every transient authority hiccup | "unknown" is the expected graceful-degradation state; only page if it persists > 4 h |
| Initiating payment from the merchant connector during DR | PCI violation; refund flow broken | Always use the M1 `PaymentProvider`; the merchant connector only tracks invoice state |
| Skipping the post-mortem | Same incident recurs in 3 months | Post-mortem is mandatory for Sev-1 and Sev-2; scheduled within 48 h |
| Drilling only the easy scenarios | Team is unprepared for Sev-1 | Annual drill must include master-key rotation and region failover |

---

## 18. Further Reading

- `CONNECTOR_OPERATIONS.md` — the day-to-day ops surface (health monitoring, DLQ, circuit breakers).
- `PROVIDER_SELECTION.md` — the failover model (when does the engine fall back, when does it give up).
- `PROVIDER_DEVELOPMENT.md` — the adapter contract (why defensive normalisation prevents most schema-change incidents).
- `docs/integration/DISASTER_RECOVERY.md` — the M4 universal-connector DR (underlying runtime, secrets, region failover).
- `docs/integration/AUTHENTICATION_GUIDE.md` — the credential + master-key rotation procedures.
- `docs/integration/WEBHOOK_GUIDE.md` — the M4 webhook DLQ (underlying mechanics).
- `docs/identity/DISASTER_RECOVERY.md` — the M2 IAM DR (sessions, audit, MFA) — relevant for OAuth revocation scenarios.
- `docs/DEPLOYMENT_GUIDE.md` — the platform-level DR (region failover, PITR).
