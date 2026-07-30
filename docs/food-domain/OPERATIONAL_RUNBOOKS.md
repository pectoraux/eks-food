# Eks-Food Food Domain — Operational Runbooks

> **Audience:** On-call engineers, SREs, platform operators, data engineers. Read alongside `DOMAIN_MODEL_REFERENCE.md`, `GRAPH_ARCHITECTURE.md`, `SEARCH_ARCHITECTURE.md`, `API_DOCUMENTATION.md`, and the M1 `docs/OPERATIONS_RUNBOOK.md`.
>
> **Status:** Milestone 6. This document is the on-call runbook for the Eks-Food canonical domain platform. Every section maps to a Grafana dashboard panel, a Prometheus alert, and a runbook step.

---

## 1. Service Overview

The food-domain platform runs as part of the main Eks-Food Next.js application. It has no separate deployable service; its components are:

| Component | Process | Backed by |
|---|---|---|
| REST API (`/api/v1/food-domain/*`) | Next.js route handlers (Node.js) | Postgres (Prisma) |
| `GraphEngine` | In-process (Next.js) | Postgres `graph_nodes` / `graph_edges` tables |
| `SearchIndex` | In-process (Next.js) | Postgres `search_documents` table |
| `GraphProjectionWorker` | M1 `@eks/workers` consumer | Postgres + M1 `EventOutbox` |
| `SearchIndexWorker` | M1 `@eks/workers` consumer | Postgres + M1 `EventOutbox` |
| `GraphReconciliationJob` | M1 `@eks/workers` cron (nightly) | Postgres |
| `SearchDriftDetector` | M1 `@eks/workers` cron (nightly) | Postgres |
| `RetentionSweepJob` | M1 `@eks/workers` cron (daily) | Postgres |
| `CertificationExpiryJob` | M1 `@eks/workers` cron (daily) | Postgres |

All components share the main Postgres instance. A read replica is configured for search and graph queries; writes always go to the primary.

---

## 2. Dashboards & Alerts

### 2.1 Dashboards
| Dashboard | URL | Owner |
|---|---|---|
| Food Domain Overview | `https://grafana.eks-food.com/d/food-domain-overview` | Platform team |
| Graph Engine | `https://grafana.eks-food.com/d/food-domain-graph` | Platform team |
| Search Index | `https://grarana.eks-food.com/d/food-domain-search` | Platform team |
| API Latency | `https://grafana.eks-food.com/d/food-domain-api` | Platform team |
| Worker Lag | `https://grafana.eks-food.com/d/food-domain-workers` | Platform team |

### 2.2 Alerts
| Alert | Severity | Trigger | Runbook |
|---|---|---|---|
| `FoodDomainApiLatencyHigh` | warning | p99 > 500ms for 5 min | §5 |
| `FoodDomainApiLatencyCritical` | critical | p99 > 2s for 2 min | §5 |
| `FoodDomainApiErrorRateHigh` | warning | 5xx rate > 1% for 5 min | §6 |
| `GraphProjectionLagHigh` | warning | lag > 5s for 5 min | §3.2 |
| `GraphProjectionLagCritical` | critical | lag > 30s for 2 min | §3.2 |
| `GraphTraversalLatencyHigh` | warning | p99 > 200ms for 5 min | §3.3 |
| `GraphTraversalLatencyCritical` | critical | p99 > 1s for 2 min | §3.3 |
| `GraphDriftDetected` | warning | drift count > 100 | §3.4 |
| `SearchIndexLagHigh` | warning | lag > 2s for 5 min | §4.2 |
| `SearchIndexLagCritical` | critical | lag > 10s for 2 min | §4.2 |
| `SearchLatencyHigh` | warning | p99 > 200ms for 5 min | §4.3 |
| `SearchDriftDetected` | warning | drift ratio > 0.1% | §4.4 |
| `EntityCreationRateAnomaly` | warning | rate > 3× baseline for 10 min | §7 |
| `WorkerDQLengthHigh` | warning | DLQ length > 100 | §8 |
| `CertificationExpiryImminent` | info | certs expiring in <7 days | §11 |
| `FoodSafetyIncidentCriticalOpen` | critical | any CRITICAL incident in OPEN state | §12 |

---

## 3. Graph Runbooks

### 3.1 Graph size monitoring
**Panel:** `Food Domain Overview → Graph Size`.

