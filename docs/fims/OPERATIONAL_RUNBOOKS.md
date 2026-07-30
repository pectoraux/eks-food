# Eks-Food Food Intelligence Platform — Operational Runbooks

> **Audience:** On-call engineers, SREs, FIMS platform operators, data engineers. Read alongside `CATALOG_ARCHITECTURE.md`, `RECIPE_ENGINE_GUIDE.md`, `NUTRITION_ENGINE_GUIDE.md`, `INVENTORY_GUIDE.md`, `BATCH_TRACEABILITY_GUIDE.md`, `MEASUREMENT_SYSTEM_GUIDE.md`, `IMPORT_EXPORT_GUIDE.md`, and the M1 `docs/OPERATIONS_RUNBOOK.md`.
>
> **Status:** Milestone 7. This document is the on-call runbook for the FIMS platform. Every section maps to a Grafana dashboard panel, a Prometheus alert, and a runbook step.

---

## 1. Service Overview

The FIMS platform runs as part of the main Eks-Food Next.js application (no separate deployable service). Its components:

| Component | Process | Backed by |
|---|---|---|
| REST API (`/api/v1/fims/*`) | Next.js route handlers (Node.js) | Postgres (Prisma) |
| `RecipeScaler` | In-process (Next.js) | Postgres + LRU cache |
| `NutritionEngine` | In-process (Next.js) | Postgres + LRU cache |
| `MeasurementConverter` | In-process (Next.js) | Postgres + LRU cache |
| `RecallService` | In-process (Next.js) | Postgres |
| `ImportRunner` worker | M1 `@eks/workers` consumer | Postgres + object store |
| `ExportRunner` worker | M1 `@eks/workers` consumer | Postgres + object store |
| `InventoryReservationExpiryJob` | M1 cron (60 s) | Postgres |
| `ExpirationScannerJob` | M1 cron (1 h) | Postgres |
| `ColdChainAdjustmentJob` | M1 cron (15 m) | Postgres + cold-chain sensor feed |
| `RecipeClassificationDriftDetector` | M1 cron (nightly) | Postgres |
| `ImportRollbackExpiryJob` | M1 cron (daily) | Postgres |
| `ExportRetentionJob` | M1 cron (daily) | Postgres + object store |

All components share the main Postgres instance. A read replica is configured for catalog search and inventory stock queries; writes always go to the primary.

---

## 2. Dashboards & Alerts

### 2.1 Dashboards

| Dashboard | URL | Owner |
|---|---|---|
| FIMS Overview | `https://grafana.eks-food.com/d/fims-overview` | Platform team |
| FIMS Catalog | `https://grafana.eks-food.com/d/fims-catalog` | Platform team |
| FIMS Recipe | `https://grafana.eks-food.com/d/fims-recipe` | Platform team |
| FIMS Nutrition | `https://grafana.eks-food.com/d/fims-nutrition` | Platform team |
| FIMS Inventory | `https://grafana.eks-food.com/d/fims-inventory` | Platform team |
| FIMS Imports | `https://grafana.eks-food.com/d/fims-imports` | Platform team |
| FIMS Recall | `https://grafana.eks-food.com/d/fims-recall` | Platform team |

### 2.2 Alerts

