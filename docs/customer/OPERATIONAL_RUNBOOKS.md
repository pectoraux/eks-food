# Eks-Food Customer Platform — Operational Runbooks

> **Audience:** On-call engineers, SREs, customer platform operators, support engineers, privacy officers. Read alongside `PLATFORM_ARCHITECTURE.md`, `HOUSEHOLD_MODEL_GUIDE.md`, `PREFERENCE_INTELLIGENCE_GUIDE.md`, `MEAL_PLANNING_GUIDE.md`, `PANTRY_MANAGEMENT_GUIDE.md`, `SHOPPING_LIST_GUIDE.md`, `PRIVACY_PERMISSIONS_GUIDE.md`, and the M1 `docs/OPERATIONS_RUNBOOK.md`.
>
> **Status:** Milestone 8 (Customer Platform). This document is the on-call runbook for the Customer Platform. Every section maps to a Grafana dashboard panel, a Prometheus alert, and a runbook step.

---

## 1. Service Overview

The Customer Platform runs as part of the main Eks-Food Next.js application (no separate deployable service). Its components:

| Component | Process | Backed by |
|---|---|---|
| REST API (`/api/v1/customer/*`) | Next.js route handlers (Node.js) | Postgres (Prisma) |
| `HouseholdService` | In-process (Next.js) | Postgres + LRU cache |
| `PreferenceService` | In-process (Next.js) | Postgres + LRU cache + M6 GraphEngine |
| `MealPlanService` | In-process (Next.js) | Postgres + M5 CalendarConnector |
| `PantryService` | In-process (Next.js) | Postgres + M7 InventoryService (linked mode) |
| `ShoppingListService` | In-process (Next.js) | Postgres + SSE hub + M5 MerchantConnector |
| `ReviewService` | In-process (Next.js) | Postgres + M3 profanity filter |
| `PrivacyService` | In-process (Next.js) + async workers | Postgres + object store (S3) |
| `HouseholdPermissionResolver` | In-process (Next.js) | Postgres + LRU cache |
| `HouseholdPermissionSnapshotReconciler` | M1 cron (daily 03:00 UTC) | Postgres |
| `PreferenceDerivationJob` | M1 cron (nightly 02:00 UTC) | Postgres |
| `PreferenceDecayJob` | M1 cron (nightly 02:30 UTC) | Postgres |
| `PantryExpirationScannerJob` | M1 cron (every 6h) | Postgres + M5 NotificationConnector |
| `PantryCommonStockJob` | M1 cron (daily 04:00 UTC) | Postgres |
| `MealPlanCalendarSyncJob` | M1 cron (every 5 min) | Postgres + M5 CalendarConnector |
| `MealPlanActivationJob` | M1 cron (hourly) | Postgres |
| `ShoppingListRecurringJob` | M1 cron (every 5 min) | Postgres |
| `ReviewAutoFlagJob` | M1 cron (hourly) | Postgres + M3 profanity filter |
| `CustomerDataRetentionJob` | M1 cron (daily 02:00 UTC) | Postgres + object store |
| `HouseholdPurgeJob` | M1 cron (daily 03:30 UTC) | Postgres |
| `PrivacyExportWorker` | M1 `@eks/workers` consumer | Postgres + object store |
| `PrivacyDeletionWorker` | M1 `@eks/workers` consumer | Postgres |

All components share the main Postgres instance. A read replica is configured for preference resolution and audit log queries; writes always go to the primary.

---

## 2. Dashboards & Alerts

### 2.1 Dashboards

| Dashboard | URL | Owner |
|---|---|---|
| Customer Overview | `https://grafana.eks-food.com/d/customer-overview` | Platform team |
| Customer Households | `https://grafana.eks-food.com/d/customer-households` | Platform team |
| Customer Preferences | `https://grafana.eks-food.com/d/customer-preferences` | Platform team |
| Customer Meal Planning | `https://grafana.eks-food.com/d/customer-meal-planning` | Platform team |
| Customer Pantry | `https://grafana.eks-food.com/d/customer-pantry` | Platform team |
| Customer Shopping Lists | `https://grafana.eks-food.com/d/customer-shopping-lists` | Platform team |
| Customer Reviews | `https://grafana.eks-food.com/d/customer-reviews` | Platform team |
| Customer Privacy | `https://grafana.eks-food.com/d/customer-privacy` | Platform team + DPO |
| Customer Notifications | `https://grafana.eks-food.com/d/customer-notifications` | Platform team |

### 2.2 Alerts

