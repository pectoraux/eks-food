# Eks-Food Connector Synchronization Guide

> **Audience:** Connector authors, integration architects, on-call maintainers. Read alongside `ARCHITECTURE.md` (Synchronization bounded context), `CONNECTOR_DEVELOPMENT.md` §3.7 (the `sync()` method), `SCHEMA_REGISTRY_GUIDE.md` (target schemas), `TRANSFORMATION_GUIDE.md` (data shaping), and `OPERATIONS_RUNBOOK.md` (sync-lag runbook).
>
> **Status:** M4. The sync engine lives in `@eks/integration/sync.ts`. State is persisted in `SynchronizationJob` (one row per sync invocation) and `SynchronizationCheckpoint` (one row per `batchSize` records within a sync). Cursor state lives on `ConnectorConfiguration.syncState` (JSON column).

---

## 1. Sync Modes

The platform supports five sync modes. A connector's `sync()` method receives the mode in its arguments and adapts accordingly. The mode is selected by the operator when triggering a sync (or by the `ConnectorSchedule` for scheduled syncs).

| Mode | When to use | Cursor semantics | Cost |
|---|---|---|---|
| **Full sync** | First-time setup; recovering from corruption; small datasets | None — always starts from zero | O(N) per run |
| **Incremental sync** | Default. Steady-state sync for sources that support cursors (timestamps, offsets, opaque tokens) | Resume from `lastCursor` | O(Δ) per run |
| **Delta sync** | Sources that emit change feeds (CDC, change logs) | Resume from `lastChangeId` | O(Δ) per run |
| **Scheduled sync** | Time-triggered (cron or interval). Mode is `incremental` by default | Resume from `lastCursor` | O(Δ) per run |
| **Event-driven sync** | Triggered by a domain event (e.g. `booking.created.v1` triggers an outbound sync to Acme) | N/A (single-record) | O(1) per event |

Bidirectional sync is a **composition** of two one-way syncs (Eks-Food → external, external → Eks-Food) with a conflict-resolution strategy. See §6.

### 1.1 Full sync

A full sync re-pulls every record from the source. Use when:
- The connector is first activated (no cursor exists).
- The source schema has changed in a way that invalidates the cursor (e.g. the upstream renamed the `updated_at` field).
- The operator explicitly triggers a full sync from the Integration Console.
- The connector has been `ERROR` for more than 7 days and the cursor is stale beyond the source's retention window.

```typescript
await ctx.sdk.events.publish("connector.sync.full.requested.v1", {
  connectorCode: ctx.config.connectorCode,
  reason: "manual",
});
const result = await connector.sync(ctx, undefined); // cursor=undefined → full
```

Full syncs are expensive; the platform rate-limits them to once per 24h per connector (`RateLimitPolicy` named `sync-full`). Operators requesting a second full sync within 24h receive a `429` with a `Retry-After` header.

### 1.2 Incremental sync (cursor-based)

The default. The source exposes a cursor — typically an `updated_at` timestamp or an opaque `next_page_token` — that lets the connector resume from where it left off. The platform stores the cursor on `ConnectorConfiguration.syncState.cursor` and passes it back to `sync()` on each invocation.

See §3 for a worked example.

### 1.3 Delta sync