| Alert | Severity | Trigger | Runbook |
|---|---|---|---|
| `FimsApiLatencyHigh` | warning | p99 > 500 ms for 5 min | §5 |
| `FimsApiLatencyCritical` | critical | p99 > 2 s for 2 min | §5 |
| `FimsApiErrorRateHigh` | warning | 5xx rate > 1% for 5 min | §6 |
| `RecipeScalerLatencyHigh` | warning | p99 > 1 s for 5 min | §7 |
| `NutritionComputeLatencyHigh` | warning | p99 > 500 ms for 5 min | §8 |
| `InventoryTurnoverLow` | warning | turnover < 4× / month for a location | §9 |
| `InventoryTurnoverStale` | warning | no movement for 14 days at a location | §9 |
| `WasteVolumeHigh` | warning | waste > 5% of receipts (7-day rolling) | §10 |
| `WasteVolumeCritical` | critical | waste > 10% of receipts (7-day rolling) | §10 |
| `CatalogGrowthAnomaly` | warning | catalog growth > 10% / day | §11 |
| `RecipeUsageDrop` | warning | recipe usage drops > 50% week-over-week | §12 |
| `SearchLatencyHigh` | warning | p99 > 200 ms for 5 min | §13 |
| `ImportThroughputLow` | warning | throughput < 50 rows/s for 5 min | §14 |
| `ImportErrorRateHigh` | warning | error rate > 5% on a single import | §14 |
| `BatchExpiringSoon` | info | batches expiring in < 48 h, value > $1 000 | §15 |
| `BatchExpiredNotWasted` | warning | expired batch with no WASTE movement for > 24 h | §15 |
| `ColdChainViolationCritical` | critical | temperature out of range > 2 h | §16 |
| `RecallInitiated` | critical | any `RecallRecord` in `QUARANTINED` or `RECALLED` state | §17 |
| `InventoryAuditVarianceHigh` | warning | variance > 5% on a completed audit | §18 |
| `ReservationExpiryLag` | warning | `InventoryReservationExpiryJob` lag > 5 min | §19 |

---

## 3. Inventory Turnover Monitoring

**Panel:** `FIMS Inventory → Turnover`.

| Metric | Source | Expected |
|---|---|---|
| `fims.inventory.turnover_ratio` | `SUM(CONSUMPTION + WASTE + SPOILAGE + TRANSFER_OUT) / AVG(onHandQty)` per location per month | ≥ 4× for kitchens; ≥ 2× for warehouses |
| `fims.inventory.days_on_hand` | `AVG(onHandQty) / AVG(daily_consumption)` | ≤ 7 days for perishables; ≤ 30 days for dry goods |
| `fims.inventory.stale_locations` | `COUNT(locations WHERE lastMovementAt < NOW() - 14 days)` | 0 |

### Action if alert fires (`InventoryTurnoverLow` or `InventoryTurnoverStale`):

1. Identify the slow-moving SKU:
   ```sql
   SELECT catalogId, variantId, SUM(onHandQty) AS qty, unit,
          MAX(lastMovementAt) AS lastMoved,
          DATEDIFF('day', MAX(lastMovementAt), NOW()) AS daysIdle
   FROM InventoryStock
   WHERE locationId = '<locationId>'
     AND lastMovementAt < NOW() - INTERVAL '14 days'
   GROUP BY catalogId, variantId, unit
   ORDER BY daysIdle DESC
   LIMIT 50;
   ```
2. Check if the SKU is still `ACTIVE` in the catalog (`GET /api/v1/fims/catalog/{id}`). If `DEPRECATED`, mark for clearance.
3. Check open reservations: `SELECT * FROM InventoryReservation WHERE catalogId=... AND status='HELD'`. Long-held reservations may indicate a stuck order.
4. If the SKU is genuinely slow, initiate a transfer to a higher-velocity location or schedule a waste / donation.
5. Document the action in the location's `metadata.lastTurnoverReview` field.

---

## 4. Waste Volume Tracking

**Panel:** `FIMS Inventory → Waste`.

| Metric | Source | Expected |
|---|---|---|
| `fims.waste.qty_pct_of_receipts` | `SUM(WASTE + SPOILAGE + DAMAGE qty) / SUM(RECEIVING qty)` per 7-day window | < 5% |
| `fims.waste.cost_pct_of_receipts` | `SUM(costImpact) / SUM(receivedCost)` per 7-day window | < 5% |
| `fims.waste.by_category` | `SUM(qty) GROUP BY wasteCategory` | EXPIRED should be < 30% of total waste |

### Action if alert fires (`WasteVolumeHigh` or `WasteVolumeCritical`):

1. Identify the top waste contributors:
   ```sql
   SELECT catalogId, wasteCategory, disposalMethod,
          SUM(quantity) AS qty, unit,
          SUM(CAST(costImpact->>'amount' AS FLOAT)) AS costUsd,
          COUNT(*) AS wasteEvents
   FROM WasteRecord
   WHERE reportedAt > NOW() - INTERVAL '7 days'
     AND organizationId = '<orgId>'
   GROUP BY catalogId, wasteCategory, disposalMethod, unit
   ORDER BY costUsd DESC
   LIMIT 20;
   ```