| Alert | Severity | Trigger | Runbook |
|---|---|---|---|
| `CustomerApiLatencyHigh` | warning | p99 > 500 ms for 5 min | §5 |
| `CustomerApiLatencyCritical` | critical | p99 > 2 s for 2 min | §5 |
| `CustomerApiErrorRateHigh` | warning | 5xx rate > 1% for 5 min | §6 |
| `HouseholdGrowthAnomaly` | warning | new households/day > 3× 7-day average | §7 |
| `HouseholdGrowthDrop` | warning | new households/day < 50% of 7-day average | §7 |
| `HouseholdDissolutionSpike` | warning | dissolutions/day > 10 | §8 |
| `MealPlanUsageDrop` | warning | meal plans created/day < 50% week-over-week | §9 |
| `MealPlanCalendarSyncFailures` | warning | sync failure rate > 5% for 1h | §10 |
| `PantryExpirationBacklog` | warning | items in EXPIRING state > 500 across all tenants | §11 |
| `PantryExpirationLag` | warning | `PantryExpirationScannerJob` lag > 6h | §11 |
| `ShoppingListConflictRate` | warning | conflict rate > 5% of all item writes | §12 |
| `ShoppingListSSEConnectionDrop` | warning | SSE disconnect rate > 20% in 5 min | §12 |
| `PreferenceDerivationLag` | warning | `PreferenceDerivationJob` lag > 2h | §13 |
| `PreferenceDecayLag` | warning | `PreferenceDecayJob` lag > 24h | §13 |
| `ReviewModerationBacklog` | warning | reviews in PENDING state > 200 older than 24h | §14 |
| `ReviewAutoFlagMisfire` | warning | auto-flag rate > 30% (false positives) | §14 |
| `AddressValidationSuccessLow` | warning | geocoding success rate < 90% | §15 |
| `NotificationDeliveryFailure` | warning | notification delivery failure rate > 5% per channel | §16 |
| `ChildSafetyCheckFailure` | critical | any `CUSTOMER_CHILD_SAFETY_CHECK_FAILED` audit action | §17 |
| `PermissionSnapshotDrift` | warning | `HouseholdPermissionSnapshotReconciler` drift > 10 rows | §18 |
| `PrivacyExportJobStuck` | warning | export job in QUEUED state > 30 min | §19 |
| `PrivacyDeletionPastSchedule` | critical | deletion job past `scheduledPurgeAt` not completed | §19 |
| `CustomerDataRetentionLag` | warning | `CustomerDataRetentionJob` lag > 24h | §20 |
| `HouseholdPurgeLag` | warning | `HouseholdPurgeJob` lag > 48h | §20 |
| `MediaUploadQuarantineRate` | warning | quarantine rate > 1% of uploads | §21 |
| `TenantDataLeakSuspected` | critical | cross-tenant query detected by M2 RLS audit | §22 |

---

## 3. Household Growth Monitoring

**Panel:** `Customer Households → Growth`.

| Metric | Source | Expected |
|---|---|---|
| `customer.households.created.count` | `SELECT COUNT(*) FROM Household WHERE createdAt >= :start AND createdAt < :end AND deletedAt IS NULL` per day | baseline ± 50% |
| `customer.households.dissolved.count` | `SELECT COUNT(*) FROM Household WHERE dissolvedAt >= :start AND dissolvedAt < :end` per day | < 5% of created count |
| `customer.households.active.total` | `SELECT COUNT(DISTINCT householdId) FROM HouseholdMember WHERE status='ACTIVE' AND deletedAt IS NULL` | grows over time |
| `customer.household.avg_members` | `SELECT AVG(member_count) FROM (SELECT householdId, COUNT(*) AS member_count FROM HouseholdMember WHERE status='ACTIVE' GROUP BY householdId) sub` | 2.0–4.0 (FAMILY/ROOMMATES typical) |

**Runbook (§7 — HouseholdGrowthAnomaly):**

1. Check the M2 `Organization` dashboard for a parallel spike (a new tenant onboarding may be driving growth — not an anomaly).
2. Check the M5 `MapsConnector` health (a geocoding outage can mask underlying growth by failing address creation).
3. Query the new-household distribution by `householdType`:
   ```sql
   SELECT householdType, COUNT(*) FROM Household
   WHERE createdAt >= NOW() - INTERVAL '1 day' AND deletedAt IS NULL
   GROUP BY householdType;
   ```
4. If a single `householdType` is spiking (e.g. all new households are `INSTITUTION`), investigate the linked organization — likely a bulk onboarding.
5. If growth is organic but unusually high, alert the product team (possible marketing campaign driving signups).
6. If growth is suspicious (many households with the same `defaultAddressId` or `createdBy`), escalate to security — possible bot activity.

---

## 4. Meal Planning Usage Monitoring

**Panel:** `Customer Meal Planning → Usage`.