For sources that expose a change feed (e.g. Postgres logical replication via Debezium, Acme's `/v1/changes` endpoint, Kafka compacted topics). The connector consumes changes in order, applies them to Eks-Food, and advances a `lastChangeId` cursor.

Delta sync differs from incremental in two ways:
- **Incremental** asks "what records were updated since `<cursor>`?" — the source re-evaluates the dataset.
- **Delta** asks "what changes occurred since `<changeId>`?" — the source provides an ordered log.

Delta syncs are typically lower-latency (the change feed is fast) and lower-cost (no full re-scan), but require the source to support them. The connector declares `sync.supportsDelta: true` in the manifest; the runtime prefers delta when available.

### 1.4 Scheduled sync

A `ConnectorSchedule` row drives the cadence. The schedule is a cron expression or an interval:

```json5
{
  connector: {
    schedule: {
      kind: "cron", // or "interval"
      expression: "*/5 * * * *", // every 5 minutes
      mode: "incremental", // default; or "delta" or "full"
      priority: 5, // 1 (high) to 10 (low); used for backpressure triage
    },
  },
}
```

The scheduler (`@eks/integration/scheduling.ts`) computes `nextFireAt` and enqueues a sync job onto the M1 worker queue. The worker dequeues and invokes `connector.sync(ctx, lastCursor)`. The `mode` from the schedule is passed to `sync()` via `ctx.config.syncState.mode`.

### 1.5 Event-driven sync

Triggered by a domain event subscription. A connector declares:

```json5
{
  connector: {
    eventTriggers: [
      {
        eventType: "booking.created.v1",
        action: "sync", // or "poll" or "webhook-outbound"
        mapping: "eks-booking-to-acme-order",
      },
    ],
  },
}
```

When `booking.created.v1` is emitted, the runtime:
1. Loads the connector for every tenant that has the connector installed and the event trigger declared.
2. Invokes `mapSchema(ctx, booking)` to translate the Eks-Food record to the external format.
3. Invokes `connector.sync(ctx, undefined, { event: booking })` — the third argument is the triggering event.
4. The connector makes the appropriate upstream call (e.g. `POST /v1/orders` on Acme) and emits a `Connector.Synced` event on success.

Event-driven syncs have a per-event rate limit (`RateLimitPolicy` named `sync-event`) to prevent a burst of bookings from overwhelming the upstream.

---

## 2. The `SynchronizationJob` and `SynchronizationCheckpoint` Models

### 2.1 `SynchronizationJob`

```prisma
model SynchronizationJob {
  id              String   @id @default(cuid())
  configId        String   // → ConnectorConfiguration.id
  organizationId  String   // tenant scope
  // FULL | INCREMENTAL | DELTA | SCHEDULED | EVENT_DRIVEN
  mode            String
  // PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED | ROLLING_BACK
  status          String   @default("PENDING")
  // The starting cursor (null for FULL)
  startCursor     String?
  // The ending cursor (set on SUCCEEDED)
  endCursor       String?
  // Counts (updated incrementally as the job progresses)
  recordsProcessed Int     @default(0)
  recordsCreated  Int      @default(0)
  recordsUpdated  Int      @default(0)
  recordsDeleted  Int      @default(0)
  conflicts       Int      @default(0)
  errors          Int      @default(0)
  // The triggering event (for EVENT_DRIVEN mode)
  triggerEventId  String?
  // Error message (set on FAILED)
  errorMessage    String?
  // The retry policy in effect (snapshot of RetryPolicy at start time)
  retryPolicyId   String?
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime @default(now())

  config          ConnectorConfiguration @relation(fields: [configId], references: [id])
  checkpoints     SynchronizationCheckpoint[]

  @@index([configId, status])
  @@index([organizationId, status])
  @@index([status, startedAt])
}
```

### 2.2 `SynchronizationCheckpoint`

```prisma
model SynchronizationCheckpoint {
  id              String   @id @default(cuid())
  jobId           String   // → SynchronizationJob.id
  // The cursor at the time the checkpoint was written
  cursor          String
  // The record count when the checkpoint was written
  recordsProcessed Int
  // The batch sequence number (1, 2, 3, ... within a job)
  sequence        Int
  // The payload hash at the checkpoint (for integrity verification on rollback)
  payloadHash     String
  createdAt       DateTime @default(now())

  job             SynchronizationJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@unique([jobId, sequence])
  @@index([jobId, cursor])
}
```

A checkpoint is written every `batchSize` records (default 100, configurable per `ConnectorConfiguration`). The platform writes the checkpoint **transactionally with the batch's event emissions** — if the events are committed to the `EventOutbox`, the checkpoint is committed to `SynchronizationCheckpoint`. If the job crashes mid-batch, the next invocation resumes from the last committed checkpoint.

---

## 3. Worked Example — Incremental Sync with a Cursor

This section traces a single incremental sync of the Acme POS connector end-to-end. The connector was last synced at `cursor=2025-01-15T10:00:00Z`; the operator triggers a manual sync at 10:05.

### 3.1 The trigger

```
POST /api/v1/integrations/connectors/cfg_acme_pos_001/sync
{ "mode": "incremental" }
```

The route handler:
1. Authorises the caller (`integration.syncs.force`).
2. Loads the `ConnectorConfiguration` (`id=cfg_acme_pos_001`, `organizationId=org_eks`, `status=ACTIVE`).
3. Verifies no in-flight `SynchronizationJob` exists for this config (returns `409 Conflict` if one does).
4. Creates a `SynchronizationJob` (`mode=INCREMENTAL`, `status=PENDING`, `startCursor="2025-01-15T10:00:00Z"`).
5. Enqueues a sync job onto the M1 worker queue with `jobId` as the payload.
6. Returns `202 Accepted` with the `SynchronizationJob` row.

### 3.2 The worker picks up the job

The worker:
1. Transitions the `SynchronizationJob` to `RUNNING` and sets `startedAt=now()`.
2. Loads the `Connector` bundle from the M3 registry cache.
3. Materialises the `ConnectorContext`:
   - `config.id = "cfg_acme_pos_001"`
   - `config.organizationId = "org_eks"`
   - `config.connectorCode = "acme-pos"`
   - `config.credentials = { acmeBaseUrl, ACME_API_KEY, ACME_API_SECRET, accessToken, ... }` (decrypted at the boundary)
   - `config.syncState = { cursor: "2025-01-15T10:00:00Z", lastSyncAt: "2025-01-15T10:00:00Z" }`
4. Invokes `connector.sync(ctx, "2025-01-15T10:00:00Z")`.

### 3.3 The connector's `sync()` runs

The connector (from `CONNECTOR_DEVELOPMENT.md` §3.7):
1. Builds the URL: `https://acme.test/v1/menu/full?since=2025-01-15T10:00:00Z`.
2. Calls `ctx.sdk.paginate` which walks pages of 100 items each.
3. For each item:
   a. Calls `mapSchema(ctx, item)` to translate Acme → Eks-Food `MealCategory`.
   b. Validates the mapped record against the target `SchemaVersion` (runtime asserts; `CONN_SCHEMA_MISMATCH` on failure → counted in `errors`).
   c. Emits `acme.menu.upserted.v1` to the `EventOutbox` with `dedupeKey=acme-menu-<id>`.
   d. Increments `processed`.
4. After every 100 items (the `batchSize`), the runtime:
   a. Writes a `SynchronizationCheckpoint` (`jobId`, `cursor=<current>`, `recordsProcessed`, `sequence=N`, `payloadHash=<sha256 of the batch>`).
   b. The write is in the same DB transaction as the outbox writes for that batch.
5. The connector returns `SyncResult` with the final counts and `nextCursor`.

### 3.4 The worker finalises the job

The worker:
1. Updates `SynchronizationJob` (`status=SUCCEEDED`, `endCursor=<nextCursor>`, `recordsProcessed=423`, ..., `completedAt=now()`).
2. Updates `ConnectorConfiguration` (`syncState.cursor=<nextCursor>`, `syncState.lastSyncAt=now()`, `lastSyncAt=now()`, `lastError=null`).
3. Updates `ConnectorHealth` (last sync success, last sync duration, last sync record count).
4. Emits `Connector.Synced` to the `EventOutbox` (consumed by the Integration Console live-update, `@eks/notifications` if a threshold is crossed).
5. Returns control to the worker pool.

### 3.5 Total wall-clock

For a 423-record sync:
- `sync()` execution: ~3.2s (423 records × ~7ms each, dominated by the Acme API round-trip).
- Checkpoint writes: 5 transactions × ~10ms = 50ms.
- Outbox commit: ~20ms.
- Job finalisation: ~30ms.
- **Total: ~3.4s** — well within the 30s per-invocation timeout.

---

## 4. Conflict Detection

Conflicts arise when both Eks-Food and the external system update the same record between syncs. The platform detects conflicts via a `version` field on the target aggregate (every Eks-Food aggregate has a `Version` per the M3 `@eks/domain/shared/entity.ts`).

The conflict-detection algorithm (in `@eks/integration/sync.detect-conflicts.ts`):

1. Before applying a mapped record, the runtime loads the current Eks-Food aggregate (e.g. `Booking`).
2. Compares the aggregate's `lastSyncedAt` (the timestamp of the last successful sync of this record) with the current `syncState.cursor`.
3. If `lastSyncedAt > syncState.cursor`, the record was updated in Eks-Food since the last sync — a conflict.
4. The conflict is recorded on `SynchronizationJob.conflicts++` and emitted as `Connector.SyncConflict` with `{ recordId, localVersion, remoteVersion }`.

The `ConnectorConfiguration.sync.conflictStrategy` declares how to resolve:

| Strategy | Behaviour |
|---|---|
| `remote_wins` | The external record overwrites the Eks-Food record. Local changes are lost (emitted as `Connector.LocalChangeOverwritten` for audit). |
| `local_wins` | The Eks-Food record is kept; the external record is ignored. The next outbound sync pushes the local version back. |
| `newest_wins` | The record with the later `updatedAt` timestamp wins. |
| `manual` | The conflict is queued for human review in the Integration Console. The `SynchronizationJob` continues but the conflicting record is skipped. |
| `merge` | The connector's `mergeConflicts()` method (optional) is invoked with both versions and returns a merged record. |

The default is `remote_wins` for inbound syncs and `local_wins` for outbound syncs. Bidirectional syncs use `newest_wins` or `merge` (see §6).

---

## 5. Duplicate Detection

Duplicate detection prevents the same external record from being applied twice (e.g. when a webhook arrives during a sync of the same record). The platform uses the `dedupeKey` passed to `ctx.sdk.events.publish`:

```typescript
await ctx.sdk.events.publish("acme.order.updated.v1", order, {
  dedupeKey: `acme-order-${order.id}-${order.updated_at}`,
});
```

The `EventOutbox` table has a unique index on `(dedupeKey, organizationId)`. If a second event with the same `dedupeKey` is emitted, the database rejects the insert and the runtime treats it as a no-op (the first event has already been processed). The connector does not need to handle the duplicate — the platform silently drops it.

For syncs, the `dedupeKey` should include both the external id and a version (e.g. `updated_at`). Two syncs that re-process the same external record at the same version produce the same `dedupeKey` and the second is a no-op. A sync that processes a record at a new version produces a new `dedupeKey` and the new event is applied.

---

## 6. Bidirectional Sync

Bidirectional sync keeps two systems in sync in both directions. The platform implements it as two one-way syncs (inbound + outbound) with a shared conflict strategy.

### 6.1 Inbound sync

Same as §3. The connector's `sync()` pulls from the external system, maps to Eks-Food, and emits domain events. The M3 `@eks/domain` handlers apply the events to the aggregates and update `lastSyncedAt`.

### 6.2 Outbound sync

Triggered by Eks-Food domain events. The connector declares an event subscription:

```json5
{
  connector: {
    eventTriggers: [
      {
        eventType: "booking.updated.v1",
        action: "sync",
        mapping: "eks-booking-to-acme-order",
        filter: { "syncSource": { "$ne": "acme-pos" } }, // don't echo back
      },
    ],
  },
}
```

When `booking.updated.v1` is emitted:
1. The runtime filters out events whose `syncSource="acme-pos"` (set by the inbound sync to prevent infinite loops).
2. Invokes `mapSchema(ctx, booking, "acme-order")` to translate Eks-Food → Acme.
3. Invokes `connector.sync(ctx, undefined, { event: booking, direction: "outbound" })`.
4. The connector makes the upstream call (`PUT /v1/orders/<id>` on Acme).

### 6.3 Loop prevention

The `syncSource` field on every domain event prevents infinite loops:
- Inbound sync sets `syncSource=acme-pos` on the emitted events.
- Outbound sync filters out events whose `syncSource` matches the connector's code.

Without this, an Acme update would trigger an outbound sync to Acme, which would trigger an inbound sync from Acme, ad infinitum. The platform enforces `syncSource` on every event published by `@eks/integration`; a connector that omits it is rejected at publish time.

### 6.4 Conflict resolution

When both systems update the same record between syncs:
- Inbound sync detects the conflict (Eks-Food `lastSyncedAt > syncState.cursor`).
- The `conflictStrategy` resolves (default `newest_wins` for bidirectional).
- If `newest_wins` keeps the local version, the outbound sync will push it back on the next event.
- If `newest_wins` keeps the remote version, the inbound sync overwrites local; the next outbound sync sees no diff and is a no-op.

---

## 7. Partial-Failure Recovery

A sync that fails partway through leaves the platform in a partially-applied state. The platform's recovery model:

1. **Checkpoints are transactional.** Every batch of `batchSize` records is committed atomically (events to outbox + checkpoint to `SynchronizationCheckpoint` + cursor update on `ConnectorConfiguration`). A crash mid-batch loses at most the in-flight batch.
2. **The job's `status` reflects the truth.** A crashed job is `RUNNING` until the worker's heartbeat expires (60s); the scheduler then transitions it to `FAILED` with `errorMessage="worker_crashed"`.
3. **The next sync resumes from the last checkpoint.** The runtime reads `MAX(SynchronizationCheckpoint.sequence) WHERE jobId=<failed>` and uses that checkpoint's `cursor` as the `startCursor` for the next sync.
4. **`errors[]` are non-fatal.** Per-record errors (e.g. schema mismatch on one record) are counted but do not fail the job. The job is `SUCCEEDED` if `errors < batchSize × 0.5` (i.e. less than 50% of records failed); otherwise it's `FAILED` with `errorMessage="error_rate_exceeded"`.

### 7.1 Worked example — partial failure

A 1000-record sync crashes after 423 records. The checkpoints are at `sequence=1 (cursor=t1, 100 records)`, `sequence=2 (cursor=t2, 200 records)`, `sequence=3 (cursor=t3, 300 records)`, `sequence=4 (cursor=t4, 400 records)`. The 423rd record was being processed when the crash happened — no checkpoint for the 401-500 batch.

On retry:
1. The runtime loads `MAX(sequence)=4` → `cursor=t4`.
2. Starts the new sync with `startCursor=t4`.
3. The connector re-fetches from Acme with `?since=t4` and re-processes records 401-1000.

The 401st record may be re-processed (depending on whether Acme's `since` filter is inclusive). The duplicate is caught by `dedupeKey` (§5) — the second emission is a no-op.

---

## 8. Rollback

A `SynchronizationJob` can be rolled back to any of its checkpoints:

```
POST /api/v1/integrations/jobs/job_abc/rollback
{ "toCheckpointSequence": 3 }
```

The route handler:
1. Authorises the caller (`integration.syncs.rollback`).
2. Loads the `SynchronizationCheckpoint` at `sequence=3`.
3. Transitions the job to `ROLLING_BACK`.
4. For each event emitted by the job after `sequence=3`, emits a compensating event:
   - `acme.menu.upserted.v1` → `acme.menu.reverted.v1`
   - `acme.menu.created.v1` → `acme.menu.deleted.v1`
5. The M3 `@eks/domain` handlers apply the compensating events (undoing the aggregates' state).
6. Updates `ConnectorConfiguration.syncState.cursor` to the checkpoint's `cursor`.
7. Transitions the job to `SUCCEEDED` with `errorMessage="rolled_back_to_sequence_3"`.

Rollback is **best-effort**:
- If a record was updated by a later sync, the rollback cannot undo the later sync's changes (the later sync's events are not in scope).
- If a downstream system consumed the events and acted on them (e.g. an SMS was sent), the rollback cannot undo the SMS.
- The compensating events are emitted to the `EventOutbox` and processed by the same handlers as forward events; if a handler is not idempotent, the rollback may leave the system in an inconsistent state.

For this reason, rollback is gated behind the `integration.syncs.rollback` permission (typically granted only to platform admins) and requires a written incident report. The Integration Console shows a "Rollback is best-effort — confirm you have read the docs" confirmation dialog.

---

## 9. Sync Lag & Observability

The platform tracks sync lag (the time between when a record changed at the source and when the change is reflected in Eks-Food):

```typescript
// In @eks/integration/health.ts
syncLag = now() - ConnectorConfiguration.lastSyncAt
        + (estimated time for the next sync to process the backlog)
```

The `ConnectorHealth` rollup exposes:
- `lastSyncAt` — when the last sync completed.
- `lastSyncDurationMs` — wall-clock of the last sync.
- `lastSyncRecords` — count from the last sync.
- `syncLagSeconds` — estimated lag.
- `p50SyncDurationMs`, `p99SyncDurationMs` — 5-minute rollups.
- `errorRate5m` — fraction of `ConnectorExecution` rows in the last 5 minutes that are `FAILED`.

The ops dashboard (see `OPERATIONS_RUNBOOK.md` §2) shows these per connector, with alerting on `syncLagSeconds > 600` (10 minutes) or `errorRate5m > 0.5`.

---

## 10. Sync API Reference

```
POST   /api/v1/integrations/connectors/:id/sync                — trigger a sync (body: { mode })
GET    /api/v1/integrations/jobs/:jobId                        — job status + checkpoints
GET    /api/v1/integrations/jobs/:jobId/checkpoints            — list checkpoints
POST   /api/v1/integrations/jobs/:jobId/rollback               — rollback to a checkpoint
POST   /api/v1/integrations/jobs/:jobId/cancel                 — cancel a RUNNING job (best-effort)
GET    /api/v1/integrations/connectors/:id/jobs                — paginated job history
GET    /api/v1/integrations/connectors/:id/sync-state          — current cursor + lastSyncAt
PUT    /api/v1/integrations/connectors/:id/sync-state          — overwrite cursor (admin only)
```

The `PUT sync-state` route is a **manual override** used to recover from corrupted cursors (e.g. when an upstream changes its cursor format). It is gated behind `integration.syncs.admin` and emits `Connector.SyncStateOverwritten` to the `EventOutbox` for audit.

---

## 11. Common Sync Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Cursor stored inside `sync()` in `ctx.config.credentials` | Cursor lost on sandbox exit | Use `SyncResult.nextCursor` — the runtime persists it |
| `since` filter inclusive at the source | Every sync re-processes the last record | Use `dedupeKey` with the record's `updated_at` — duplicates are silently dropped |
| `since` filter exclusive at the source | First record after the cursor is skipped | Use `cursor = lastProcessedRecord.updatedAt` (not `now()`) so the next sync's `since` is the last seen record |
| Mapping error on one record fails the whole sync | Sync hangs in `RUNNING` forever | Catch per-record errors in `sync()` and add to `errors[]`; the platform treats `errors[]` as non-fatal |
| Not setting `syncSource` on emitted events | Bidirectional sync creates an infinite loop | The runtime sets `syncSource` automatically when invoking `sync()` — never override it in connector code |
| Using `Date.now()` as the cursor | Skipped records when the source's clock drifts | Always use the source's `updated_at` field as the cursor; never the platform's wall clock |
| Full sync every 5 minutes | Source rate-limits; sync never completes | Use incremental sync with a cursor; reserve full syncs for first-time setup and recovery |
| Outbox growing unbounded | Database bloat | The M1 outbox relay purges delivered events after 7 days; syncs that produce >10k events should reduce `batchSize` |

When in doubt, run `bunx @eks/dev-cli validate --sync` — it static-analyses the connector's `sync()` for these pitfalls.