2. For `EXPIRED` waste dominant: check ordering patterns. Likely over-ordering. Recommend the procurement team reduce the next PO by the waste ratio.
3. For `SPOILED` waste dominant: check cold-chain logs (`SELECT * FROM InventoryMovement WHERE recordedTemperatureC IS NOT NULL AND metadata.coldChainViolation = true`). If violations correlate, see §16.
4. For `OFF_SPEC` waste dominant: review the recipe's `RecipeStage.timeMin` and `targetTempC` — likely a process control issue.
5. For `OVERPRODUCTION` waste dominant: review cook firing sizes; the `RecipeScaler` may be over-scaling for forecasted demand.
6. File a corrective action in the linked `FoodSafetyIncident` if the waste category is `CONTAMINATED`.

---

## 5. Catalog Growth

**Panel:** `FIMS Catalog → Growth`.

| Metric | Source | Expected |
|---|---|---|
| `fims.catalog.items_total` | `SELECT COUNT(*) FROM FoodCatalog WHERE deletedAt IS NULL` | Grows 1–3% / week organically |
| `fims.catalog.items_active` | `WHERE status='ACTIVE'` | 80–95% of total |
| `fims.catalog.items_by_type` | `SELECT itemType, COUNT(*) ... GROUP BY itemType` | Stable distribution |
| `fims.catalog.alias_count` | `SELECT COUNT(*) FROM IngredientAlias` | 3–5× catalog item count |

### Action if alert fires (`CatalogGrowthAnomaly`):

1. Identify the source of growth:
   ```sql
   SELECT source, COUNT(*) AS items,
          COUNT(DISTINCT createdBy) AS distinctUsers
   FROM CatalogImport ci
   JOIN CatalogImportRow cir ON cir.importId = ci.id
   WHERE ci.completedAt > NOW() - INTERVAL '24 hours'
     AND cir.outcome = 'CREATED'
   GROUP BY source
   ORDER BY items DESC;
   ```
2. If a single `CatalogImport` created > 1 000 items in 24 h, verify the import was authorized (`GET /api/v1/fims/imports/{id}` — check `initiatedByUserId` and `source`).
3. If unauthorized, rollback the import (`POST /api/v1/fims/imports/{id}/rollback`) within the 7-day window.
4. If authorized but unexpected, notify the catalog manager — may indicate a duplicate supplier ingestion that should have been a delta import.

---

## 6. Recipe Usage

**Panel:** `FIMS Recipe → Usage`.

| Metric | Source | Expected |
|---|---|---|
| `fims.recipe.firings_per_week` | `COUNT(InventoryMovement WHERE movementType='CONSUMPTION' AND referenceType='RECIPE_SCALE')` per recipe per week | Stable or growing for active recipes |
| `fims.recipe.top_50_share` | `firings(top 50 recipes) / firings(all recipes)` | < 70% (concentration risk) |
| `fims.recipe.deprecated_active_in_menus` | `COUNT(MenuItems WHERE recipeVersionId IN (SELECT id FROM RecipeVersion WHERE status='DEPRECATED'))` | 0 |

### Action if alert fires (`RecipeUsageDrop`):

1. Identify the affected recipes:
   ```sql
   SELECT rv.recipeId, rv.title,
          COUNT(*) AS thisWeek,
          LAG(COUNT(*)) OVER (PARTITION BY rv.recipeId ORDER BY date_trunc('week', im.occurredAt)) AS lastWeek
   FROM InventoryMovement im
   JOIN RecipeVersion rv ON rv.id = im.referenceId
   WHERE im.movementType = 'CONSUMPTION'
     AND im.referenceType = 'RECIPE_SCALE'
     AND im.occurredAt > NOW() - INTERVAL '14 days'
   GROUP BY rv.recipeId, rv.title, date_trunc('week', im.occurredAt)
   HAVING COUNT(*) < 0.5 * LAG(COUNT(*)) OVER (...)
   ORDER BY thisWeek DESC;
   ```