| Metric | Source | Expected |
|---|---|---|
| `graph.node.count` | `SELECT COUNT(*) FROM graph_nodes` | Grows monotonically; alert if growth rate > 10% / day. |
| `graph.edge.count` | `SELECT COUNT(*) FROM graph_edges WHERE state='ACTIVE'` | Tracks node count; alert if edge/node ratio > 50. |
| `graph.node.count.by_type` | `SELECT entity_type, COUNT(*) ... GROUP BY entity_type` | Stable distribution; alert if any type grows > 5× in 24h. |
| `graph.edge.count.by_type` | `SELECT type, COUNT(*) ... GROUP BY type` | Stable distribution. |

**Action if alert fires:**
1. Check for a bulk import job (likely cause).
2. If no import job, query the largest tenants:
   ```sql
   SELECT organization_id, COUNT(*) AS nodes
   FROM graph_nodes
   WHERE organization_id IS NOT NULL
   GROUP BY organization_id
   ORDER BY nodes DESC
   LIMIT 10;
   ```
3. If a single tenant dominates, contact the tenant admin; they may have a runaway import.
4. If growth is across all tenants, suspect a bug in the projection worker creating duplicate nodes. Run the reconciliation job (§3.4).

### 3.2 Relationship count monitoring & projection lag
**Panel:** `Worker Lag → Graph Projection`.

| Metric | Source | Expected |
|---|---|---|
| `graph.projection.lag_ms` | `now() - max(last_synced_at)` on `graph_edges` | < 1000ms p99. |
| `graph.projection.pending_events` | M1 `EventOutbox` queue depth | < 100. |
| `graph.projection.throughput` | events processed / second | Tracks entity write rate. |

**Action if `GraphProjectionLagHigh` fires:**
1. Check worker health: `kubectl logs -l app=graph-projection-worker --tail=200`.
2. Check for a stuck consumer: `SELECT * FROM event_outbox WHERE event_type LIKE 'food-domain.relationship.%' ORDER BY occurred_at DESC LIMIT 10;`
3. If the worker is up but lag is growing, the consumer may be CPU-bound. Scale up: `kubectl scale deployment graph-projection-worker --replicas=3`.
4. If the worker is down, restart: `kubectl rollout restart deployment graph-projection-worker`.
5. After resolution, verify lag returns to < 1s.

**Action if `GraphProjectionLagCritical` fires:**
1. The graph is now too stale to serve traversal queries. The `GraphEngine` will return `503 graph-projection-lag` errors.
2. Page the on-call platform engineer.
3. Consider enabling the fallback: callers can read `Relationship` directly (slower but consistent).
4. Once the worker catches up, verify by checking `graph.projection.lag_ms < 1000`.

### 3.3 Graph traversal performance
**Panel:** `Graph Engine → Traversal Latency`.

| Metric | Source | Expected |
|---|---|---|
| `graph.traverse.latency_ms{depth=2}` | worker histogram | p50 < 10ms, p99 < 50ms. |
| `graph.traverse.latency_ms{depth=3}` | worker histogram | p50 < 30ms, p99 < 150ms. |
| `graph.traverse.latency_ms{depth=4}` | worker histogram | p50 < 100ms, p99 < 500ms. |
| `graph.shortest_path.latency_ms` | worker histogram | p50 < 10ms, p99 < 50ms. |
| `graph.traverse.result_truncated_count` | counter | < 1% of queries. |

**Action if `GraphTraversalLatencyHigh` fires:**
1. Identify the slow query: `SELECT query, count(*), avg(latency_ms) FROM graph_traverse_audit WHERE latency_ms > 200 GROUP BY query ORDER BY count DESC LIMIT 10;`
2. Common causes:
   - **Missing `edgeTypes` filter.** Patch the caller to pass `edgeTypes`.
   - **Depth ≥ 5.** Patch the caller to use a snapshot instead.
   - **Hot node with very high degree.** Cache the result (see `GRAPH_QUERY_GUIDE.md` §11.6).
3. If the slow query is legitimate, consider creating a graph snapshot for the affected tenant and routing the query to the snapshot.

**Action if `GraphTraversalLatencyCritical` fires:**
1. The graph may have grown past the Postgres recursive-CTE performance envelope.
2. Check `graph.node.count` and `graph.edge.count` — if approaching 50M / 500M, it's time to migrate to Neo4j (see `GRAPH_ARCHITECTURE.md` §12).
3. As a stopgap, lower the `maxTraversalDepth` ceiling for the affected tenant via `TenantConfiguration.foodDomain.graph.maxTraversalDepth`.