| Metric | Source | Expected |
|---|---|---|
| `customer.meal_plans.created.count` | `SELECT COUNT(*) FROM MealPlan WHERE createdAt >= :start AND createdAt < :end AND deletedAt IS NULL` per day | grows week-over-week |
| `customer.meal_plans.committed.count` | `SELECT COUNT(*) FROM MealPlan WHERE committedAt >= :start AND committedAt < :end` per day | ≥ 60% of created |
| `customer.meal_plans.active.total` | `SELECT COUNT(*) FROM MealPlan WHERE status='ACTIVE'` | varies; weekday peak |
| `customer.meal_calendar.entries.created.count` | `SELECT COUNT(*) FROM MealCalendar WHERE createdAt >= :start AND createdAt < :end` per day | grows with meal plans |
| `customer.meal_plans.calendar_sync.success_rate` | `(SYNCED count) / (SYNCED + FAILED count)` over 1h | ≥ 95% |
| `customer.meal_plans.completion_rate` | `(COMPLETED count) / (ACTIVATED count)` over 30 days | ≥ 70% |

**Runbook (§9 — MealPlanUsageDrop):**

1. Check the M5 `CalendarConnector` health — if calendar sync is failing, customers may be abandoning plans.
2. Check the M7 `RecipeVersion` availability — if recipes are unpublishing, meal plans can't reference them.
3. Query the plan creation funnel:
   ```sql
   SELECT status, COUNT(*) FROM MealPlan
   WHERE createdAt >= NOW() - INTERVAL '7 days' AND deletedAt IS NULL
   GROUP BY status;
   ```
4. If many plans are stuck in `DRAFT` (not committed), check the M8 UI for plan-commit errors.
5. If many plans are `CANCELLED` after commit, query the cancel reasons:
   ```sql
   SELECT metadata->>'cancelReason', COUNT(*) FROM MealPlan
   WHERE status='CANCELLED' AND cancelledAt >= NOW() - INTERVAL '7 days'
   GROUP BY metadata->>'cancelReason';
   ```
6. Engage the product team if no platform issue is identified.

---

## 5. API Latency Runbook

**Alert:** `CustomerApiLatencyHigh` / `CustomerApiLatencyCritical`.

1. Identify the slow endpoint from the alert's `endpoint` label.
2. Check the Grafana panel `Customer Overview → API Latency by Endpoint`.
3. If the slow endpoint is `/api/v1/customer/preferences/:profileId/resolve`:
   - Check the LRU cache hit rate (should be > 80%; if not, cache invalidation may be too aggressive).
   - Check the M6 GraphEngine query latency (graph projection may be slow).
   - Query the preference count for the slow profile: `SELECT COUNT(*) FROM CustomerPreference WHERE profileId = :id AND overriddenBy IS NULL;` — if > 1000, the profile is an edge case (very active customer).
4. If the slow endpoint is `/api/v1/customer/shopping-lists/:id/items` (POST):
   - Check for SSE broadcast fan-out latency (a list with many active subscribers may slow the broadcast).
   - Check Postgres lock contention on `ShoppingListItem` (the unique constraint `@@unique([shoppingListId, catalogItemId, freeTextName, substitutedForItemId])` may be hot).
5. If the slow endpoint is `/api/v1/customer/pantries/:householdId/items` (POST in linked mode):
   - Check the M7 `InventoryService` latency (pantry writes wait for M7 movement confirmation).
6. If latency is across all endpoints, check Postgres replica lag (read replicas may be lagging; queries should fail over to primary).
7. If a specific query is slow, use `EXPLAIN ANALYZE` on the suspect query (via the M1 slow-query log).

---

## 6. API Error Rate Runbook

**Alert:** `CustomerApiErrorRateHigh`.

1. Identify the failing endpoint and error code from the alert labels (`endpoint`, `error_code`).
2. Common error codes and their runbooks:
   - `CUSTOMER_PERMISSION_DENIED` (403): Check §18 (PermissionSnapshotDrift). If snapshots are stale, force a snapshot rebuild via `POST /api/v1/admin/households/:id/rebuild-permissions`.
   - `CUSTOMER_HOUSEHOLD_NOT_FOUND` (404): Check for cross-tenant query attempts (§22).
   - `CUSTOMER_CHILD_SAFETY_VIOLATION` (403): See §17 — this is critical and should never fire in normal operation.
   - `CUSTOMER_PREFERENCE_EXPLICIT_NOT_OVERRIDABLE` (409): Expected behavior — implicit recommender attempting to override explicit. Investigate the M9+ recommender logic if rate spikes.
   - `CUSTOMER_CALENDAR_SYNC_FAILED` (503): See §10.
   - `CUSTOMER_ITEM_ALREADY_REMOVED` (409): Expected behavior in conflict resolution (§12). If rate spikes, investigate the SSE connection drop rate.
3. If the error is a 5xx, check the corresponding service's health (Postgres, M5 connector, M7 InventoryService).
4. If the error is a 4xx spike, check the M8 UI for a recent deploy that may be sending malformed requests.

---

## 7. Household Growth Anomaly Runbook

(See §3 above — covered inline.)

---

## 8. Household Dissolution Spike Runbook

**Alert:** `HouseholdDissolutionSpike` (> 10 dissolutions/day).

1. Query the dissolution reasons:
   ```sql
   SELECT dissolvedReason, COUNT(*) FROM Household
   WHERE dissolvedAt >= NOW() - INTERVAL '1 day'
   GROUP BY dissolvedReason;
   ```