2. Check if the recipe was recently deprecated (`GET /api/v1/fims/recipes/{id}/versions` — status of latest version).
3. Check if a substitute recipe was published that cannibalized usage.
4. Check inventory availability of the recipe's ingredients — a stockout of one ingredient may have caused cooks to switch recipes.
5. If no operational cause, escalate to the menu planning team.

---

## 7. Nutrition Calculation Performance

**Panel:** `FIMS Nutrition → Compute Latency`.

| Metric | Source | Expected |
|---|---|---|
| `fims.nutrition.compute.latency_ms` | histogram | p50 < 30 ms; p99 < 250 ms |
| `fims.nutrition.compute.cache_hit_ratio` | LRU hits / total | > 80% |
| `fims.nutrition.density.assumed.count` | warning counter | < 1% of computations |

### Action if alert fires (`NutritionComputeLatencyHigh`):

1. Check the cache hit ratio. If < 50%, the cache may be evicting too aggressively — verify the LRU size (`packages/fims/src/nutrition/engine.ts` `MAX_CACHE_SIZE`).
2. Check if a recipe with an unusually large ingredient list was recently published:
   ```sql
   SELECT rv.id, rv.title, COUNT(ril.id) AS lineCount
   FROM RecipeVersion rv
   JOIN RecipeIngredientLine ril ON ril.recipeVersionId = rv.id
   WHERE rv.publishedAt > NOW() - INTERVAL '1 hour'
   GROUP BY rv.id, rv.title
   ORDER BY lineCount DESC
   LIMIT 10;
   ```
3. Check for sub-recipe cycles that bypassed publish-time cycle detection (should not happen, but worth verifying):
   ```sql
   -- find recipes whose sub-recipe graph has any node visited twice
   -- (use the GraphEngine.hasCycle method on the suspect recipeVersionId)
   ```
4. If a tenant's nutrition computations are systematically slow, consider partitioning their `NutritionFact` reads to the read replica.

---

## 8. Search Performance

**Panel:** `FIMS Catalog → Search` (delegates to M6 `SearchEngine`).

| Metric | Source | Expected |
|---|---|---|
| `fims.catalog.search.latency_ms` | histogram | p50 < 50 ms; p99 < 200 ms |
| `fims.catalog.search.result_count` | histogram | p50 < 50 results |
| `fims.catalog.search.zero_result_rate` | counter | < 5% |

### Action if alert fires (`SearchLatencyHigh`):

1. Run the M6 search runbook (`docs/food-domain/OPERATIONAL_RUNBOOKS.md` §4) — FIMS search delegates entirely to the M6 `SearchEngine`.
2. Check for an unindexed `IngredientAlias` bulk insert (would have triggered a backlogged `SearchIndexWorker`):
   ```sql
   SELECT COUNT(*) FROM IngredientAlias WHERE createdAt > NOW() - INTERVAL '1 hour';
   ```
3. If alias inserts outpaced the indexer, scale the `SearchIndexWorker` consumer concurrency (M1 `@eks/workers` config).

---

## 9. Import Throughput

**Panel:** `FIMS Imports → Throughput`.

| Metric | Source | Expected |
|---|---|---|
| `fims.import.throughput_rows_per_sec` | gauge per running import | > 100 rows/s for CSV; > 50 rows/s for XLSX |
| `fims.import.error.rate` | `rowsFailed / rowsProcessed` per import | < 1% |
| `fims.import.queue_depth` | `COUNT(CatalogImport WHERE status='UPLOADED')` | < 5 |

### Action if alert fires (`ImportThroughputLow` or `ImportErrorRateHigh`):

1. Identify the slow import:
   ```sql
   SELECT id, importType, format, rowCount, rowsProcessed,
          rowsProcessed / EXTRACT(EPOCH FROM (NOW() - startedAt)) AS rowsPerSec,
          rowsFailed, rowsSkipped
   FROM CatalogImport
   WHERE status IN ('PARSED', 'PREVIEWED', 'COMMITTED')
   ORDER BY startedAt DESC;
   ```