### 3.4 Graph drift remediation
**Panel:** `Graph Engine → Drift`.

Drift is detected by the nightly `GraphReconciliationJob` (see `GRAPH_ARCHITECTURE.md` §9.2):

| Drift type | Detection query | Remediation |
|---|---|---|
| Orphan `GraphNode` (no entity) | `SELECT gn.* FROM graph_nodes gn LEFT JOIN {entity_table} e ON e.id = gn.entity_id WHERE e.id IS NULL;` | Delete the orphan node. |
| Orphan `GraphEdge` (no `Relationship`) | `SELECT ge.* FROM graph_edges ge LEFT JOIN relationships r ON r.id = ge.relationship_id WHERE r.id IS NULL;` | Delete the orphan edge. |
| Stale `GraphEdge` (source `Relationship` is SUPERSEDED or DELETED but edge is ACTIVE) | `SELECT ge.* FROM graph_edges ge JOIN relationships r ON r.id = ge.relationship_id WHERE ge.state='ACTIVE' AND r.state != 'ACTIVE';` | Re-project the edge. |
| Degree mismatch | `SELECT gn.id, gn.degree_in, (SELECT COUNT(*) FROM graph_edges WHERE to_node_id=gn.id AND state='ACTIVE') AS actual FROM graph_nodes gn WHERE gn.degree_in != actual;` | Recompute degree. |

**Action if `GraphDriftDetected` fires:**
1. Trigger an immediate reconciliation: `POST /api/v1/food-domain/graph/reconcile` (requires `food-domain.graph.reconcile` permission).
2. Monitor the reconciliation job progress: `GET /api/v1/food-domain/graph/reconcile/{jobId}`.
3. If drift persists, suspect a bug in the `GraphProjectionWorker`. Capture a sample event and escalate to the platform team.

### 3.5 Graph snapshot management
**Panel:** `Graph Engine → Snapshots`.

| Metric | Source | Expected |
|---|---|---|
| `graph.snapshot.count` | `SELECT COUNT(*) FROM graph_snapshots` | Grows by ~1 / tenant / day (nightly DR snapshot). |
| `graph.snapshot.total_size_bytes` | sum of `storage_key` object sizes | Alert if > 500 GB. |
| `graph.snapshot.age_hours_max` | `now() - max(created_at)` per tenant | < 30 hours (nightly cadence). |

**Retention:** Snapshots are retained 30 days for tenant nightly snapshots, 7 years for compliance-triggered snapshots (audit, regulator request, incident).

**Action if snapshot creation fails:**
1. Check object-store connectivity (S3/MinIO).
2. Check for a tenant with an exceptionally large graph (> 10M edges).
3. For large tenants, consider scoping the snapshot to a subgraph.

---

## 4. Search Runbooks

### 4.1 Search index size monitoring
**Panel:** `Search Index → Index Size`.

| Metric | Source | Expected |
|---|---|---|
| `search.document.count` | `SELECT COUNT(*) FROM search_documents` | Tracks entity count. |
| `search.document.count.by_type` | `SELECT entity_type, COUNT(*) ... GROUP BY entity_type` | Stable distribution. |
| `search.index.size_bytes` | `pg_total_relation_size('search_documents')` | Alert if > 200 GB. |
| `search.index.largest_tenant` | tenant with most documents | Alert if > 50M. |

### 4.2 Search indexing lag
**Panel:** `Worker Lag → Search Indexing`.

| Metric | Source | Expected |
|---|---|---|
| `search.index.lag_ms` | `now() - max(updated_at)` on `search_documents` | < 2000ms p99. |
| `search.index.pending_events` | M1 `EventOutbox` queue depth for `food-domain.*.created/updated/deleted.v1` | < 100. |
| `search.index.throughput` | events processed / second | Tracks entity write rate. |
| `search.index.error_count` | counter | < 0.1% of events. |

**Action if `SearchIndexLagHigh` fires:**
1. Check worker health: `kubectl logs -l app=search-index-worker --tail=200`.
2. Check for a stuck event: `SELECT * FROM event_outbox WHERE event_type LIKE 'food-domain.recipe.%' ORDER BY occurred_at DESC LIMIT 10;`
3. Check for a failing builder: `SELECT * FROM search_indexing_errors ORDER BY occurred_at DESC LIMIT 10;`
4. If a specific builder is failing (e.g. the `MenuItem` builder), disable that builder temporarily via `FeatureFlag food-domain.search.index.{entityType}=false` and re-enable after fix.
5. After resolution, trigger a partial reindex for the affected entity type: `POST /api/v1/food-domain/search/reindex { "entityTypes": ["MenuItem"] }`.

