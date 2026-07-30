# Eks-Food Connector Platform — Operations Runbook

> **Audience:** On-call integration maintainers, SREs, support engineers. Read alongside `ARCHITECTURE.md` (the platform overview), `SYNCHRONIZATION_GUIDE.md` (sync engine internals), `WEBHOOK_GUIDE.md` (webhook delivery), `AUTHENTICATION_GUIDE.md` (credential handling), `DISASTER_RECOVERY.md` (failure-mode recovery), and the M1 `docs/OPERATIONS_RUNBOOK.md` (platform-level runbooks).
>
> **Status:** M4. This runbook covers the operational aspects of the Universal Connector Platform: reading the health dashboard, diagnosing common alert scenarios, executing operational runbooks (force sync, replay webhooks, rotate credentials), and the incident severity matrix.

---

## 1. Health Dashboard

The health dashboard is at `/api/v1/integrations/health/dashboard` (rendered in the Integration Console at `/integrations/health`). It shows, per connector and aggregate:

### 1.1 The `ConnectorHealth` model

```prisma
model ConnectorHealth {
  id              String   @id @default(cuid())
  configId        String   // → ConnectorConfiguration.id (unique)
  organizationId  String   // tenant scope
  // The current health rollup
  healthy         Boolean  @default(true)
  // The last error message (null if healthy)
  lastError       String?
  // Sync metrics
  lastSyncAt      DateTime?
  lastSyncDurationMs Int?
  lastSyncRecords Int?
  syncLagSeconds  Int      @default(0)  // now() - lastSyncAt (estimated)
  // Latency rollups (5m windows)
  p50SyncDurationMs Int?
  p99SyncDurationMs Int?
  // Webhook metrics
  lastWebhookAt   DateTime?
  webhookDeliveryFailures5m Int @default(0)
  webhookDlqCount Int      @default(0)
  // Poll metrics
  lastPollAt      DateTime?
  pollFailureRate5m Float  @default(0)
  // Error rate (fraction of ConnectorExecution rows in the last 5m that are FAILED)
  errorRate5m     Float    @default(0)
  // Updated by the health job every 60s
  updatedAt       DateTime @updatedAt

  @@unique([configId])
  @@index([organizationId, healthy])
  @@index([healthy, syncLagSeconds])
}
```

### 1.2 Dashboard layout

The dashboard has four quadrants:

| Quadrant | What it shows | Sort by |
|---|---|---|
| Top-left: **Unhealthy connectors** | `healthy=false`, sorted by `lastError` | Most recent error first |
| Top-right: **Sync lag** | `syncLagSeconds > 300`, sorted by lag | Largest lag first |
| Bottom-left: **Webhook delivery failures** | `webhookDeliveryFailures5m > 10`, sorted by failure count | Most failures first |
| Bottom-right: **Error rate** | `errorRate5m > 0.1`, sorted by rate | Highest rate first |

Each row in a quadrant is a single `ConnectorConfiguration`; clicking it opens the connector detail page (with executions, jobs, deliveries, health history).

### 1.3 Reading the dashboard

The dashboard refreshes every 30s. The four quadrants correspond to four alert conditions (see §3); each has its own runbook. The key signals to watch:

- **Unhealthy connectors** — These are surfaced to the tenant via the Integration Console; the on-call is paged only if the count exceeds `EKS_INTEGRATION_UNHEALTHY_PAGE_THRESHOLD` (default 10).
- **Sync lag** — A connector with `syncLagSeconds > 600` (10 min) is "stale"; >3600 (1h) is "very stale". The on-call is paged at >3600 for high-priority connectors (priority ≤ 3).
- **Webhook delivery failures** — A spike (>10 in 5m for one connector, or >50 across all connectors) indicates either an upstream issue or a bug in `handleWebhook()`.
- **Error rate** — An `errorRate5m > 0.5` means more than half of recent executions failed; the connector is effectively down.

---

## 2. Common Alert Scenarios

### 2.1 Connector sync lag

**Alert**: `ConnectorSyncLagHigh` — `syncLagSeconds > 600` for connector `acme-pos` in org `org_eks`.