2. For low throughput: check if the import is hitting the metadata-validation bottleneck (per-row Zod schema validation is CPU-bound). If so, batch the validation or move the worker to a larger instance.
3. For high error rate: pull the error breakdown:
   ```sql
   SELECT error, COUNT(*) FROM CatalogImportRow
   WHERE importId = '<id>' AND outcome = 'ERROR'
   GROUP BY error ORDER BY 2 DESC;
   ```
4. If one error code dominates (e.g. `fims.import.row.barcode.invalid`), the source file has a systemic issue. Pause the import (`POST /api/v1/fims/imports/{id}/cancel`), notify the supplier, and request a corrected file.
5. If errors are spread across many codes, the import mapping is likely wrong — review `options.mapping` against the supplier's actual file format.

---

## 10. Batch Recall Procedure

**Panel:** `FIMS Recall → Active Recalls`.

This is the most critical runbook. A recall in `QUARANTINED` or `RECALLED` state pages the on-call food safety officer immediately.

### Trigger

`RecallInitiated` alert fires (any `RecallRecord` with `status IN ('QUARANTINED', 'RECALLED')`).

### Procedure

1. **Acknowledge** the alert in PagerDuty within 5 minutes.
2. **Pull the recall record:**
   ```http
   GET /api/v1/fims/inventory/recalls/{id}
   ```
   Confirm: reason, severity, affected batches, affected locations.
3. **Verify the forward trace** has been generated:
   ```http
   GET /api/v1/fims/inventory/recalls/{id}/forward-trace
   ```
   If empty or incomplete, manually trigger: `POST /api/v1/fims/inventory/recalls/{id}/regenerate-trace` (requires `food.batch.recall.confirm` permission).
4. **Confirm or release** within 4 hours of quarantine:
   - If the recall is valid: `POST /api/v1/fims/inventory/recalls/{id}/confirm` with `confirmedBy=<your userId>`.
   - If false alarm: `POST /api/v1/fims/inventory/recalls/{id}/release` with evidence.
5. **Notify downstream systems** (auto-emitted via `fims.inventory.recall.confirmed.v1` event):
   - Marketplace: affected `MenuItem`s are hidden.
   - POS: affected recipes are blocked at order time.
   - Customer comms: draft notifications generated (require operator approval before send).
6. **Destroy quarantined stock** within 72 hours:
   ```http
   POST /api/v1/fims/inventory/recalls/{id}/destroy
   { "evidenceUrls": ["https://...", "https://..."], "witnessUserId": "usr_..." }
   ```
7. **Generate regulatory report:**
   ```http
   GET /api/v1/fims/inventory/recalls/{id}/report?format=fda-us
   ```
   (or `format=rasff-eu` / `format=gha-fda` depending on jurisdiction).
8. **Close the linked `FoodSafetyIncident`** after all quarantined stock is destroyed and the regulator confirms closure.
9. **Post-incident review** within 5 business days. Update `rootCauseAnalysis` and `correctiveActions` on the `FoodSafetyIncident`.

### Escalation

| Severity | Escalation |
|---|---|
| `LOW` | On-call food safety officer handles end-to-end. |
| `MEDIUM` | On-call FSO + catalog manager. |
| `HIGH` | On-call FSO + catalog manager + operations director. Notify regulator within 24 h. |
| `CRITICAL` | Page CEO + legal counsel. Notify regulator within 1 h. Public recall notice within 4 h. |

---

## 11. Inventory Audit Procedure

**Panel:** `FIMS Inventory → Audits`.

### Trigger

Scheduled audit (daily / weekly per location) or ad-hoc audit from QA.

### Procedure

1. **Start the audit:**
   ```http
   POST /api/v1/fims/inventory/audits
   { "auditType": "PERIODIC_COUNT", "locationId": "loc_kit_osu_02_dry", "auditorUserId": "usr_..." }
   ```
   The system snapshots all `InventoryStock` rows in scope as `expectedQty`.