**Action if `SearchIndexLagCritical` fires:**
1. Search results are now significantly stale. The UI may show "results may be out of date" banners.
2. Page the on-call platform engineer.
3. As a stopgap, disable faceted search for the affected entity types (facets are most sensitive to staleness).

### 4.3 Search latency
**Panel:** `Search Index → Query Latency`.

| Metric | Source | Expected |
|---|---|---|
| `search.query.latency_ms{mode=full-text}` | worker histogram | p50 < 25ms, p99 < 100ms. |
| `search.query.latency_ms{mode=fuzzy}` | worker histogram | p50 < 60ms, p99 < 250ms. |
| `search.autocomplete.latency_ms` | worker histogram | p50 < 8ms, p99 < 30ms. |
| `search.query.result_count` | histogram | Average ~20-50 results. |
| `search.query.zero_result_count` | counter | < 5% of queries. |

**Action if latency exceeds SLO:**
1. Check for slow queries: `SELECT query, count(*), avg(latency_ms) FROM search_query_audit WHERE latency_ms > 200 GROUP BY query ORDER BY count DESC LIMIT 10;`
2. Common causes:
   - **Missing `entityTypes` filter.** Patch the caller.
   - **`locale: "*"` queries.** Patch the caller to specify a locale.
   - **Fuzzy + facets combined.** Patch the caller to drop one.
   - **Deep pagination (`page > 10`).** Patch the caller to use cursor.
3. Check Postgres load: high CPU may indicate the index is no longer fitting in `shared_buffers`.
4. Consider migrating the tenant to Meilisearch (see `SEARCH_ARCHITECTURE.md` §6.4) if load is sustained.

### 4.4 Search drift
**Panel:** `Search Index → Drift`.

The nightly `SearchDriftDetector` samples 1000 entities per tenant and verifies the search index matches the canonical entity. Drift ratio > 0.1% triggers an alert.

**Action if `SearchDriftDetected` fires:**
1. Identify the affected entity type and tenant: `SELECT * FROM search_drift_report ORDER BY detected_at DESC LIMIT 10;`
2. Trigger a reindex for the affected scope:
   ```bash
   curl -X POST https://api.eks-food.com/api/v1/food-domain/search/reindex \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -d '{"scope":{"organizationId":"org-123","entityTypes":["Recipe"]}}'
   ```
3. Monitor the reindex: `GET /api/v1/food-domain/search/reindex/{jobId}`.
4. If drift recurs, suspect a bug in the `SearchIndexWorker` event handling (out-of-order events, stale-version handling).

---

## 5. API Latency Runbook

**Panel:** `API Latency`.

### 5.1 Identify slow endpoints
```sql
SELECT
  route,
  method,
  COUNT(*) AS requests,
  AVG(latency_ms) AS avg_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99_ms
FROM api_request_audit
WHERE route LIKE '/api/v1/food-domain/%'
  AND occurred_at > NOW() - INTERVAL '1 hour'
GROUP BY route, method
ORDER BY p99_ms DESC
LIMIT 20;
```

### 5.2 Common causes & remediation
| Symptom | Likely cause | Remediation |
|---|---|---|
| Single endpoint slow | N+1 query | Add `include` to Prisma call; verify with `EXPLAIN ANALYZE`. |
| All endpoints slow | Postgres load | Check `pg_stat_activity` for long-running queries; check `pg_locks` for blocking. |
| Write endpoints slow | EntityVersion write amplification | Batch writes; check `entity_version` table size. |
| List endpoints slow | Missing index | Add Prisma `@@index` and run migration. |
| Graph endpoints slow | See §3.3. | |
| Search endpoints slow | See §4.3. | |

### 5.3 Connection pool
The food-domain uses a dedicated Prisma client with a 30-connection pool. If pool exhaustion is suspected:
```sql
SELECT state, COUNT(*) FROM pg_stat_activity WHERE application_name LIKE '%food-domain%' GROUP BY state;
```
- `idle` should be < pool size (30).
- `active` should be < pool size.
- `idle in transaction` is a red flag — indicates a transaction leak.

---

## 6. Error Rate Runbook