2. If `DISPUTED` is the dominant reason, escalate to customer support — there may be a household-membership dispute trend.
3. If `MERGED` or `SPLIT` is dominant, investigate the M8 UI's household-management flow (possible UX confusion).
4. If `MOVED_OUT` is dominant, check the M5 `MapsConnector` for a regional anomaly (customers relocating).
5. Check the audit log for dissolution actions by a single `actorUserId` (possible admin abuse):
   ```sql
   SELECT createdBy, COUNT(*) FROM Household
   WHERE dissolvedAt >= NOW() - INTERVAL '1 day'
   GROUP BY createdBy ORDER BY COUNT(*) DESC LIMIT 10;
   ```

---

## 9. Meal Plan Usage Drop Runbook

(See §4 above — covered inline.)

---

## 10. Calendar Sync Failure Runbook

**Alert:** `MealPlanCalendarSyncFailures` (> 5% failure rate for 1h).

1. Check the M5 `CalendarConnector` health dashboard.
2. Identify the failing provider (Google / Outlook / Apple) from the alert's `provider` label.
3. Check the M5 `ProviderHealth` model for the failing provider:
   ```sql
   SELECT * FROM ProviderHealth WHERE providerType='CALENDAR' AND providerName=:provider ORDER BY checkedAt DESC LIMIT 5;
   ```
4. If the provider is down (circuit breaker open), the sync job will retry with exponential backoff; no action needed.
5. If the provider is healthy but sync is failing, check the OAuth token expiry on the affected `CalendarConnection` rows:
   ```sql
   SELECT id, userId, providerName, tokenExpiresAt, lastSyncedAt, syncStatus
   FROM CalendarConnection
   WHERE syncStatus='FAILED' AND lastSyncedAt >= NOW() - INTERVAL '1 hour';
   ```
6. If tokens are expired, trigger a re-auth flow notification to the affected customers via M5 `NotificationConnector`.
7. If a single customer's calendar is failing repeatedly (rate-limited by the provider), throttle the sync for that customer (set `MealPlan.calendarConnectionId = NULL` temporarily).

---

## 11. Pantry Expiration Scanner Runbook

**Alert:** `PantryExpirationBacklog` (> 500 items in EXPIRING state) or `PantryExpirationLag` (scanner lag > 6h).

1. Check the M1 cron status for `PantryExpirationScannerJob`:
   ```bash
   curl https://api.eks-food.com/internal/cron-status?job=pantry-expiration-scanner
   ```
2. If the job is not running, check the M1 `@eks/workers` consumer health.
3. If the job is running but slow, query the items in EXPIRING state:
   ```sql
   SELECT organizationId, COUNT(*) FROM PantryItem
   WHERE status='EXPIRING' AND deletedAt IS NULL
   GROUP BY organizationId ORDER BY COUNT(*) DESC LIMIT 10;
   ```
4. If a single tenant is dominating, that tenant may have a notification delivery issue (customers not consuming their expiring items). Check the M5 `NotificationConnector` delivery logs for that tenant.
5. If the scanner is genuinely lagging (job runtime > 6h), increase the batch size in `CustomerPlatformConfig.pantryScannerBatchSize` (default 1000) and rerun.
6. For backlog > 5000 items, manually trigger a one-off scan:
   ```bash
   curl -X POST https://api.eks-food.com/internal/jobs/pantry-expiration-scanner/run
   ```

---

## 12. Shopping List Conflict Runbook

**Alert:** `ShoppingListConflictRate` (> 5% of item writes) or `ShoppingListSSEConnectionDrop` (> 20% disconnect rate).

1. Check the SSE hub health:
   ```bash
   curl https://api.eks-food.com/internal/sse-status
   ```
2. If SSE disconnects are high, check the load balancer's idle timeout (should be ≥ 60s; SSE connections are long-lived).
3. If conflicts are high, query the conflict types:
   ```sql
   SELECT metadata->>'conflictType', COUNT(*) FROM AuditLog
   WHERE actionCode='CUSTOMER_SHOPPING_LIST_ITEM_CONFLICT'
     AND createdAt >= NOW() - INTERVAL '1 hour'
   GROUP BY metadata->>'conflictType';
   ```
4. If `STALE_VERSION` conflicts dominate, the mobile app may have a bug in its local version tracking — engage the mobile team.
5. If `Add-Add` duplicates dominate, the client-side `clientId` deduplication may be failing — check the M8 mobile SDK version distribution (older versions may not send `clientId`).
6. For SSE issues, check the Redis pub/sub health (the SSE hub uses Redis for fan-out across instances).

---

## 13. Preference Derivation & Decay Runbook

**Alert:** `PreferenceDerivationLag` (> 2h) or `PreferenceDecayLag` (> 24h).