**Diagnosis**:
1. Open the connector detail page (`/api/v1/integrations/connectors/cfg_...`).
2. Check `lastSyncAt` and `lastError`.
3. If `lastError` is non-null, the previous sync failed — go to the `ConnectorExecution` rows for the last hour (`GET /api/v1/integrations/connectors/:id/executions?status=FAILED&from=...`).
4. If `lastError` is null but `lastSyncAt` is old, the schedule may be stalled — check the `ConnectorSchedule` row.
5. Check the worker queue depth (`/api/v1/integrations/health/queue-depth`). If >1000, the platform is under backpressure and the connector may be deferred.

**Mitigations**:
- If the schedule is stalled: `POST /api/v1/integrations/connectors/:id/sync` to force a sync.
- If the upstream is rate-limiting (429): increase the `RateLimitPolicy.requestsPerSecond` if possible, or reduce the schedule cadence.
- If the connector is in `ERROR` state: see §2.5.
- If the queue is backpressured: scale out workers (`EKS_INTEGRATION_WORKER_REPLICAS += 2`).

### 2.2 Webhook delivery failure spike

**Alert**: `WebhookDeliveryFailuresHigh` — `webhookDeliveryFailures5m > 50` across all connectors.

**Diagnosis**:
1. Open the webhook deliveries page (`/api/v1/integrations/webhooks/deliveries?status=FAILED&from=...`).
2. Group by `endpointId` to identify the worst offenders.
3. For each, check the `errorMessage`:
   - `http_5xx` — the upstream is unavailable; check the upstream status page.
   - `http_4xx` (non-429) — the request is malformed; check the signature config and payload.
   - `timeout` — the upstream is slow; check `EKS_INTEGRATION_WEBHOOK_TIMEOUT_MS` (default 10s).
   - `invalid_signature` — the secret may have been rotated on one side but not the other.
4. If the failures are concentrated on one connector, the issue is connector-specific. If spread across many, it's a platform issue (egress proxy, DNS, TLS).

**Mitigations**:
- If the upstream is down: pause the `WebhookEndpoint` (`PATCH .../endpoints/:id { status: "PAUSED" }`) to stop the retry storm; resume when the upstream recovers.
- If the signature is wrong: rotate the secret on both sides (see §4.3).
- If the platform is the issue: check the egress proxy logs, DNS resolution, TLS handshake times.
- For DLQ'd webhooks: see §4.2.

### 2.3 Rate-limit 429 surge

**Alert**: `ConnectorRateLimitSurge` — more than 100 `429` responses in 5 minutes across all connectors.

**Diagnosis**:
1. Identify the connectors hitting 429s (`GET /api/v1/integrations/connectors/:id/executions?errorMessage=http_429`).
2. For each, check the upstream's rate-limit documentation:
   - Is the connector's `RateLimitPolicy` within the upstream's allowance?
   - Has the upstream reduced the allowance (e.g. a plan downgrade)?
   - Are multiple connectors sharing the same upstream account (and thus the same rate limit)?
3. Check the `Retry-After` headers being honoured.

**Mitigations**:
- Reduce the `RateLimitPolicy.requestsPerSecond` for the affected connectors.
- If multiple connectors share an account, stagger their schedules (e.g. one at minute 0, another at minute 2).
- If the upstream offers a higher tier, upgrade (this is a tenant billing decision).
- If the surge is from a single burst (e.g. a backfill sync), reduce the `batchSize` and increase the inter-batch delay.

### 2.4 Credential expiry

**Alert**: `ConnectorCredentialExpiringSoon` — a `ConnectorCredential` with `expiresAt` within 7 days.

**Diagnosis**:
1. Open the credential detail (`/api/v1/integrations/connectors/:id/credentials`).
2. Check `expiresAt` and the credential type:
   - **OAuth2 access token** — should auto-refresh; if not, the refresh token may have expired (re-authorise).
   - **mTLS client certificate** — needs manual rotation (the upstream CA issues a new cert).
   - **JWT bearer private key** — needs manual rotation (generate a new key pair, register the public key with the upstream).
   - **Static API key** — needs manual rotation (issue a new key on the upstream dashboard).