**Panel:** `Food Domain Overview → Error Rate`.

### 6.1 Identify the failing endpoint
```sql
SELECT
  route,
  status_code,
  error_code,
  COUNT(*) AS count
FROM api_request_audit
WHERE status_code >= 500
  AND occurred_at > NOW() - INTERVAL '15 minutes'
GROUP BY route, status_code, error_code
ORDER BY count DESC
LIMIT 20;
```

### 6.2 Common 5xx causes
| Error | Cause | Remediation |
|---|---|---|
| `food-domain.internal` | Unhandled exception | Check logs for stack trace; patch. |
| `food-domain.graph-projection-lag` | Projection worker lag | See §3.2. |
| Postgres connection error | Pool exhaustion | See §5.3. |
| Prisma constraint violation | Bug in repository | Check the constraint; add validation. |

### 6.3 4xx spikes
4xx errors are not page-worthy but should be monitored. A spike in `409 state-transition` may indicate a UI bug; a spike in `422 metadata-validation` may indicate a tenant misconfiguration.

---

## 7. Entity Creation Rate Monitoring

**Panel:** `Food Domain Overview → Entity Creation Rates`.

Each entity type has a baseline creation rate (e.g. ~50 recipes/hour for a typical tenant). Alert if the rate exceeds 3× baseline for 10 minutes.

### 7.1 Common causes
- **Bulk import job** (legitimate). Verify with the tenant admin.
- **Bot/script creating entities** (potentially abusive). Rate-limit the caller.
- **Bug causing duplicate creations** (e.g. retry storm). Check `Idempotency-Key` usage.

### 7.2 Investigation
```sql
SELECT
  entity_type,
  created_by,
  COUNT(*) AS creations
FROM entity_versions
WHERE operation = 'CREATE'
  AND changed_at > NOW() - INTERVAL '1 hour'
GROUP BY entity_type, created_by
ORDER BY creations DESC
LIMIT 20;
```

If a single `created_by` dominates, check the caller's `User-Agent` and `IP` — if it's a script, rate-limit or suspend the token.

---

## 8. Worker DLQ Management

**Panel:** `Worker Lag → DLQ`.

### 8.1 Check DLQ depth
```sql
SELECT event_type, COUNT(*) FROM event_dlq WHERE event_type LIKE 'food-domain.%' GROUP BY event_type ORDER BY count DESC;
```

### 8.2 Inspect a DLQ message
```sql
SELECT * FROM event_dlq WHERE event_type LIKE 'food-domain.%' ORDER BY enqueued_at DESC LIMIT 10;
```
The `failure_reason` column captures the last exception.

### 8.3 Replay
After fixing the underlying issue, replay the DLQ:
```bash
curl -X POST https://api.eks-food.com/api/v1/replay \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"filter":{"eventTypePrefix":"food-domain."},"batchSize":100}'
```
The replay worker re-publishes the events to the `EventOutbox` for re-processing.

### 8.4 Purge (after verified replay)
```sql
DELETE FROM event_dlq WHERE event_type LIKE 'food-domain.%' AND replayed = true;
```

---

## 9. Import / Export Procedures

### 9.1 Export a tenant's data
For data portability, migration, or audit:

```bash
curl -X POST https://api.eks-food.com/api/v1/food-domain/export \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{
    "entityTypes": ["Ingredient", "Recipe", "Supplier", "CookProfile"],
    "format": "jsonld",
    "scope": "tenant"
  }'
# → { "jobId": "export-123" }
```

Poll:
```bash
curl https://api.eks-food.com/api/v1/food-domain/export/export-123 \
  -H "Authorization: Bearer $ADMIN_JWT"
# → { "state": "completed", "downloadUrl": "https://...", "expiresAt": "..." }
```

The export is a JSON-LD file with `@context` referencing `https://schema.eks-food.com/graph/v1`. It includes entities, relationships, and (optionally) entity versions.

### 9.2 Import
For restoring from backup or migrating from another tenant:

```bash
curl -X POST https://api.eks-food.com/api/v1/food-domain/import \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -F "file=@export.jsonld" \
  -F "mode=upsert" \
  -F "dryRun=false"
# → { "jobId": "import-456" }
```

Modes:
- `upsert` — create or update (default).
- `create-only` — skip if entity exists.
- `replace` — delete-then-create (destructive; requires confirmation).