1. Check the M1 cron status for `PreferenceDerivationJob` and `PreferenceDecayJob`.
2. If `PreferenceDerivationJob` is slow, query the source signal volume:
   ```sql
   SELECT
     (SELECT COUNT(*) FROM MealHistory WHERE createdAt >= NOW() - INTERVAL '1 day') AS meals,
     (SELECT COUNT(*) FROM Favorite WHERE createdAt >= NOW() - INTERVAL '1 day') AS favorites,
     (SELECT COUNT(*) FROM Rating WHERE createdAt >= NOW() - INTERVAL '1 day') AS ratings,
     (SELECT COUNT(*) FROM PantryItem WHERE updatedAt >= NOW() - INTERVAL '1 day' AND status='REMOVED') AS pantry_removals;
   ```
3. If signal volume is unusually high (e.g. a marketing campaign drove 100k new favorites), the derivation job will naturally take longer. Increase parallelism via `CustomerPlatformConfig.preferenceDerivationParallelism` (default 4 workers).
4. If `PreferenceDecayJob` is slow, query the preference count:
   ```sql
   SELECT provenance, COUNT(*) FROM CustomerPreference
   WHERE overriddenBy IS NULL AND decayedAt IS NULL AND provenance LIKE 'IMPLICIT_%'
   GROUP BY provenance;
   ```
5. If implicit preferences are accumulating (decay not keeping up), the decay batch size may need to be increased (default 5000 per run).
6. If `decayedAt` is being set but `confidence` is not decreasing, check the decay formula in `PreferenceService.applyDecay()` — a bug in the formula would cause decay to no-op.

---

## 14. Review Moderation Queue Runbook

**Alert:** `ReviewModerationBacklog` (> 200 reviews in PENDING state older than 24h) or `ReviewAutoFlagMisfire` (auto-flag rate > 30%).

1. Check the moderation queue:
   ```sql
   SELECT status, COUNT(*), MIN(createdAt) AS oldest
   FROM Review WHERE status IN ('PENDING', 'FLAGGED') AND deletedAt IS NULL
   GROUP BY status;
   ```
2. If `PENDING` is high, the human moderation team is behind. Engage the support team to add moderators or extend moderation hours.
3. If `FLAGGED` is high (auto-flag misfire), check the auto-flag rules:
   - Sentiment threshold may be too high (false positives on neutral reviews).
   - Profanity filter may be too aggressive (legitimate uses of words like "hell" in food context — "this soup is hellishly spicy").
   - Competitor blocklist may be over-broad.
4. Adjust thresholds via `TenantConfiguration.reviewModerationConfig` and rerun the auto-flag job on the affected period:
   ```bash
   curl -X POST https://api.eks-food.com/internal/jobs/review-auto-flag/rerun?from=2025-01-15&to=2025-01-16
   ```
5. For dispute backlog (reviews in DISPUTED state > 7 days), escalate to the senior moderator team.

---

## 15. Address Validation Success Runbook

**Alert:** `AddressValidationSuccessLow` (< 90% geocoding success rate).

1. Check the M5 `MapsConnector` health dashboard.
2. Identify the failing provider (Google Maps / Mapbox / OpenStreetMap) from the alert's `provider` label.
3. Query the recent failures:
   ```sql
   SELECT organizationId, COUNT(*) AS failures, COUNT(DISTINCT line1) AS distinct_addresses
   FROM Address
   WHERE verifiedAt IS NULL AND createdAt >= NOW() - INTERVAL '1 hour'
   GROUP BY organizationId ORDER BY failures DESC LIMIT 10;
   ```
4. If a single tenant is dominating, that tenant's address format may be non-standard (e.g. rural Ghanaian addresses without street numbers). Engage the M5 `MapsConnector` team to improve handling.
5. If the provider is rate-limiting (429 responses), increase the M5 `FailoverEngine` weight on the backup provider.
6. If the provider is returning zero results for valid addresses, the geocoding query format may be wrong — check the M5 `MapsConnector.geocode()` implementation for the affected region.

---

## 16. Notification Delivery Runbook

**Alert:** `NotificationDeliveryFailure` (> 5% failure rate per channel).

1. Identify the failing channel (email / SMS / push / in-app) and provider (SendGrid / Twilio / Firebase / OneSignal) from the alert labels.
2. Check the M5 `NotificationConnector` health dashboard for that provider.
3. If the provider is down, the M5 failover engine should have switched to the backup provider — verify failover triggered.
4. If failover didn't trigger, manually trigger it:
   ```bash
   curl -X POST https://api.eks-food.com/internal/connectors/failover?providerType=NOTIFICATION&providerName=:failingProvider
   ```
5. Query the failure reasons:
   ```sql
   SELECT metadata->>'failureReason', COUNT(*) FROM NotificationLog
   WHERE channel=:channel AND status='FAILED' AND createdAt >= NOW() - INTERVAL '1 hour'
   GROUP BY metadata->>'failureReason' ORDER BY COUNT(*) DESC;
   ```