2. **Count physical stock** via the mobile UI (or paper count sheet for offline locations).
3. **Submit counts** row by row:
   ```http
   POST /api/v1/fims/inventory/audits/{id}/counts
   { "catalogId": "clx_...", "batchId": "clx_batch_001", "countedQty": 11.8, "unit": "kg" }
   ```
4. The system computes variance per row. Rows with `|variancePct| > 5%` are flagged for review.
5. **Complete the audit:**
   ```http
   POST /api/v1/fims/inventory/audits/{id}/complete
   ```
6. For each flagged row, an `ADJUSTMENT_IN` or `ADJUSTMENT_OUT` movement is created in `PENDING_APPROVAL` state.
7. **Approve adjustments** (requires `food.inventory.adjust.approve` permission, typically a second user):
   ```http
   POST /api/v1/fims/inventory/adjustments/{id}/approve
   ```
8. The `InventoryAudit.completed.v1` event is emitted. The audit report is generated and stored.

### Action if alert fires (`InventoryAuditVarianceHigh`):

1. Identify the high-variance rows:
   ```sql
   SELECT catalogId, batchId, expectedQty, countedQty, varianceQty, variancePct, outcome
   FROM InventoryAuditRow
   WHERE auditId = '<id>' AND ABS(variancePct) > 5
   ORDER BY ABS(variancePct) DESC;
   ```
2. For each high-variance row, investigate:
   - Check the movement history during the audit window (`GET /api/v1/fims/inventory/stocks/{id}/movements?from=<auditStart>&to=<auditEnd>`). A `CONSUMPTION` during the count explains a negative variance.
   - Check for uncounted batches in the same location.
   - Check for theft / spoilage indicators (cross-reference `WasteRecord`).
3. If the variance is unexplained and > 10%, escalate to the location manager and trigger an `INVESTIGATION` audit type covering the broader location.

---

## 12. Reservation Expiry Lag

**Panel:** `FIMS Inventory → Reservations`.

| Metric | Source | Expected |
|---|---|---|
| `fims.inventory.reservation.expiry_lag_seconds` | `NOW() - expiresAt` for `HELD` reservations past `expiresAt` | < 60 s |
| `fims.inventory.reservation.held_count` | `COUNT(InventoryReservation WHERE status='HELD')` | < 10 000 per org |

### Action if alert fires (`ReservationExpiryLag`):

1. Check the `InventoryReservationExpiryJob` health:
   ```bash
   curl https://api.eks-food.com/api/v1/health/jobs/inventory-reservation-expiry
   ```
   Expected: `{"status":"healthy","lastRun":"...","durationMs":<5000}`.
2. If the job is unhealthy, restart the worker process:
   ```bash
   kubectl rollout restart deployment/eks-food-workers -n production
   ```
3. If the job is healthy but lag persists, check for long-running transactions holding locks on `InventoryReservation`:
   ```sql
   SELECT pid, state, query, query_start, NOW() - query_start AS duration
   FROM pg_stat_activity
   WHERE query ILIKE '%InventoryReservation%'
     AND state != 'idle'
   ORDER BY duration DESC;
   ```
4. If a query is held > 30 s, terminate it: `SELECT pg_terminate_backend(<pid>);` and investigate the calling service.

---

## 13. Cold-Chain Violation

**Panel:** `FIMS Inventory → Cold Chain`.

| Metric | Source | Expected |
|---|---|---|
| `fims.inventory.cold_chain.violation_count` | `COUNT(InventoryMovement WHERE metadata.coldChainViolation=true)` per hour | < 5 / hour |
| `fims.inventory.cold_chain.max_violation_duration_min` | longest violation in the last 24 h | < 30 min |

### Action if alert fires (`ColdChainViolationCritical`):

1. Identify the violating location and batch:
   ```sql
   SELECT locationId, batchId, catalogId, recordedTemperatureC,
          locationTempMin, locationTempMax,
          occurredAt, NOW() - occurredAt AS ageOfViolation
   FROM InventoryMovement im
   JOIN InventoryLocation il ON il.id = im.locationId
   WHERE im.metadata->>'coldChainViolation' = 'true'
     AND im.occurredAt > NOW() - INTERVAL '2 hours'
   ORDER BY im.occurredAt DESC;
   ```