The import job processes entities in dependency order (geography → ingredients → recipes → menus → ...). Each entity is written within a transaction; failures are isolated to the failing entity and reported in the job result.

### 9.3 Validation
The import job validates every entity against the Zod schema and the tenant's `metadata` schema. Invalid entities are rejected and reported in `GET /api/v1/food-domain/import/{jobId}/errors`.

### 9.4 Idempotency
The import job is idempotent: re-importing the same file produces the same result (entities are upserted by `id`; `version` is incremented only if the payload differs).

---

## 10. Version History Recovery

### 10.1 List versions
```bash
curl https://api.eks-food.com/api/v1/food-domain/recipes/550e.../versions \
  -H "Authorization: Bearer $JWT"
```

### 10.2 Get a specific version
```bash
curl https://api.eks-food.com/api/v1/food-domain/recipes/550e.../versions/3 \
  -H "Authorization: Bearer $JWT"
```
Returns the full entity snapshot at version 3, including `diff` from version 2.

### 10.3 Restore from version
```bash
curl -X POST https://api.eks-food.com/api/v1/food-domain/recipes/550e.../versions/3/restore \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: restore-$(uuidgen)" \
  -d '{"reason": "Accidental deletion of step 4"}'
```

The restore operation:
1. Reads the version-3 snapshot.
2. Compares to the current entity.
3. Writes a new `EntityVersion` with `operation = 'RESTORE'` and `metadata = { restoredFromVersion: 3, reason: '...' }`.
4. Updates the entity to match the version-3 snapshot (incrementing `version`).
5. Emits `food-domain.recipe.restored.v1` event.
6. The search index and graph projection update asynchronously.

### 10.4 Compliance holds
For entities under a compliance hold (e.g. a `FoodSafetyIncident` under investigation), restore is blocked. The compliance officer must release the hold before restore can proceed.

---

## 11. Audit Timeline Inspection

### 11.1 Query the audit timeline
```bash
curl "https://api.eks-food.com/api/v1/food-domain/audit?entityType=Recipe&entityId=550e...&from=2024-01-01T00:00:00Z&to=2024-12-31T23:59:59Z" \
  -H "Authorization: Bearer $JWT"
```

Returns a merged, time-sorted timeline of:
- `EntityVersion` rows (entity snapshots).
- `AuditLog` entries (M2 — permission checks, state transitions, manual operations).
- `EventOutbox` rows (domain events emitted).

### 11.2 Filtering
- `?actorId=user-123` — only actions by this user.
- `?operation=STATE_TRANSITION` — only state transitions.
- `?eventType=food-domain.recipe.published.v1` — only this event type.

### 11.3 Export for compliance
```bash
curl "https://api.eks-food.com/api/v1/food-domain/audit/export?entityType=Recipe&entityId=550e...&from=...&to=..." \
  -H "Authorization: Bearer $JWT" \
  -o audit-timeline.json
```
Produces a signed PDF or JSON suitable for regulator submission. The export is itself audited as `food-domain.audit.export`.

---

## 12. Localization Management

### 12.1 Inspecting localized fields
```sql
SELECT id, name->'en' AS en, name->'sw' AS sw, name->'fr' AS fr
FROM ingredients
WHERE name->'en' IS NULL OR name->'sw' IS NULL
LIMIT 100;
```
Returns ingredients missing English or Swahili translations.

### 12.2 Bulk translation update
For adding a new locale to existing entities:

```bash
cat > translations.json <<EOF
[
  { "entityType": "Ingredient", "entityId": "550e...", "field": "name", "locale": "sw", "value": "Nyanya" },
  { "entityType": "Ingredient", "entityId": "660e...", "field": "name", "locale": "sw", "value": "Kitungu" }
]
EOF

curl -X POST https://api.eks-food.com/api/v1/food-domain/localizations/bulk \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d @translations.json
```

Each update creates an `EntityVersion` row and re-indexes the search document for the affected entity.

### 12.3 Locale fallback verification
After adding a new locale, verify the fallback chain works:
```bash
curl -H "Accept-Language: sw" https://api.eks-food.com/api/v1/food-domain/ingredients/550e... \
  -H "Authorization: Bearer $JWT"
```
The response should include the Swahili name. If the entity lacks a Swahili translation, the response should fall back to English (the tenant default) with `Content-Language: en`.