6. If failures are due to invalid email/phone (bounces, opt-outs), the `CustomerNotificationPreference` may have stale contact info — trigger a re-verification flow.
7. For push notification failures (FCM token expired), the mobile app should refresh tokens on next launch; if many tokens are stale, the app may have a token-refresh bug.

---

## 17. Child Safety Check Failure Runbook

**Alert:** `ChildSafetyCheckFailure` (any `CUSTOMER_CHILD_SAFETY_CHECK_FAILED` audit action). **Critical — page on-call DPO.**

1. Immediately query the audit entry:
   ```sql
   SELECT * FROM AuditLog
   WHERE actionCode='CUSTOMER_CHILD_SAFETY_CHECK_FAILED'
     AND createdAt >= NOW() - INTERVAL '1 hour'
   ORDER BY createdAt DESC;
   ```
2. Identify the affected `CustomerProfile` (a minor) and the attempted operation.
3. Determine if the failure is:
   - **A blocked write** (e.g. minor attempted to submit a public review) — expected behavior, but investigate how the minor reached the submit flow (UI bug?).
   - **A bypassed gate** (e.g. a preference was written for a minor without guardian co-sign) — **critical incident**, escalate immediately.
4. For a bypassed gate:
   - Quarantine the affected row (soft-delete pending investigation).
   - Notify the DPO and the minor's guardian.
   - Trigger a full audit of all writes by the affected `actorUserId` in the last 30 days.
   - File an incident report per the M1 `docs/OPERATIONS_RUNBOOK.md` incident response process.
5. For a blocked write that shouldn't have been attempted:
   - Engage the M8 UI team to fix the gating (the minor should not have seen the submit button).
   - Add a test case for the gating rule that was bypassed.
6. The DPO must sign off on the incident closure within 72 hours.

---

## 18. Permission Snapshot Drift Runbook

**Alert:** `PermissionSnapshotDrift` (`HouseholdPermissionSnapshotReconciler` drift > 10 rows).

1. Query the drift details:
   ```sql
   SELECT hm.id, hm.householdId, hm.role, hm.permissionsSnapshot,
          p.computed_permissions AS expected
   FROM HouseholdMember hm
   JOIN (SELECT id, compute_permissions(id) AS computed_permissions FROM HouseholdMember WHERE status='ACTIVE') p ON hm.id = p.id
   WHERE hm.permissionsSnapshot::jsonb != p.computed_permissions::jsonb
     AND hm.deletedAt IS NULL;
   ```
2. If drift is on a single household, force a snapshot rebuild:
   ```bash
   curl -X POST https://api.eks-food.com/internal/households/:id/rebuild-permissions
   ```
3. If drift is widespread (many households), check for:
   - A recent `Role` or `Policy` change in M2 (the snapshot recomputation logic may have a bug).
   - A feature flag change that added/removed permissions (the snapshot may not have been invalidated).
   - A `TenantConfiguration.childAgeOfConsent` change (minors may have transitioned to adults without snapshot update).
4. Run the reconciler manually:
   ```bash
   curl -X POST https://api.eks-food.com/internal/jobs/permission-snapshot-reconciler/run
   ```
5. If drift persists, engage the M8 platform team — there may be a bug in the snapshot computation logic.

---

## 19. Privacy Export / Deletion Runbook

**Alert:** `PrivacyExportJobStuck` (> 30 min in QUEUED) or `PrivacyDeletionPastSchedule` (past `scheduledPurgeAt` not completed). **Critical for deletion — GDPR Article 17 violation if delayed.**

1. Check the M1 `@eks/workers` consumer health:
   ```bash
   curl https://api.eks-food.com/internal/workers/status
   ```
2. If workers are backed up (queue depth > 100), increase consumer parallelism via `WorkersConfig.privacyWorkerParallelism` (default 2).
3. For a stuck export job:
   - Check the worker logs for the job ID:
     ```bash
     curl https://api.eks-food.com/internal/workers/logs?jobId=:jobId
     ```
   - If the worker crashed mid-export, retry the job:
     ```bash
     curl -X POST https://api.eks-food.com/internal/privacy/export/:jobId/retry
     ```
   - If the export file is too large (> 1 GB), the encryption step may be slow — increase the worker memory limit.
4. For a deletion job past schedule:
   - **Immediately** check if the customer cancelled (look for `PrivacyDeletionJob.status=CANCELLED`):
     ```sql
     SELECT * FROM PrivacyDeletionJob WHERE id=:jobId;
     ```
   - If not cancelled and the job is past `scheduledPurgeAt`, manually execute the deletion:
     ```bash
     curl -X POST https://api.eks-food.com/internal/privacy/delete/:jobId/execute-now
     ```
   - Notify the DPO — the delay is a GDPR compliance incident.
   - File an incident report per M1 `docs/OPERATIONS_RUNBOOK.md`.

---

## 20. Data Retention & Purge Lag Runbook

**Alert:** `CustomerDataRetentionLag` (> 24h) or `HouseholdPurgeLag` (> 48h).

