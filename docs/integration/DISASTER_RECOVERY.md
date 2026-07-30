# Eks-Food Connector Platform — Disaster Recovery

> **Audience:** On-call integration maintainers, DBAs, security incident responders. Read alongside `OPERATIONS_RUNBOOK.md` (operational runbooks), `ARCHITECTURE.md` (the platform overview), `AUTHENTICATION_GUIDE.md` (credential handling), `SYNCHRONIZATION_GUIDE.md` (checkpoints and rollback), `WEBHOOK_GUIDE.md` (DLQ), `SCHEMA_REGISTRY_GUIDE.md` (schema rollback), and the M2 `docs/identity/DISASTER_RECOVERY.md` (IAM DR — this document mirrors its structure for the integration platform).
>
> **Status:** M4. The Connector Platform is a critical-path system: if it is down, no tenant can sync with their external systems (POS, ERP, accounting, payments, food-safety). This document covers the recovery procedures for the seven failure modes that matter most for integration: connector-config loss, sync-checkpoint corruption, webhook DLQ overflow, schema-registry corruption, key compromise, connector outage, and region outage.

---

## 1. Failure-Mode Catalogue

| Failure | Severity | Tenant impact | Recovery time objective |
|---|:---:|---|:---:|
| Connector-config loss (`ConnectorConfiguration` table) | Sev-1 | Affected tenants cannot sync | < 4 h (PITR restore) |
| Sync-checkpoint corruption (`SynchronizationCheckpoint` table) | Sev-2 | Affected connectors re-sync from last good checkpoint | < 30 min (manual cursor reset) |
| Webhook DLQ overflow (>100k deliveries) | Sev-2 | DLQ'd webhooks delayed; backpressure on inbound | < 1 h (bulk replay + scale-out) |
| Schema-registry corruption (broken `SchemaVersion` published) | Sev-2 | Connectors using the broken version fail validation | < 30 min (version retirement) |
| Connector outage (single connector's upstream is down) | Sev-3 | Affected connector's data is stale; other connectors unaffected | < 4 h (failover to backup connector) |
| Connector-credential key compromise | Sev-1 | Affected connectors' credentials are leaked | < 1 h (key rotation + credential rotation) |
| Webhook-secret compromise (HMAC secret leaked) | Sev-1 | Attacker can forge inbound webhooks | < 30 min (secret rotation on both sides) |
| OAuth-credential compromise (refresh token leaked) | Sev-1 | Attacker can impersonate the connector | < 1 h (revoke + re-authorise) |
| Master-key compromise (AES-256-GCM key) | Sev-1 | All `ConnectorCredential` and `SecretReference` values decryptable by attacker | < 4 h (master-key rotation + re-encryption) |
| Database loss (Postgres primary) | Sev-1 | Total platform outage | < 4 h (failover to replica) |
| Outbox relay stall | Sev-2 | Syncs complete but events not delivered to domain handlers | < 30 min (worker restart) |
| Worker pool exhausted | Sev-2 | Syncs queued but not executing | < 15 min (autoscale) |
| Single-AZ outage | Sev-2 | Partial degradation | < 30 min (multi-AZ failover) |
| Region outage | Sev-1 | Full regional outage | < 4 h (cross-region failover) |

---

## 2. Connector-Config Backup & Recovery

### 2.1 Portability of `ConnectorConfiguration`

The `ConnectorConfiguration` row is **portable** across database instances because:
- `encryptedConfig` is a self-describing AES-256-GCM envelope (the `keyVersion` is embedded).
- `syncState` is a JSON column with a stable schema (`{ cursor, lastSyncAt, ... }`).
- `connectorDefId` is a foreign key to `ConnectorDefinition`, which is itself backed up (it's a low-volume table).
- `installationId` is a foreign key to `ExtensionInstallation`, which is part of the M3 developer-platform backup.

The row does **not** include the credentials themselves (those live in `ConnectorCredential`), so restoring a `ConnectorConfiguration` does not require the credentials to be co-located. This is intentional — credentials can be re-issued if necessary, but the sync state (cursor) is irreplaceable.

### 2.2 Database backups

The `ConnectorConfiguration`, `ConnectorCredential`, `ConnectorSchedule`, `ConnectorHealth`, `SynchronizationJob`, `SynchronizationCheckpoint`, `WebhookEndpoint`, `WebhookDelivery`, `PollingJob`, `MappingTemplate`, `TransformationRule`, `SchemaDefinition`, `SchemaVersion`, `RetryPolicy`, `RateLimitPolicy`, `SecretReference`, and `ConnectorExecution` tables are part of the standard Postgres backup:
- **Daily snapshot** to S3 in the tenant's `dataResidencyRegion` (per the M2 `MULTI_TENANCY.md` §9).
- **Continuous WAL archiving** to S3 with a 5-minute RPO (point-in-time recovery to any second within the last 35 days).
- **Weekly full backup** to a separate bucket (object-locked, 7-year retention matching the audit retention).

The high-volume tables (`ConnectorExecution`, `WebhookDelivery`, `PollingJob`, `SynchronizationCheckpoint`) are time-partitioned by `startedAt` / `receivedAt` / `createdAt` (monthly partitions); the backup includes only the last 90 days of partitions (older partitions are archived to S3 Parquet and can be restored on demand).

### 2.3 Recovery procedure — connector-config loss

1. On-call declares Sev-1, opens the incident channel, pages the DBA.
2. DBA launches the PITR restore job: `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier eks-prod --target-db-instance-identifier eks-prod-recovered --restore-time 2025-01-15T10:00:00Z`.
3. While the restore runs (~30–60 min), the on-call:
   - Switches the Caddy edge to a static "Maintenance" page (no syncs possible anyway).
   - Notifies SUPPORT that all connectors are failing.
   - Pauses all `ConnectorSchedule` rows (a bulk `UPDATE ... SET status='PAUSED'`) to prevent a sync storm when the database returns.
4. Once the restored instance is available, DBA promotes it to primary (DNS cutover via `EKS_DB_HOST` env var change + rolling restart of the worker pool).
5. On-call verifies: `curl /api/v1/integrations/health/dashboard` → 200, then trigger one sync on a known connector (`POST /api/v1/integrations/connectors/cfg_smoke_test/sync`).
6. Caddy edge flips back to normal; resume schedules (bulk `UPDATE ... SET status='ACTIVE' WHERE status='PAUSED'`).
7. Post-incident: audit-log gap analysis (any writes between the PITR time and the failure are lost; reconcile from the upstream by forcing full syncs on affected connectors).

---

## 3. Sync-Checkpoint Recovery

### 3.1 Checkpoint corruption

A `SynchronizationCheckpoint` row can be corrupted by:
- A worker crash mid-transaction (rare — the checkpoint write is atomic with the outbox writes).
- A database bug (extremely rare).
- A manual `UPDATE` or `DELETE` by an operator (the most common cause).

Symptom: a `SynchronizationJob` is `RUNNING` but no `SynchronizationCheckpoint` rows exist; or the checkpoint's `cursor` does not match the source's expected cursor format.

### 3.2 Recovery procedure — checkpoint corruption

1. Identify the affected `SynchronizationJob` (`GET /api/v1/integrations/jobs/:jobId`).
2. Cancel the job (`POST /api/v1/integrations/jobs/:jobId/cancel`) — best-effort; the worker may have already exited.
3. Transition the job to `FAILED` manually (admin-only API: `POST /api/v1/integrations/jobs/:jobId/mark-failed { reason: "checkpoint_corruption" }`).
4. Identify the last good checkpoint:
   ```
   GET /api/v1/integrations/jobs/:jobId/checkpoints
   ```
   If no checkpoints exist for this job, use the `ConnectorConfiguration.syncState.cursor` (the cursor before the failed job started).
5. Reset the cursor:
   ```
   PUT /api/v1/integrations/connectors/:id/sync-state
   { "cursor": "<last_good_cursor>" }
   ```
   This is an admin-only operation; it emits `Connector.SyncStateOverwritten` to the `EventOutbox` for audit.
6. Trigger a new sync (`POST /api/v1/integrations/connectors/:id/sync`).
7. Verify the new sync's checkpoints are being written (`GET /api/v1/integrations/jobs/<new_jobId>/checkpoints`).

### 3.3 Cursor format change

When the upstream changes its cursor format (e.g. Acme switches from timestamp cursors to opaque tokens), existing `ConnectorConfiguration.syncState.cursor` values are invalid. The recovery:

1. Force a full sync on the affected connectors (`POST /api/v1/integrations/connectors/:id/sync { mode: "full" }`).
2. The connector's `sync()` ignores the cursor when `mode=full` and starts from zero.
3. The new `endCursor` is in the new format; subsequent incremental syncs use it.
4. The full sync is rate-limited to once per 24h per connector (see `SYNCHRONIZATION_GUIDE.md` §1.1), so stagger the recovery across connectors to avoid upstream rate-limiting.

---

## 4. Webhook DLQ Replay

### 4.1 DLQ overflow

A webhook endpoint's DLQ can grow unbounded if:
- The upstream is sending webhooks faster than the platform can process them.
- The connector's `handleWebhook()` is consistently failing (e.g. a bug).
- The retry policy is too aggressive (`maxAttempts=24, baseDelayMs=10000` → 24 retries over ~6h).

Symptom: `webhook_dlq_depth{endpoint_id=...} > 100000` (alert threshold).

### 4.2 Recovery procedure — DLQ overflow

1. Pause the affected `WebhookEndpoint` (`PATCH /api/v1/integrations/webhooks/endpoints/:id { status: "PAUSED" }`). This stops new deliveries from being queued (inbound webhooks return `200 OK` with `{"status":"paused"}`).
2. Identify the failure cause:
   - Inspect the most recent DLQ'd delivery (`GET /api/v1/integrations/webhooks/dlq?endpointId=...&limit=10`).
   - Read `errorMessage` and `request.body` — is it a connector bug, an upstream issue, or a platform issue?
3. Fix the cause:
   - Connector bug → ship a new connector version (`bunx @eks/dev-cli publish --version 1.4.3`).
   - Upstream issue → wait for the upstream to recover (check their status page).
   - Platform issue → fix the platform; deploy.
4. Bulk replay the DLQ:
   ```
   POST /api/v1/integrations/webhooks/dlq/replay-all
   { "endpointId": "ep_...", "from": "2025-01-15T00:00:00Z", "to": "2025-01-15T10:00:00Z" }
   ```
   This re-queues up to 100 deliveries at a time. The retry worker picks them up on the next poll (every 5s).
5. Monitor the DLQ depth (`webhook_dlq_depth{endpoint_id=...}`) — it should decrease steadily.
6. Resume the endpoint (`PATCH .../endpoints/:id { status: "ACTIVE" }`) when the DLQ depth is below 1000.

### 4.3 DLQ retention

DLQ'd deliveries are retained for 30 days. After 30 days, they are archived to S3 Parquet (queryable via Athena) and deleted from the database. If a tenant needs to replay deliveries older than 30 days, the platform team can restore them from S3 on request (typically 1–2h turnaround).

---

## 5. Schema Rollback

### 5.1 Schema-registry corruption

A broken `SchemaVersion` can be published if:
- The compatibility check has a bug (e.g. fails to detect a type change).
- The schema author declares `compatibility=NONE` and the schema is genuinely broken.
- The JSON Schema document has a typo (e.g. a regex that doesn't match intended values).

Symptom: `Connector.SchemaMismatch` alerts spike across multiple connectors using the schema.

### 5.2 Recovery procedure — schema rollback

1. Identify the broken version:
   ```
   GET /api/v1/integrations/schemas/:name/versions
   ```
   Sort by `publishedAt` descending; the most recent is likely the culprit.
2. Verify by inspecting the schema document (`GET /api/v1/integrations/schemas/:name/versions/:v`).
3. Retire the broken version:
   ```
   POST /api/v1/integrations/schemas/:name/versions/:v/retire
   { "reason": "Schema validation regex incorrect; rolling back to previous", "retiredBy": "user_..." }
   ```
4. The registry:
   - Transitions `SchemaVersion.status` to `RETIRED`.
   - Updates `SchemaDefinition.latestVersion` to the previous non-retired version.
   - Emits `Schema.Retired` to the `EventOutbox`.
5. Affected connectors using `versionRange: "^<broken>"` automatically re-resolve to the previous version on their next sync (within 24h, or immediately on connector restart).
6. For connectors pinned to the broken version (`version: "<broken>"` exact), manual intervention is required — update the `MappingTemplate` to a working `versionRange`.
7. For connectors already in `ERROR` state due to the broken schema, force a sync after the rollback:
   ```
   POST /api/v1/integrations/connectors/:id/sync { mode: "incremental" }
   ```
8. Post-incident: review the compatibility check to prevent recurrence.

### 5.3 Schema-registry recovery from backup

If the `SchemaDefinition` or `SchemaVersion` table is lost (database failure), the recovery is the standard PITR restore (§2.3). The schema registry is low-volume (a few hundred rows total), so the restore is fast.

If only specific rows are corrupted (e.g. an accidental `DELETE`), the platform team can restore them from the WAL archive (specifying the row's `id` to the restore tool). This is a manual operation; allow 1h.

---

## 6. Incident Runbook — Connector Outage

### 6.1 Scenario

The Acme POS upstream is down (Acme has a major outage). Every tenant using the `acme-pos` connector is affected: syncs fail with `http_5xx`, webhooks are not arriving (or arriving but failing validation because Acme's signing service is also down), and the `ConnectorHealth` for every Acme connector is `unhealthy=true`.

### 6.2 Triage

1. Confirm the scope: `GET /api/v1/integrations/health/dashboard?connectorCode=acme-pos` → all Acme connectors are unhealthy.
2. Confirm the upstream: try `curl https://acme.test/v1/health` from a worker node — if it returns 5xx or times out, Acme is down.
3. Check Acme's status page (if they have one) or contact the Acme support contact.
4. Determine the estimated recovery time (Acme's ETA, or "unknown").

### 6.3 Mitigation: failover to a backup connector

If a backup connector is available (e.g. an Acme CSV-import connector that reads from an SFTP drop Acme provides as a fallback):

1. Pause the failing connector:
   ```
   POST /api/v1/integrations/connectors/cfg_acme_pos_001/deactivate
   ```
2. Activate the backup connector:
   ```
   POST /api/v1/integrations/connectors/cfg_acme_csv_001/activate
   ```
3. The backup connector's `ConnectorConfiguration` should have its own `ConnectorCredential` and `ConnectorSchedule`. Verify the schedule is set (e.g. poll SFTP every 5 min).
4. Verify the backup connector is syncing (`GET /api/v1/integrations/connectors/cfg_acme_csv_001/health`).
5. Notify the affected tenants that the failover is in effect and the data may be slightly stale (CSV drops are typically hourly, not real-time).

If no backup connector is available, skip to §6.4.

### 6.4 Mitigation: manual sync trigger

If the upstream is intermittently available (e.g. Acme is up but slow):

1. Reduce the schedule cadence to avoid rate-limiting:
   ```
   PATCH /api/v1/integrations/connectors/:id/schedule
   { "expression": "*/30 * * * *" }  // every 30 min instead of every 5 min
   ```
2. Increase the per-invocation timeout:
   ```
   PATCH /api/v1/integrations/connectors/:id
   { "timeoutMs": 60000 }  // 60s instead of 30s
   ```
3. Force a sync when the upstream is responsive:
   ```
   POST /api/v1/integrations/connectors/:id/sync { mode: "incremental" }
   ```

### 6.5 Notify dependent services

The M3 `@eks/notifications` package alerts tenants when their connectors go unhealthy, but the platform team should also:

1. Post a status-page update ("Acme POS integration degraded; investigating").
2. Notify the SUPPORT team so they can field tenant questions.
3. Notify any internal services that depend on Acme data (e.g. the food-intelligence module that uses Acme orders for demand forecasting) — they may need to switch to a fallback data source or pause their downstream processing.

### 6.6 Recovery

When Acme recovers:
1. Verify the upstream is healthy: `curl https://acme.test/v1/health` → 200.
2. Force a sync on each affected connector:
   ```
   POST /api/v1/integrations/connectors/:id/sync { mode: "incremental" }
   ```
3. If a backup connector was activated (§6.3), deactivate it and re-activate the primary:
   ```
   POST /api/v1/integrations/connectors/cfg_acme_csv_001/deactivate
   POST /api/v1/integrations/connectors/cfg_acme_pos_001/activate
   ```
4. Restore the original schedule cadence and timeout (§6.4).
5. Verify the `ConnectorHealth` returns to `healthy=true` for all affected connectors.
6. Post a status-page update ("Acme POS integration recovered").

### 6.7 Post-incident

Within 24h, file a postmortem covering:
- Timeline (when Acme went down, when Eks-Food detected it, when failover was triggered, when Acme recovered, when Eks-Food recovered).
- Root cause (Acme's outage reason, if known).
- Mitigation effectiveness (did the backup connector work? was the data stale?).
- Prevention (should Eks-Food add a backup connector for other critical upstreams?).

---

## 7. Key Rotation

### 7.1 Webhook-secret rotation

When the HMAC secret for an inbound webhook is compromised (or suspected to be):

1. Generate a new secret: `openssl rand -hex 32`.
2. Update the secret on the upstream (e.g. Acme's webhook configuration page) — most upstreams support a "rolling" rotation where both old and new secrets are accepted for a window.
3. Rotate the secret on Eks-Food:
   ```
   POST /api/v1/integrations/connectors/:id/credentials/:cid/rotate
   { "value": "<new-secret>" }
   ```
4. The runtime clears the cached secret; the next inbound webhook is verified against the new secret.
5. If the upstream supports a rotation window (both secrets valid), wait 24h before revoking the old secret on the upstream. This ensures any in-flight webhooks signed with the old secret are still verified.
6. If the upstream does not support a rotation window, some webhooks may fail verification during the cutover — they will be retried per the `RetryPolicy`, and the upstream should re-send them.
7. Verify by triggering a test webhook from the upstream and confirming it's `DELIVERED` (`GET /api/v1/integrations/webhooks/deliveries?endpointId=...&status=DELIVERED`).

For outbound webhooks, the rotation is symmetric: rotate the secret on the recipient, then rotate on Eks-Food.

### 7.2 OAuth-credential rotation

When an OAuth refresh token is compromised (or suspected to be):

1. **Revoke** the compromised token at the upstream (e.g. Acme's OAuth revocation endpoint: `POST /oauth/revoke { token: <compromised_refresh_token> }`).
2. **Re-authorise** the connector: the Integration Console shows a "Re-authorise" button when the connector is in `ERROR` state with `lastError="auth_refresh_required"`. The user repeats the OAuth dance (see `AUTHENTICATION_GUIDE.md` §3.2).
3. The new tokens are persisted to `ConnectorCredential`; the old rows are deactivated.
4. Verify the connector resumes syncing (`GET /api/v1/integrations/connectors/:id/health` → `healthy=true`).
5. Audit-log review: check `INTEGRATION_SECRET_ACCESSED` rows for the compromised credential in the last 30 days — were there any unexpected accesses?

### 7.3 Master-key rotation

When the AES-256-GCM master key is compromised (or suspected to be):

1. **Generate a new master key** in KMS (`keyVersion = N+1`).
2. **Update** `EKS_SECURITY_MASTER_KEY_VERSION=N+1` in the platform config.
3. The runtime uses `keyVersion=N+1` for all new writes; reads of `keyVersion=N` rows still work (the old key remains available).
4. **Run the re-encryption job**: `bunx @eks/integration secrets reencrypt --from-version N --to-version N+1`. This iterates every `ConnectorCredential` and `SecretReference` with `keyVersion=N`, decrypts with the old key, re-encrypts with the new key, and updates the row.
5. The job is **idempotent and resumable** — a crash mid-rotation leaves a mix of `keyVersion=N` and `keyVersion=N+1` rows, both of which decrypt correctly.
6. **Monitor** the job progress (`GET /api/v1/integrations/secrets/reencrypt-status`). For 50k connectors, the job typically completes in <1h.
7. **Deprecate the old key** in KMS (still available for reads of any pre-rotation backups; purged after 90 days).
8. **Audit-log review**: check `INTEGRATION_SECRET_ACCESSED` rows in the last 90 days — were there any unexpected accesses? If so, treat every accessed credential as compromised and rotate them individually (§7.4).

### 7.4 Individual credential rotation

After a master-key compromise, every credential that was accessed during the compromise window should be individually rotated:

1. List the affected credentials from the audit log (`GET /api/v1/audit?category=INTEGRATION&action=SECRET_ACCESSED&from=...&to=...`).
2. For each credential, follow the rotation procedure in `OPERATIONS_RUNBOOK.md` §3.3.
3. For shared secrets (`SecretReference`), follow `OPERATIONS_RUNBOOK.md` §3.3 (shared secret variant).
4. Verify every affected connector resumes syncing.

This is a labor-intensive process (typically 30 min per credential × N credentials). For a major compromise, the platform team should coordinate with affected tenants to rotate in parallel.

---

## 8. Region Outage & Cross-Region Failover

The Connector Platform runs in the tenant's `dataResidencyRegion` (per the M2 `MULTI_TENANCY.md` §9). A region outage is a Sev-1 incident affecting every tenant in that region.

### 8.1 Detection

- The health dashboard shows every connector as `unhealthy=true`.
- The M1 `/api/v1/health?deep=true` endpoint returns `503 Service Unavailable`.
- CloudWatch (or equivalent) reports the region's RDS and ElastiCache as unavailable.

### 8.2 Recovery procedure — region outage

1. On-call declares Sev-1, opens the incident channel, pages the DBA and the platform team.
2. DBA triggers the cross-region failover:
   - Promote the read-replica in the failover region to primary (`aws rds promote-read-replica --db-instance-identifier eks-prod-failover`).
   - Update DNS (`EKS_DB_HOST`) to point to the failover region.
   - Update Redis (`EKS_CACHE_REDIS_URL`) to the failover region's ElastiCache.
3. Platform team rolls the worker pool in the failover region (`kubectl scale deployment/integration-worker --replicas=20`).
4. On-call verifies: `curl /api/v1/integrations/health/dashboard` → 200.
5. The RPO for cross-region replication is 5 minutes (async replication); any writes in the last 5 minutes before the outage may be lost. The on-call identifies affected connectors (those with `lastSyncAt` in the last 5 min) and forces full syncs to reconcile.
6. Post-incident: review the cross-region replication lag (it should be <5s in steady state; if it was higher, investigate).

### 8.3 Failback

When the primary region recovers:
1. DBA re-establishes replication from the failover region back to the primary.
2. Once replication is in sync (lag <5s), DBA schedules a failback window (typically a low-traffic period).
3. During the failback window: pause all `ConnectorSchedule` rows, failover DNS back to the primary region, resume schedules.
4. Verify all connectors are healthy.

---

## 9. DR Drills

The platform team runs a DR drill quarterly to verify the procedures in this document. The drill:

1. **Quarterly: connector-config restore** — restore the `ConnectorConfiguration` table from a PITR backup to a staging instance; verify a smoke-test connector can sync.
2. **Quarterly: webhook DLQ replay** — populate a staging DLQ with 10k deliveries; verify the bulk replay completes in <10 min.
3. **Semi-annually: schema rollback** — publish a broken `SchemaVersion` to staging; verify the rollback procedure recovers in <30 min.
4. **Semi-annually: master-key rotation** — rotate the staging master key; verify the re-encryption job completes in <1h for 10k credentials.
5. **Annually: region failover** — failover staging from the primary region to the failover region; verify the platform recovers in <4h.

Drill results are recorded in the DR drill log (in the M2 `AuditLog` with `category="DR_DRILL"`). Failures trigger a remediation task with a 30-day SLA.

---

## 10. Recovery Verification Checklist

After any recovery procedure, verify:

- [ ] `GET /api/v1/health?deep=true` → 200 (platform health).
- [ ] `GET /api/v1/integrations/health/dashboard` → 200 (integration health; no Sev-1 connectors).
- [ ] Smoke-test sync on a known connector (`POST /api/v1/integrations/connectors/cfg_smoke_test/sync`) → 202, then `GET /api/v1/integrations/jobs/:jobId` → `status=SUCCEEDED`.
- [ ] Smoke-test webhook (`POST /api/v1/integrations/webhooks/inbound/smoke-test` with a valid signature) → 200.
- [ ] Audit log is being written (`GET /api/v1/audit?category=INTEGRATION&from=<recovery_time>` → non-empty).
- [ ] Outbox relay is delivering events (`GET /api/v1/events/outbox?status=PENDING` → not growing unbounded).
- [ ] Worker pool is healthy (`integration_worker_pool_size > 2`).
- [ ] Queue depth is decreasing (`integration_queue_depth{queue="sync"}` is falling).

If any check fails, re-open the incident and escalate to the platform team.

---

## 11. Common DR Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Restoring the database without restoring the master key | All `ConnectorCredential` values fail to decrypt | The master key is in KMS (not the database); ensure KMS is in the same region as the restored DB |
| Failing over without updating the worker pool | Syncs queued but not executing | The worker pool reads from `EKS_DB_HOST`; rolling-restart the workers after DNS cutover |
| Replaying the DLQ before fixing the connector bug | DLQ grows again immediately | Always fix the bug first (§4.2 step 3), then replay |
| Rotating the master key without re-encrypting | Old `keyVersion=N` rows fail to decrypt after the old key is purged | Always run the re-encryption job (§7.3 step 4) before purging the old key |
| Failing over to a backup connector without verifying its schedule | Backup connector doesn't sync | Verify the `ConnectorSchedule` row exists and `status=ACTIVE` after activation |
| Forgetting to pause schedules during a DB restore | Sync storm when the DB returns; rate-limited by upstreams | Always bulk-pause schedules before the restore (§2.3 step 3) |
| Cross-region failover without verifying replication lag | Data loss >5 min | Check `aws rds describe-db-instances --db-instance-identifier eks-prod-failover` for `ReplicaLag` before failing over |
| Not running DR drills | Procedures are stale; team is unfamiliar | Run the quarterly drills (§9); remediate failures within 30 days |

When in doubt, the safest action is to **pause everything** (schedules, endpoints, workers) and **escalate to the platform team**. A paused platform does no harm; a misbehaving active platform can corrupt data and trigger cascading failures.