### 12.4 Tenant default locale
Change the tenant's default locale via M2 `TenantConfiguration`:
```bash
curl -X PATCH https://api.eks-food.com/api/v1/organizations/config \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"foodDomain":{"defaultLocale":"sw"}}'
```
Existing entities are not retroactively translated; the new default applies to new entities and to fallback resolution.

---

## 13. Retention & Data Lifecycle

### 13.1 Retention policy
| Entity type | Soft-delete retention | Hard-delete retention | Notes |
|---|---|---|---|
| `CustomerProfile` | 30 days | 7 years (PII pseudonymized) | GDPR compliance. |
| `CookProfile` | 30 days | 7 years | |
| `Recipe`, `MenuItem`, `Menu` | 90 days | 3 years | |
| `Ingredient` | never (deprecate only) | never | Global reference data. |
| `InventoryBatch` | 90 days | 3 years | |
| `Certification`, `Inspection` | never | 7 years | Regulatory. |
| `FoodSafetyIncident` | never | 7 years | Regulatory. |
| `EntityVersion` | (follows entity) | (follows entity) | Audit trail. |
| `AuditLog` | never | 7 years | M2 retention. |
| `GraphSnapshot` (DR) | 30 days | — | |
| `GraphSnapshot` (compliance) | never | 7 years | |

### 13.2 The `RetentionSweepJob`
Runs daily. For each entity past its hard-delete retention:
1. Verifies no compliance hold is in place.
2. Hard-deletes the entity row.
3. Hard-deletes the corresponding `EntityVersion` rows (only after the entity's hard-delete retention has elapsed — `EntityVersion` rows follow the entity's retention).
4. Emits `food-domain.{entity}.hard-deleted.v1` event.
5. The `SearchIndexWorker` and `GraphProjectionWorker` delete the corresponding index entry / graph node.

### 13.3 Manual purge
For a GDPR erasure request:
```bash
curl -X POST https://api.eks-food.com/api/v1/food-domain/customers/550e.../purge \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"reason": "GDPR erasure request", "requestRef": "DSR-2024-123"}'
```
This:
1. Pseudonymizes PII fields (replaces `displayName` with `[deleted]`, clears `metadata`).
2. Hard-deletes the entity (bypassing soft-delete retention).
3. Removes search index entries.
4. Removes graph nodes / edges.
5. Records the purge in the `AuditLog` with `metadata.requestRef`.

---

## 14. Certification Expiry Job

### 14.1 Job behavior
The `CertificationExpiryJob` runs daily and:
1. Finds all `Certification` rows with `state = 'ACTIVE'` and `expiresAt` within the next 30 days.
2. For each, emits `food-domain.certification.expiring.v1` with `daysUntilExpiry`.
3. Subscribers (M2 `@eks/notifications`) notify the certified subject and the tenant admin.
4. At `expiresAt`, transitions the certification to `state = 'EXPIRED'` and emits `food-domain.certification.expired.v1`.

### 14.2 Action if `CertificationExpiryImminent` fires
1. Review the list: `GET /api/v1/food-domain/certifications/expiring?withinDays=7`.
2. For each, verify the subject has been notified (check the `NotificationLog`).
3. If the subject has renewed, upload the new certification via `POST /api/v1/food-domain/certifications` (with the new `expiresAt`).
4. The old certification will auto-expire on its `expiresAt`; no manual action needed.

### 14.3 Critical certifications
Certifications of `kind = FOOD_SAFETY_LEVEL_2` or `HACCP` expiring within 7 days trigger a `CertificationExpiryCritical` alert. Action:
1. Verify the affected cook is not actively scheduled for inspections.
2. Notify the cook's primary restaurant's admin.
3. If the cook continues to work past expiry, suspend the cook's `works_at` edges via `POST /api/v1/food-domain/cooks/{id}/suspend` with `reason = "certification-expired"`.

---

## 15. Food Safety Incident Response

### 15.1 Critical incident
When a `FoodSafetyIncident` with `severity = CRITICAL` is created (`state = OPEN`), the `FoodSafetyIncidentCriticalOpen` alert fires.

### 15.2 Response procedure
1. Acknowledge the alert in PagerDuty within 15 minutes.
2. Open the incident: `GET /api/v1/food-domain/food-safety-incidents/{id}`.
3. Identify affected entities via graph traversal:
   ```bash
   curl -X POST https://api.eks-food.com/api/v1/food-domain/graph/traverse \
     -d '{"start":{"entityType":"Ingredient","entityId":"tomato-uuid"},"direction":"inbound","edgeTypes":["contains","featured_in","derived_from","stocks"],"maxDepth":4,"return":"subgraph"}'
   ```