1. Check the M1 cron status for `CustomerDataRetentionJob` and `HouseholdPurgeJob`.
2. If the retention job is slow, query the deletion volume:
   ```sql
   SELECT
     (SELECT COUNT(*) FROM CustomerProfile WHERE deletedAt IS NOT NULL AND deletedAt < NOW() - INTERVAL '30 days') AS profiles_to_purge,
     (SELECT COUNT(*) FROM PantryItem WHERE deletedAt IS NOT NULL AND deletedAt < NOW() - INTERVAL '90 days') AS pantry_to_purge,
     (SELECT COUNT(*) FROM ShoppingList WHERE deletedAt IS NOT NULL AND deletedAt < NOW() - INTERVAL '365 days') AS lists_to_purge;
   ```
3. If volumes are unusually high, a tenant may have bulk-deleted profiles (e.g. GDPR bulk request). The retention job will catch up naturally.
4. If the job is failing (not just slow), check the Postgres connection pool — large DELETE statements may be timing out.
5. For `HouseholdPurgeJob` lag, query the dissolved households past the 30-day window:
   ```sql
   SELECT organizationId, COUNT(*) FROM Household
   WHERE status='DISSOLVED' AND dissolvedAt < NOW() - INTERVAL '30 days' AND deletedAt IS NULL
   GROUP BY organizationId;
   ```
6. Manually trigger the purge if needed:
   ```bash
   curl -X POST https://api.eks-food.com/internal/jobs/household-purge/run
   ```

---

## 21. Media Upload Quarantine Runbook

**Alert:** `MediaUploadQuarantineRate` (> 1% of uploads).

1. Query the quarantined uploads:
   ```sql
   SELECT organizationId, profileId, entityType, COUNT(*) AS quarantines
   FROM MediaAsset
   WHERE status='QUARANTINED' AND createdAt >= NOW() - INTERVAL '1 hour'
   GROUP BY organizationId, profileId, entityType
   ORDER BY quarantines DESC LIMIT 20;
   ```
2. If a single profile is uploading many quarantined files, the user may be uploading malicious content — suspend the profile:
   ```bash
   curl -X POST https://api.eks-food.com/internal/profiles/:id/suspend -d '{"reason":"MEDIA_QUARANTINE_SPIKE"}'
   ```
3. If quarantines are widespread, the ClamAV signature database may have been updated with an overly broad rule — check the ClamAV logs for the matched signature.
4. If quarantines are due to a specific file type (e.g. all HEIC images), the M1 `@eks/security` sanitization pipeline may have a bug — engage the security team.
5. False-positive quarantines can be released manually by an admin:
   ```bash
   curl -X POST https://api.eks-food.com/internal/media/:id/release
   ```

---

## 22. Tenant Data Leak Runbook

**Alert:** `TenantDataLeakSuspected` (cross-tenant query detected by M2 RLS audit). **Critical — page on-call security lead.**

1. Immediately query the M2 RLS audit log:
   ```sql
   SELECT * FROM AuditLog
   WHERE actionCode='TENANT_ISOLATION_VIOLATION'
     AND createdAt >= NOW() - INTERVAL '1 hour'
   ORDER BY createdAt DESC;
   ```
2. Identify the violating query, the `actorUserId`, and the affected tenants.
3. If the violation is a misconfigured API route (missing `organizationId` filter), immediately deploy a hotfix or rollback.
4. If the violation is from a specific user (e.g. a `SUPER_ADMIN` ran an ad-hoc query without tenant scoping), revoke the user's elevated access pending review.
5. Notify the affected tenants' DPOs — this is a notifiable breach under GDPR Article 33 (72-hour notification window).
6. File an incident report and conduct a post-mortem per the M1 `docs/OPERATIONS_RUNBOOK.md` incident response process.

---

## 23. Backup & Disaster Recovery

| Component | RPO | RTO | Backup strategy |
|---|---|---|---|
| Customer Postgres (primary) | 5 min | 1 h | M1 automated WAL archiving + nightly full snapshot |
| Customer Postgres (read replica) | 5 min | 15 min | Promote replica to primary on failure |
| LRU caches (preferences, permissions) | n/a | 5 min | Rebuild from Postgres on cold start |
| Object storage (media, exports) | 0 | 1 h | M1 cross-region replication |
| SSE hub (Redis) | n/a | 5 min | Redis cluster with automatic failover |

**DR procedure (full region failure):**

1. Promote the secondary region's Postgres replica to primary (M1 runbook).
2. Reconfigure the M8 services to point at the new primary via `CustomerPlatformConfig.databaseUrl`.
3. Rebuild LRU caches on first request (cold start).
4. Verify the M5 connectors are healthy in the new region.
5. Verify the M6 GraphEngine projections are intact.
6. Run a smoke test of the 8 service endpoints (`/api/v1/customer/households`, `/preferences/.../resolve`, `/meal-plans`, `/pantries/.../items`, `/shopping-lists`, `/reviews`, `/privacy/audit-log`, `/notifications/preferences`).
7. Notify customers of the disruption via the M5 `NotificationConnector` (if the outage was user-visible).