**Mitigations**:
- For auto-refreshing tokens: see §2.5 if the refresh is failing.
- For manual credentials: rotate via `POST /api/v1/integrations/connectors/:id/credentials/:cid/rotate` (see §4.3).
- For shared secrets: rotate the `SecretReference` via `POST /api/v1/integrations/secrets/:id/rotate` (propagates to every connector using it).

### 2.5 Schema mismatch

**Alert**: `ConnectorSchemaMismatch` — `CONN_SCHEMA_MISMATCH` errors exceeding 10% of records in a sync.

**Diagnosis**:
1. Open the `SynchronizationJob` detail (`/api/v1/integrations/jobs/:jobId`).
2. Look at the `errors` field — it lists the failed records and the validation errors.
3. Identify the failing field(s):
   - **Missing required field** — the upstream changed the schema (e.g. removed a field, or made it conditional).
   - **Type mismatch** — the upstream changed the type (e.g. string → object).
   - **Enum value not allowed** — the upstream added a new enum value not in the target schema.
4. Check the `SchemaVersion` history for both source and target schemas:
   - Did the source schema publish a new version?
   - Did the target schema publish a new version that the connector hasn't picked up?

**Mitigations**:
- If the source schema changed: update the `MappingTemplate` to handle the new shape, or pin to the old source schema version.
- If the target schema changed: update the `MappingTemplate.rules` to produce the new shape.
- If the upstream added a new enum value: add the value to the target `SchemaVersion` (if appropriate) or filter it out in a `CONDITIONAL` rule.
- If the issue is widespread: deprecate the broken schema version (`POST /api/v1/integrations/schemas/:name/versions/:v/deprecate`) and pin affected connectors to the previous version.

---

## 3. Operational Runbooks

### 3.1 Runbook: Force a connector sync

**Use case**: A connector's schedule is stalled, the operator needs to trigger a sync immediately, or the operator wants to verify a config change took effect.

**Steps**:
1. Verify the connector is `ACTIVE` (`GET /api/v1/integrations/connectors/:id` — `status` should be `ACTIVE`).
2. Verify no in-flight sync (`GET /api/v1/integrations/connectors/:id/jobs?status=RUNNING` — should be empty).
3. Trigger the sync:
   ```
   POST /api/v1/integrations/connectors/:id/sync
   { "mode": "incremental" }
   ```
   (Use `mode: "full"` only for recovery — see `SYNCHRONIZATION_GUIDE.md` §1.1.)
4. The response is `202 Accepted` with the `SynchronizationJob` id.
5. Poll the job status (`GET /api/v1/integrations/jobs/:jobId`) until `status` is `SUCCEEDED` or `FAILED`.
6. If `SUCCEEDED`, verify the connector's `lastSyncAt` updated (`GET /api/v1/integrations/connectors/:id` — `lastSyncAt` should be recent).
7. If `FAILED`, inspect `errorMessage` and the `errors` array; follow the diagnosis steps in §2.

**Estimated time**: 2–10 minutes (depending on the dataset size).

### 3.2 Runbook: Replay failed webhooks

**Use case**: Webhooks have landed in the DLQ and the operator wants to re-process them (e.g. after a bug fix in `handleWebhook()`).

**Steps**:
1. List the DLQ'd deliveries for the connector:
   ```
   GET /api/v1/integrations/webhooks/dlq?connectorConfigId=cfg_...&limit=100
   ```
2. For each delivery, inspect the `errorMessage` and `request.body` to confirm the issue is resolved.
3. Replay individual deliveries:
   ```
   POST /api/v1/integrations/webhooks/deliveries/:id/replay
   ```
   Or bulk replay (admin only, max 100 at a time):
   ```
   POST /api/v1/integrations/webhooks/dlq/replay-all
   { "endpointId": "ep_...", "from": "2025-01-15T00:00:00Z", "to": "2025-01-15T10:00:00Z" }
   ```