2. Check the `ColdChainAdjustmentJob` log — has `expiresAt` been shortened or the batch condemned?
3. If the batch is now `EXPIRED` (condemned by Arrhenius), initiate a `WASTE` movement with `wasteCategory=SPOILED`.
4. Notify the facility manager. If the violation is ongoing (current temperature still out of range), dispatch a refrigeration technician.
5. For repeated violations at the same location, schedule a preventive maintenance visit and consider decommissioning the location (`POST /api/v1/fims/inventory/locations/{id}/decommission`).

---

## 14. Backup & Disaster Recovery

| Item | RPO | RTO | Strategy |
|---|---|---|---|
| Postgres primary | 5 min | 30 min | WAL streaming to S3; PITR available. |
| Object store (imports/exports) | 1 h | 4 h | Cross-region replication. |
| Recall records + regulatory reports | 0 (immutable) | 1 h | Snapshot to compliance-grade storage; 10-year retention. |

### Recovery procedure

1. Identify the failure scope (single-tenant data corruption vs. regional outage).
2. For single-tenant corruption: restore from PITR to a point before the corruption, extract the affected tenant's rows, and apply them to the production primary via a `CatalogImport` with `mode=UPSERT`.
3. For regional outage: fail over to the read replica in the secondary region, promote it to primary, and reconfigure the application connection string.

---

## 15. On-Call Quick Reference

### 15.1 Daily checklist (09:00 UTC)

- [ ] Acknowledge any `CRITICAL` alerts from the previous night.
- [ ] Review the `FIMS Overview` dashboard for anomaly spikes.
- [ ] Check the `Batch Expiring Soon` alert — coordinate with kitchen leads to use or waste expiring stock.
- [ ] Review the `Imports` dashboard — confirm no overnight supplier imports failed.
- [ ] Check the `Recall` dashboard — confirm no new recalls were initiated.

### 15.2 Useful commands

```bash
# Check overall FIMS health
curl https://api.eks-food.com/api/v1/health/fims

# List active recalls
curl https://api.eks-food.com/api/v1/fims/inventory/recalls?status=QUARANTINED,RECALLED

# List stuck imports
curl 'https://api.eks-food.com/api/v1/fims/imports?status=PARSED&olderThan=24h'

# Force re-run of the reservation expiry job (admin only)
curl -X POST https://api.eks-food.com/api/v1/admin/jobs/inventory-reservation-expiry/run

# Get the current cache hit ratios
curl https://api.eks-food.com/api/v1/admin/fims/cache-stats
```

### 15.3 Escalation matrix

| Issue | First responder | Escalate to |
|---|---|---|
| API latency / errors | On-call SRE | Platform engineering lead |
| Recall (any severity) | On-call food safety officer | Operations director → CEO (CRITICAL) |
| Import failure | On-call data engineer | Data engineering lead |
| Cold-chain violation | On-call SRE + facility manager | Operations director |
| Audit variance > 10% | Location manager | Operations director |
| Search latency | On-call SRE | M6 search on-call (delegated) |
| Worker DLQ backlog | On-call SRE | Platform engineering lead |

---

## 16. References

- `CATALOG_ARCHITECTURE.md` — catalog data model.
- `RECIPE_ENGINE_GUIDE.md` — recipe engine.
- `NUTRITION_ENGINE_GUIDE.md` — nutrition engine.
- `INVENTORY_GUIDE.md` — inventory data model.
- `BATCH_TRACEABILITY_GUIDE.md` — batch traceability and recall.
- `MEASUREMENT_SYSTEM_GUIDE.md` — measurement converter.
- `IMPORT_EXPORT_GUIDE.md` — import / export subsystem.
- M6 `docs/food-domain/OPERATIONAL_RUNBOOKS.md` — search/graph runbooks (FIMS delegates).
- M1 `docs/OPERATIONS_RUNBOOK.md` — platform-wide runbook.
- M1 `docs/EVENT_CONVENTIONS.md` — event naming for recall + audit events.
- M2 `docs/identity/AUTHORIZATION_POLICIES.md` — permission codes referenced throughout.