---

## 24. On-Call Daily Checklist

Performed by the on-call engineer at the start of each shift:

- [ ] Check the `Customer Overview` dashboard for any red panels.
- [ ] Review overnight alerts in PagerDuty — confirm all were acknowledged.
- [ ] Check the `Customer Privacy` dashboard — verify no `PrivacyDeletionPastSchedule` alerts.
- [ ] Check the `Customer Reviews` dashboard — verify the moderation queue is not backlogged.
- [ ] Check the `Customer Notifications` dashboard — verify delivery success rates per channel.
- [ ] Run the daily health check script:
  ```bash
  curl https://api.eks-food.com/internal/customer/health-check
  ```
  Expected output: `{ "status": "healthy", "services": { "household": "ok", "preferences": "ok", "mealPlanning": "ok", "pantry": "ok", "shoppingList": "ok", "reviews": "ok", "privacy": "ok" } }`
- [ ] Review the M2 audit log for any `CUSTOMER_CHILD_SAFETY_CHECK_FAILED` entries from the previous 24h.
- [ ] Check the M1 cron status for any failed jobs (`PreferenceDerivationJob`, `PantryExpirationScannerJob`, `CustomerDataRetentionJob`).

---

## 25. Useful Commands

```bash
# Force a permission snapshot rebuild for a household
curl -X POST https://api.eks-food.com/internal/households/:id/rebuild-permissions

# Manually trigger the pantry expiration scanner
curl -X POST https://api.eks-food.com/internal/jobs/pantry-expiration-scanner/run

# Manually trigger preference derivation for a specific profile
curl -X POST https://api.eks-food.com/internal/jobs/preference-derivation/run -d '{"profileId": ":id"}'

# Retry a stuck privacy export job
curl -X POST https://api.eks-food.com/internal/privacy/export/:jobId/retry

# Force-execute a delayed privacy deletion
curl -X POST https://api.eks-food.com/internal/privacy/delete/:jobId/execute-now

# Check the SSE hub status
curl https://api.eks-food.com/internal/sse-status

# Check the cron job status
curl https://api.eks-food.com/internal/cron-status?job=:jobName

# Run a tenant data isolation check
curl https://api.eks-food.com/internal/security/tenant-isolation-check
```

---

## 26. Escalation Matrix

| Severity | Issue | Escalate to | Response time |
|---|---|---|---|
| Critical | `TenantDataLeakSuspected` | On-call security lead + DPO + CTO | Immediate |
| Critical | `ChildSafetyCheckFailure` (bypassed gate) | On-call DPO + customer platform lead + CTO | Immediate |
| Critical | `PrivacyDeletionPastSchedule` | On-call DPO + customer platform lead | Immediate (GDPR 72h clock starts) |
| Critical | `CustomerApiLatencyCritical` | On-call SRE + customer platform lead | 15 min |
| Critical | `CustomerApiErrorRateHigh` (5xx spike) | On-call SRE + customer platform lead | 15 min |
| Warning | Any other alert | On-call engineer | 1 hour |
| Warning | `ReviewModerationBacklog` | Support team lead | 4 hours |
| Warning | `HouseholdGrowthAnomaly` | Product team | Next business day |
| Info | `BatchExpiringSoon` (per-item) | Customer (via notification) | Automatic |

---

## 27. Cross-References

- `PLATFORM_ARCHITECTURE.md` §6 — API surface overview.
- `HOUSEHOLD_MODEL_GUIDE.md` §9 — `HouseholdPermissionResolver` algorithm (relevant to §18).
- `PREFERENCE_INTELLIGENCE_GUIDE.md` §3 — preference decay (relevant to §13).
- `MEAL_PLANNING_GUIDE.md` §6 — calendar sync (relevant to §10).
- `PANTRY_MANAGEMENT_GUIDE.md` §8 — expiration scanner (relevant to §11).
- `SHOPPING_LIST_GUIDE.md` §7 — conflict resolution (relevant to §12).
- `PRIVACY_PERMISSIONS_GUIDE.md` §6 — GDPR data subject rights (relevant to §19).
- `PRIVACY_PERMISSIONS_GUIDE.md` §4 — child privacy (relevant to §17).
- M1 `docs/OPERATIONS_RUNBOOK.md` — base operational playbook, incident response process.
- M1 `docs/SECURITY.md` — ClamAV, EXIF stripping, signed URL conventions.
- M2 `docs/identity/AUDIT_AND_COMPLIANCE.md` — audit log retention and queries.
- M5 `docs/connectors/OPERATIONAL_RUNBOOKS.md` — connector health and failover.
- M7 `docs/fims/OPERATIONAL_RUNBOOKS.md` — FIMS runbooks (pantry linked mode calls into M7).