4. Poll the deliveries (`GET /api/v1/integrations/webhooks/deliveries/:id`) until `status` is `DELIVERED` or `DLQ` again.
5. If deliveries re-DLQ, the bug fix didn't work — re-open the incident.

**Important**: Replay is **idempotent** — the `eventId` is preserved, so if a delivery was already processed (e.g. via a successful sync that picked up the same record), the replay is a no-op. Do not be alarmed if the `totalDelivered` counter does not increase on replay.

**Estimated time**: 1 minute per delivery (single) or 5 minutes per 100 (bulk).

### 3.3 Runbook: Rotate credentials

**Use case**: A credential is expiring, compromised, or the operator wants to refresh it proactively.

**Steps**:
1. Identify the credential to rotate:
   ```
   GET /api/v1/integrations/connectors/:id/credentials
   ```
2. Issue a new credential on the upstream (e.g. generate a new API key on Acme's dashboard, or run the OAuth re-authorisation flow).
3. Rotate the credential on Eks-Food:
   ```
   POST /api/v1/integrations/connectors/:id/credentials/:cid/rotate
   { "value": "<new-plaintext-value>" }
   ```
4. The route:
   - Encrypts the new value with the current `keyVersion`.
   - Creates a new `ConnectorCredential` row (`active=true`).
   - Marks the old row `active=false`.
   - Invokes `authenticate()` to validate the new credential. **If validation fails, the rotation is rolled back** (the new row is deleted, the old row is re-activated, and the API returns `409 Conflict` with `{"error":"authentication_failed"}`).
5. On success, the runtime clears the auth-context cache (`auth:{credentialId}`) so the next invocation uses the new credential.
6. Verify the connector's next sync succeeds (`GET /api/v1/integrations/connectors/:id/health` — `lastSyncAt` should update within one schedule cycle).

**For shared secrets** (`SecretReference`):
1. `POST /api/v1/integrations/secrets/:id/rotate { "value": "<new-value>" }`.
2. The rotation propagates to every `ConnectorCredential` that references the secret.
3. Each affected connector's `authenticate()` is invoked; any failures are reported per-connector.

**Estimated time**: 1 minute (single credential) to 10 minutes (shared secret across many connectors).

### 3.4 Runbook: Pause and resume a connector

**Use case**: A connector is misbehaving (e.g. producing bad data) and the operator wants to stop it without removing the configuration.

**Steps**:
1. Deactivate the connector:
   ```
   POST /api/v1/integrations/connectors/:id/deactivate
   ```
2. The runtime:
   - Transitions `ConnectorConfiguration.status` to `DEACTIVATED`.
   - Cancels all pending `ConnectorSchedule` rows.
   - Pauses all `WebhookEndpoint` rows (inbound webhooks return `200 OK` with `{"status":"paused"}`; no `handleWebhook()` invocation).
   - Allows in-flight `SynchronizationJob`s to complete (does not cancel them).
3. To resume:
   ```
   POST /api/v1/integrations/connectors/:id/activate
   ```
4. The runtime re-validates the credentials (`authenticate()`) and transitions back to `ACTIVE`.

**Estimated time**: <30 seconds.

### 3.5 Runbook: Roll back a schema version

**Use case**: A schema version was published that breaks validation for many connectors.

**Steps**:
1. Identify the broken version:
   ```
   GET /api/v1/integrations/schemas/:name/versions
   ```
2. Retire the broken version:
   ```
   POST /api/v1/integrations/schemas/:name/versions/:v/retire
   { "reason": "Validation regex incorrect; rolling back to previous", "retiredBy": "user_..." }
   ```
3. The registry:
   - Transitions `SchemaVersion.status` to `RETIRED`.
   - Updates `SchemaDefinition.latestVersion` to the previous non-retired version.
   - Emits `Schema.Retired` to the `EventOutbox`.
4. Affected connectors using `versionRange: "^<broken>"` automatically re-resolve to the previous version on their next sync (within 24h, or immediately on connector restart).
5. For connectors pinned to the broken version (`version: "<broken>"` exact), manual intervention is required — update the `MappingTemplate` to a working `versionRange`.

**Estimated time**: 5 minutes (registry update) + up to 24h (auto-re-resolution).

### 3.6 Runbook: Roll back a sync to a checkpoint

**Use case**: A sync applied bad data (e.g. a mapping bug) and the operator wants to undo the changes.

**Steps**:
1. Identify the `SynchronizationJob` to roll back (`GET /api/v1/integrations/connectors/:id/jobs?status=SUCCEEDED&from=...`).
2. List the checkpoints:
   ```
   GET /api/v1/integrations/jobs/:jobId/checkpoints
   ```
3. Choose the checkpoint to roll back to (typically the one before the bad batch — inspect `payloadHash` and `recordsProcessed`).
4. Trigger the rollback:
   ```
   POST /api/v1/integrations/jobs/:jobId/rollback
   { "toCheckpointSequence": 3 }
   ```
5. The runtime:
   - Transitions the job to `ROLLING_BACK`.
   - For each event emitted by the job after `sequence=3`, emits a compensating event.
   - The M3 `@eks/domain` handlers apply the compensating events.
   - Updates `ConnectorConfiguration.syncState.cursor` to the checkpoint's `cursor`.
   - Transitions the job to `SUCCEEDED` with `errorMessage="rolled_back_to_sequence_3"`.
6. Verify the aggregates are in the expected state (query the domain via the M3 `@eks/api` routes).

**Important**: Rollback is **best-effort** (see `SYNCHRONIZATION_GUIDE.md` §8). If a downstream system consumed the events and acted on them (e.g. an SMS was sent), the rollback cannot undo the SMS. Document the rollback in the incident report.

**Estimated time**: 1–10 minutes (depending on the number of events to compensate).

---

## 4. Incident Severity Matrix

| Severity | Definition | On-call response | Customer comms |
|---|---|---|---|
| **Sev-1** | Total platform outage: no connectors can sync; all webhooks failing; data corruption | Page primary + secondary on-call; declare incident; 15-min updates | Status page update within 15 min; direct comms to affected tenants |
| **Sev-2** | Major degradation: >50% of connectors failing; specific connector type down; sync lag >1h for high-priority connectors | Page primary on-call; 30-min updates | Status page update within 30 min |
| **Sev-3** | Minor degradation: individual connector failures; sync lag >10min; webhook DLQ growing | On-call acknowledges within 1h during business hours; 2h updates | No status page update unless tenant reports |
| **Sev-4** | Cosmetic / non-urgent: documentation typos; minor UI bugs; performance optimisations | Next business day | No comms |

### 4.1 Sev-1 examples

- The `@eks/integration/runtime` is crash-looping; no syncs can run.
- The database is unavailable; no `ConnectorExecution` rows can be written.
- A platform-wide schema validation bug causes every sync to fail.
- A master-key compromise requires immediate rotation of every `ConnectorCredential`.

### 4.2 Sev-2 examples

- A specific connector archetype (e.g. all `webhook-inbound` connectors) is failing.
- The Acme POS upstream is down and Acme connectors across all tenants are failing.
- Sync lag for high-priority connectors (Payswap, Stripe) exceeds 1h.
- The webhook DLQ is growing >1000 deliveries/hour.

### 4.3 Sev-3 examples

- A single tenant's connector is in `ERROR` state.
- A scheduled sync missed its cadence (e.g. ran at 10:05 instead of 10:00).
- A webhook delivery failed and was retried successfully.
- A schema deprecation notice was sent to a connector author.

### 4.4 Sev-4 examples

- The Integration Console dashboard loads slowly (>2s).
- A `MappingTemplate` description has a typo.
- The health dashboard's chart labels are misaligned.
- A connector's manifest `description` could be improved.

---

## 5. On-Call Checklist

When paged, the on-call should:

1. **Acknowledge** the page within the SLA (5 min for Sev-1, 15 min for Sev-2, 1h for Sev-3).
2. **Open the incident channel** (`#incident-<id>`) and post the alert summary.
3. **Read the dashboard** to identify the scope (one connector, one tenant, or platform-wide).
4. **Check the recent deploys** (`git log --since="2 hours ago" -- src/packages/integration/`) — many incidents are deploy-triggered.
5. **Identify the runbook** (this document) and follow it.
6. **Communicate** progress every 30 min (Sev-2) or 15 min (Sev-1) in the incident channel.
7. **Resolve or escalate** — if the runbook doesn't resolve the issue, escalate to the platform team (Sev-1) or wait for business hours (Sev-3).
8. **Post-incident** — within 24h, file a postmortem (template in `docs/identity/AUDIT_AND_COMPLIANCE.md` §7) covering: timeline, root cause, mitigation, prevention.

---

## 6. Operational Metrics

The platform exposes the following metrics (via `/api/v1/metrics` in Prometheus format):

| Metric | Type | Labels | Description |
|---|---|---|---|
| `connector_executions_total` | counter | `connector_code`, `kind`, `status` | Total invocations |
| `connector_exec_duration_ms` | histogram | `connector_code`, `kind` | Invocation duration |
| `connector_sync_lag_seconds` | gauge | `connector_code`, `organization_id` | Estimated sync lag |
| `connector_health` | gauge (0/1) | `connector_code`, `organization_id` | 1 if healthy, 0 if not |
| `connector_error_rate_5m` | gauge | `connector_code`, `organization_id` | Fraction of failed executions |
| `webhook_deliveries_total` | counter | `endpoint_id`, `direction`, `status` | Total deliveries |
| `webhook_delivery_duration_ms` | histogram | `endpoint_id`, `direction` | Delivery duration |
| `webhook_dlq_depth` | gauge | `endpoint_id` | DLQ depth |
| `integration_queue_depth` | gauge | `queue` (`sync`, `webhook`, `poll`) | Worker queue depth |
| `integration_worker_pool_size` | gauge | `node` | Current worker pool size |
| `integration_credential_rotations_total` | counter | `connector_code` | Total rotations |
| `schema_versions_published_total` | counter | `schema_name`, `compatibility` | Total publishes |

Set up alerts (in Prometheus / Alertmanager) on:
- `connector_sync_lag_seconds > 600` for >5 min → `ConnectorSyncLagHigh`
- `webhook_delivery_failures_total{status="FAILED"}` rate > 10/min → `WebhookDeliveryFailuresHigh`
- `connector_error_rate_5m > 0.5` for >5 min → `ConnectorErrorRateHigh`
- `integration_queue_depth{queue="sync"} > 10000` for >5 min → `IntegrationQueueBackpressure`
- `integration_worker_pool_size < 2` → `IntegrationWorkerPoolExhausted`

---

## 7. Common Operational Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Force-syncing a connector that's already running | `409 Conflict` | Wait for the in-flight sync to complete; or cancel it first (`POST /api/v1/integrations/jobs/:jobId/cancel`) |
| Replaying a webhook that has side effects | Side effects fire twice | Check the `dedupeKey` — duplicates are silently dropped at the outbox |
| Rotating a credential without updating the upstream | Auth fails; connector goes to ERROR | Always issue the new credential on the upstream FIRST, then rotate on Eks-Food |
| Retiring a schema version that's pinned by an active connector | Connector fails at sync time | Before retiring, check `GET /api/v1/integrations/mappings?sourceSchema=...` for templates that pin it |
| Pausing a connector during an in-flight sync | The sync completes anyway (deactivate does not cancel in-flight jobs) | Wait for the in-flight sync to complete, or cancel it explicitly |
| Scaling workers without scaling the database | DB connection pool exhausted | Increase `EKS_DB_MAX_CONNECTIONS` proportionally to worker count (10 connections per worker) |
| Ignoring the dashboard during a deploy | Deployed bug goes unnoticed for hours | Watch the dashboard for 30 min after every deploy; rollback if metrics degrade |
| Using `mode: "full"` for routine syncs | Upstream rate-limits; sync never completes | Use `mode: "incremental"` for routine syncs; reserve `full` for recovery |

When in doubt, the safest action is to **pause** the affected connector (§3.4) and escalate to the platform team. A paused connector does no harm; a misbehaving active connector can corrupt data.