4. If a recall is needed, set the affected `InventoryBatch` rows to `state = DISCARDED` and the affected `MenuItem`s to `available = false`.
5. Transition the incident to `INVESTIGATING` then `RESOLVED` as the response progresses.
6. For regulator notification, use the M4 government connector (see `docs/connectors/GOVERNMENT_INTEGRATION.md`).

### 15.3 Post-incident
1. Transition the incident to `CLOSED`.
2. The incident record is retained for 7 years (regulatory).
3. Conduct a post-mortem; link the post-mortem document in `FoodSafetyIncident.metadata.postMortemUrl`.

---

## 16. Backup & Disaster Recovery

### 16.1 Daily backup
- Postgres: daily snapshot via managed Postgres automated backup (35-day retention).
- Graph snapshots: nightly per-tenant, 30-day retention (§3.5).
- Search index: rebuilt from canonical entities; no separate backup needed.

### 16.2 Recovery time objectives
| Component | RPO | RTO |
|---|---|---|
| Postgres (canonical entities) | 5 min | 30 min |
| Graph projection | 5 min | 1 hour (rebuild from events) |
| Search index | 5 min | 4 hours (full reindex) |
| Audit log | 5 min | 30 min |

### 16.3 Disaster recovery procedure
1. Restore Postgres from the latest snapshot.
2. Replay the M1 `EventOutbox` from the snapshot timestamp to `now()` to catch up any missed events.
3. Verify the canonical entities: `GET /api/v1/food-domain/graph/stats` — node count should match pre-incident baseline.
4. Trigger a graph reconciliation (§3.4) to repair any projection drift.
5. Trigger a search reindex (§4.4) for the affected tenants.
6. Verify search and graph latency SLOs are met.
7. Communicate resolution to tenants.

---

## 17. On-Call Quick Reference

### 17.1 First responder checklist
1. Acknowledge the alert.
2. Open the relevant dashboard (§2.1).
3. Identify the failing component (API / graph / search / worker).
4. Follow the runbook section for that component.
5. If unresolved in 15 minutes, page the next on-call.

### 17.2 Useful commands
```bash
# Worker health
kubectl get pods -l app=graph-projection-worker
kubectl get pods -l app=search-index-worker

# Tail worker logs
kubectl logs -l app=graph-projection-worker --tail=200 -f
kubectl logs -l app=search-index-worker --tail=200 -f

# Scale a worker
kubectl scale deployment graph-projection-worker --replicas=5

# Check Postgres connections
kubectl exec -it postgres-0 -- psql -U postgres -c "SELECT state, COUNT(*) FROM pg_stat_activity GROUP BY state;"

# Trigger graph reconciliation
curl -X POST https://api.eks-food.com/api/v1/food-domain/graph/reconcile -H "Authorization: Bearer $ADMIN_JWT"

# Trigger search reindex
curl -X POST https://api.eks-food.com/api/v1/food-domain/search/reindex -H "Authorization: Bearer $ADMIN_JWT" -d '{"scope":{"organizationId":"org-123"}}'

# Check projection lag
curl https://api.eks-food.com/api/v1/food-domain/graph/stats -H "Authorization: Bearer $JWT"
```

### 17.3 Escalation
| Issue | Escalate to |
|---|---|
| Postgres outage | DBA on-call |
| Worker unrecoverable | Platform engineering lead |
| Tenant data loss | Engineering director + legal |
| Security incident | Security on-call (see `docs/SECURITY.md`) |
| Compliance/regulatory | Compliance officer |

---

## 18. See Also

- `DOMAIN_MODEL_REFERENCE.md` — entity definitions for context.
- `GRAPH_ARCHITECTURE.md` §11 — performance characteristics.
- `SEARCH_ARCHITECTURE.md` §10 — search latency optimization.
- `API_DOCUMENTATION.md` §15 — error catalog.
- `docs/OPERATIONS_RUNBOOK.md` — M1 general operations.
- `docs/identity/AUDIT_AND_COMPLIANCE.md` — audit log retention.
- `docs/identity/DISASTER_RECOVERY.md` — M2 disaster recovery.
- `docs/integration/OPERATIONS_RUNBOOK.md` — M4 connector operations.
- `docs/integration/DISASTER_RECOVERY.md` — M4 DR procedures.
- `docs/SECURITY.md` — security incident response.
