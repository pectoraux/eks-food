# Eks-Food — Operations Runbook

> **Audience:** On-call engineers, SREs, and the duty manager. This is the book you reach for at 03:00 when PagerDuty fires.
>
> **How to use this book:** Start with §2 (Health Dashboard) to triage. Find your alert in §3. If the alert is a known scenario, follow the runbook; if not, escalate (§10). When in doubt, page the secondary.

---

## 1. On-Call Procedures

### 1.1 Roster

- **Primary on-call:** first responder, 24/7, week-long rotation.
- **Secondary on-call:** escalation target if primary doesn't ack within 5 minutes.
- **Duty manager:** business-side escalation for Sev-1 (see §9).
- **Staff engineer on-call:** architectural escalations, schema rollback approvals.

Rotation schedule lives in PagerDuty. Swap requests go through PagerDuty ≥ 24h in advance.

### 1.2 Response SLAs

| Severity | Ack | Mitigation start | Comms |
|---|---|---|---|
| Sev-1 | 5 min | 15 min | Customer-facing within 30 min |
| Sev-2 | 15 min | 1 hour | Internal within 1 hour |
| Sev-3 | 1 hour | 4 hours | Internal standup |
| Sev-4 | 1 business day | next sprint | ticket |

### 1.3 When you're paged

1. **Ack within the SLA.** If you can't, the secondary gets paged after the ack window.
2. **Open the incident channel:** `#eks-incident-<date>` (auto-created by PagerDuty).
3. **Declare a severity** (§9) and post it in the channel.
4. **Assign an incident commander** (usually you, the primary). The IC coordinates; others execute.
5. **Communicate.** Post a status update every 30 minutes for Sev-1, every 2 hours for Sev-2. Customer-facing updates go through the status page (`status.eks.food`).
6. **Mitigate, don't fix.** Your job at 03:00 is to restore service, not to root-cause. Roll back, scale out, feature-flag off, drain traffic — whatever restores service fastest.
7. **Hand off cleanly.** When the incident is mitigated, write a handoff note in the channel with current state + next steps.

### 1.4 Post-incident

- Within 24h: a post-mortem doc is opened (`docs/postmortems/<yyyy-mm-dd>.md`).
- Within 5 business days: the post-mortem is reviewed in the weekly ops review.
- Post-mortems are **blameless**. We describe what happened, why, and what we'll change — not who to fire.

---

## 2. Health Dashboard

### 2.1 Where

- **Grafana:** `https://grafana.eks.food/d/eks-food-overview`
- **Status page:** `https://status.eks.food`
- **Real-time logs:** Loki / CloudWatch Logs Insights, query by `correlationId` or `tenantId`

### 2.2 The panels

| Panel | What it shows | Green / Yellow / Red thresholds |
|---|---|---|
| Request rate | `http_requests_total` by route, region | — |
| Error rate | `http_requests_total{status=~"5.."}` | <0.1% / 0.1–1% / >1% |
| p99 latency | `http_request_duration_seconds` by route | <300ms / 300–1000ms / >1000ms |
| DB pool | `db_pool_active`, `db_pool_idle` | active <80% / 80–95% / >95% |
| DB connections | Postgres `pg_stat_activity` count | <80% max / 80–95% / >95% |
| Outbox backlog | `outbox_backlog` gauge | <100 / 100–1000 / >1000 |
| Outbox publish lag | time between `occurredAt` and `publishedAt` | <5s / 5–60s / >60s |
| Event consumer lag | `event_consumer_lag` per consumer | <100 / 100–1000 / >1000 |
| DLQ depth | `dlq_depth` per consumer | 0 / 1–50 / >50 |
| Redis hit rate | `redis_hits / (redis_hits + redis_misses)` | >90% / 80–90% / <80% |
| Payswap error rate | `payswap_request_duration_seconds{status=~"5.."}` | <1% / 1–5% / >5% |
| AI token burn | `ai_tokens_used_total` per tenant | <80% daily budget / 80–100% / >100% |
| Worker alive | `up{job="eks-food-worker"}` | all 1 / 1 down / >1 down |

### 2.3 Triage flow

1. Look at **error rate** and **p99 latency** first. If both are red, it's a system-wide issue.
2. If only error rate is red, filter by route — is it one endpoint or all?
3. If only latency is red, check DB pool and Redis hit rate — is a dependency slow?
4. Check **outbox backlog** and **DLQ depth**. Are async paths keeping up?
5. Check **Payswap error rate**. Is the provider down?

---

## 3. Common Alert Scenarios

### 3.1 DB Connection Exhaustion

**Alert:** `DBPoolExhausted` — `db_pool_active / db_pool_max > 0.95` for 2 minutes.

**Symptoms:**
- p99 latency spikes on DB-backed routes.
- Logs show `PrismaClientInitializationError: Can't reach database server`.
- Error rate climbs on `/api/v1/bookings`, `/api/v1/cooks`, etc.

**Diagnostic steps:**
1. In Grafana, check the **DB pool** panel. Is the active count pegged at max?
2. Query Postgres for long-running queries:
   ```sql
   SELECT pid, state, query, query_start, now() - query_start AS duration
   FROM pg_stat_activity
   WHERE state != 'idle' AND now() - query_start > interval '5 seconds'
   ORDER BY duration DESC;
   ```
3. Look for a query without `LIMIT`, a missing index (seq scan on a big table), or a transaction left open.
4. Check the **Prisma log** for the same query repeated — could be a retry loop.
5. Check the **deploy history** — did a recent deploy ship a query without a `where` clause?

**Mitigations (in order of preference):**
1. **Kill the offending query:** `SELECT pg_terminate_backend(<pid>);`. Pool recovers.
2. **Scale DB max connections:** bump the Postgres `max_connections` (requires a reload). Confirm `processes × EKS_DB_MAX_CONNECTIONS ≤ max_connections`.
3. **Scale out PgBouncer** if connection routing is the bottleneck.
4. **Roll back** the deploy that introduced the bad query.
5. **Feature-flag off** the offending endpoint if rolling back is too risky.

**Post-incident:**
- Add a `statement_timeout` on the offending query path.
- Add an index if it was a seq scan.
- Add a regression test that asserts the query plan uses an index.

---

### 3.2 Event Outbox Backlog

**Alert:** `OutboxBacklogHigh` — `outbox_backlog > 1000` for 5 minutes.
**Alert:** `OutboxPublishLagHigh` — median `publishedAt - occurredAt > 60s` for 5 minutes.

**Symptoms:**
- Customers report "I booked but never got a confirmation email/SMS".
- Bookings show `PENDING_MATCH` for minutes instead of seconds.
- DLQ depth starts climbing on downstream consumers.

**Diagnostic steps:**
1. In Grafana, check the **Outbox backlog** and **Outbox publish lag** panels.
2. Check the **Worker alive** panel — is the Outbox Publisher worker pod running?
   ```bash
   kubectl get pods -n eks-food -l app=eks-food-worker
   ```
3. If workers are alive, check their logs:
   ```bash
   kubectl logs -n eks-food -l app=eks-food-worker --tail=200 | grep -i outbox
   ```
4. Are they erroring on publish? (Redis Stream write failure, OOM, etc.)
5. Check Redis: `redis-cli INFO clients`, `redis-cli INFO memory`. Is Redis saturated?
6. Check the outbox table directly:
   ```sql
   SELECT status, COUNT(*) FROM "OutboxEvent" GROUP BY status;
   SELECT eventType, COUNT(*) FROM "OutboxEvent" WHERE status = 'PENDING' GROUP BY eventType ORDER BY COUNT(*) DESC;
   ```
   A single event type dominating suggests a stuck consumer downstream.

**Mitigations:**
1. **Restart the worker pool:** `kubectl rollout restart deployment/eks-food-worker -n eks-food`. New pods pick up the backlog.
2. **Scale out the worker pool:** `kubectl scale deployment/eks-food-worker --replicas=8 -n eks-food`.
3. **If Redis is the bottleneck:** scale Redis, or temporarily increase `EKS_OUTBOX_BATCH_SIZE` (carefully — too large and the publish transaction holds locks too long).
4. **If a single consumer is stuck:** pause that consumer (`scripts/pause-consumer.ts --name eks.notifications.booking-confirmed`); the outbox keeps publishing, the stream buffers, the stuck consumer's lag grows but doesn't block others.
5. **If the outbox table itself is huge:** run `scripts/outbox-replay.ts --batch-size 5000` to drain in chunks; investigate why the publisher can't keep up (usually a missing index on `(status, availableAt)`).

**Post-incident:**
- Tune `EKS_OUTBOX_BATCH_SIZE` and worker replica count.
- Add a load test that simulates the event burst.
- Investigate the slow consumer; consider sharding by `aggregateType`.

---

### 3.3 Cache Stampede

**Alert:** `CacheHitRateLow` — Redis hit rate <80% for 10 minutes.
**Alert:** `CacheStampedeDetected` — `redis_misses` rate > 10× baseline for 2 minutes.

**Symptoms:**
- p99 latency climbs on read-heavy endpoints (`/api/v1/cooks`, `/api/v1/analytics/demand`).
- DB pool active count climbs (every cache miss hits the DB).
- Redis CPU pegs at 100%.

**Diagnostic steps:**
1. Identify the cache key pattern with the highest miss rate:
   ```bash
   redis-cli --bigkeys
   redis-cli MONITOR | head -100  # CAUTION: only for a few seconds in non-prod
   ```
2. Was a popular cache entry evicted or expired recently? Check `redis-cli INFO stats` for `evicted_keys`.
3. Was there a deploy that changed the cache key format? (Look for `EKS_REDIS_KEY_PREFIX` or key-version changes.)
4. Was there a traffic burst? Check the **Request rate** panel.

**Mitigations:**
1. **Enable single-flight locks** on the hottest cache-miss path. The `@eks/http.cacheAside` helper already supports this; if a path isn't using it, hotfix it to.
2. **Pre-warm the cache:** run `scripts/warm-cache.ts --pattern "cooks:*"` to repopulate the hottest keys.
3. **Bump the TTL** on the affected keys (temporary; reduce back later).
4. **Scale Redis** if memory or CPU is the bottleneck.
5. **Scale DB** if the stampede has cascaded into DB pool exhaustion (§3.1).

**Post-incident:**
- Ensure every cache-aside path uses single-flight locks.
- Add a cache-warm job to the deploy pipeline.
- Consider read-through caching for the hottest paths.

---

### 3.4 Worker DLQ Growth

**Alert:** `DlqDepthHigh` — DLQ depth >50 for any consumer for 15 minutes.
**Alert:** `DlqGrowthRateHigh` — DLQ depth growing >10 messages/minute for 5 minutes.

**Symptoms:**
- A specific consumer's DLQ topic is filling.
- Downstream business effect depends on the consumer:
  - `eks.notifications.booking-confirmed` DLQ → customers don't get confirmations.
  - `eks.bookings.matching` DLQ → bookings stuck in `PENDING_MATCH`.
  - `eks.audit.audit-writer` DLQ → audit trail has gaps (compliance issue).

**Diagnostic steps:**
1. Identify which consumer's DLQ is growing (the alert labels include `consumer`).
2. Inspect a sample DLQ message:
   ```bash
   bun run scripts/dlq-inspect.ts --consumer eks.notifications.booking-confirmed --limit 5
   ```
3. Look at `lastError` and `dlqReason`:
   - `schema_validation_failed` — the producer shipped a new event version that the consumer can't parse. Page the producer's owner.
   - `max_attempts_exceeded` with a transient error (DB timeout, Redis OOM) — infrastructure issue; fix the infra.
   - `max_attempts_exceeded` with a non-transient error (business rule violation, null pointer) — consumer bug; needs a code fix.
   - `ttl_exceeded` — the message sat in the queue longer than `EKS_EVENT_TTL`; investigate why the consumer was slow.
4. Check the consumer's logs around the failure time:
   ```bash
   kubectl logs -n eks-food -l app=eks-food-worker --tail=500 | grep "eks.notifications.booking-confirmed"
   ```

**Mitigations:**
1. **Pause the consumer** to stop DLQ growth: `bun run scripts/pause-consumer.ts --name eks.notifications.booking-confirmed`. The stream buffers; the consumer catches up when restarted.
2. **For schema_validation_failed:** roll back the producer (the deploy that introduced the new event version), or hot-fix the consumer to handle the new version.
3. **For transient errors:** fix the underlying infra (DB, Redis), then **replay** the DLQ (§4).
4. **For consumer bugs:** ship a hotfix, then replay the DLQ.
5. **For compliance-critical consumers (audit):** do NOT pause. Page the staff engineer. Audit gaps are a Sev-1.

**Post-incident:**
- Add a regression test for the failure mode.
- For schema_validation_failed, add a contract test that runs the producer's event through the consumer's schema before deploy (CI gate).
- Tune `EKS_EVENT_MAX_ATTEMPTS` and backoff if the consumer is too aggressive.

---

### 3.5 Rate-Limit 429 Spike

**Alert:** `RateLimit429Spike` — `http_requests_total{status="429"}` rate >10× baseline for 5 minutes.

**Symptoms:**
- A specific tenant or IP is hammering the API.
- Legitimate users on the same tenant may also see 429s if the limit is tenant-scoped.

**Diagnostic steps:**
1. Identify the source. Filter the 429s by `tenantId` and `remote_addr`:
   ```logql
   {app="eks-food-web"} | json | status="429" | line_format "{{.tenantId}} {{.remote_addr}} {{.path}}"
   ```
2. Is it one IP (likely a script or a bug in a client's retry loop) or many (likely a distributed load test or attack)?
3. Is the path unusual? (`/api/v1/ai-assistant` burning the AI budget is a common cause.)
4. Check the rate-limit tier — is the tenant legitimately over their negotiated limit, or is the limit misconfigured?

**Mitigations:**
1. **For a single misbehaving IP:** block at Caddy. Add to the edge blocklist:
   ```bash
   caddy adapt --adapt --config /etc/caddy/Caddyfile
   # Edit the blocklist CIDR, reload
   ```
2. **For a client retry storm:** identify the client (User-Agent, tenant), reach out, ask them to back off. If unreachable, temporarily lower their tier.
3. **For an AI budget burn:** cap the tenant's `EKS_AI_DAILY_TOKEN_BUDGET` via the admin flags API; their AI requests return 429 until tomorrow.
4. **For a misconfigured limit:** correct the `FeatureFlag` row for the tenant's rate-limit tier.
5. **For a DDoS:** engage the edge provider (Cloudflare / AWS Shield).

**Post-incident:**
- Add the offending pattern to the anomaly-detection rules.
- If a legitimate client, document the negotiated limit in the tenant's SLA.
- Consider per-IP sub-limits to prevent one client's bug from starving a tenant's other users.

---

## 4. Runbook: Event Replay

**When to use:** after fixing a consumer bug, after adding a new consumer that needs back-fill, after a data-corruption incident.

### 4.1 Pre-flight

1. **Confirm the consumer is fixed and deployed.** Replay against a buggy consumer just re-DLQs everything.
2. **Identify the time window and event type** to replay. Be specific — too wide and you'll overwhelm the consumer; too narrow and you'll miss events.
3. **Notify the on-call** and post in `#eks-eng`. Replay is a controlled operation but it does increase load.
4. **Take a snapshot** of the consumer's idempotency store state — if the replay goes wrong, you can compare.
5. **Estimate the volume.** `SELECT COUNT(*) FROM "OutboxEvent" WHERE eventType = '...' AND occurredAt BETWEEN ... AND ...;`

### 4.2 Execution

```bash
bun run scripts/event-replay.ts \
  --consumer eks.bookings.matching \
  --event-type Booking.Created \
  --from 2025-07-29T00:00:00Z \
  --to 2025-07-30T00:00:00Z \
  --organization-id cm9k8j2... \
  --batch-id 2025-07-30-replay-matching-bug \
  --throttle 100
```

- `--throttle 100` limits to 100 events/sec to avoid overwhelming the consumer.
- The script sets `correlationId = "replay_2025-07-30-replay-matching-bug"` on every re-published event.
- Consumers detect the `replay_` prefix and **suppress external side effects** (SMS, email, webhook) while still applying state changes — see `EVENT_CONVENTIONS.md` §10.3.

### 4.3 Monitoring during replay

Watch:
- **Outbox backlog** — should rise briefly then fall.
- **Consumer lag** — should rise then fall as the consumer catches up.
- **DLQ depth** — should stay flat. Any DLQ growth means the consumer still has a bug; pause the replay.
- **Error rate** on the consumer's downstream dependencies.

### 4.4 Verification

After the replay completes:

1. Spot-check 5 events: confirm the consumer's state matches the expected effect.
2. Compare the consumer's idempotency-store write count to the replayed event count. They should match (minus events that were no-ops due to business-level idempotency).
3. Confirm external side effects were suppressed (no SMS/email logs during the replay window).

### 4.5 Rollback

Replay is **not directly reversible**. If the replay applied incorrect state:

1. Pause the consumer.
2. Identify the affected aggregate IDs from the replay batch (the script logs them).
3. Restore each aggregate from a pre-replay snapshot, OR write a corrective migration that undoes the specific changes.
4. Document the incident in a post-mortem.

---

## 5. Runbook: Force a Feature Flag

**When to use:** to dark-launch a fix, to disable a misbehaving feature, to enable a feature for a specific tenant without a deploy.

### 5.1 Via the Admin API (preferred)

```bash
curl -X PUT https://api.eks.food/api/v1/admin/flags/group_purchasing \
  -H "Authorization: Bearer $EKS_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": false,
    "config": { "rolloutPercent": 0 }
  }'
```

- Propagates to all web pods within 30s (they poll the flag cache).
- Propagates to all worker pods within 30s.
- Logged in `AuditLog` with the actor.

### 5.2 Via the CLI script (when the API is down)

```bash
bun run scripts/flag-force.ts \
  --organization-id cm9k8j2... \
  --key group_purchasing \
  --enabled false \
  --reason "Sev-1: group_purchasing causing booking creation failures (incident 2025-07-30)"
```

- Writes directly to the `FeatureFlag` table.
- Skips the audit-log-via-API path; the script itself writes the audit row.
- Pods pick up the change on their next flag-cache refresh (≤30s), or immediately if you trigger a refresh:
  ```bash
  kubectl exec -n eks-food deployment/eks-food-web -- curl -sX POST http://localhost:3000/api/internal/flags/refresh
  ```

### 5.3 Verification

```bash
curl https://api.eks.food/api/v1/admin/flags \
  -H "Authorization: Bearer $EKS_ADMIN_TOKEN" | jq '.data[] | select(.key=="group_purchasing")'
```

Confirm `enabled: false` and `config.rolloutPercent: 0`. Watch the error rate on the affected path return to baseline.

### 5.4 Post-incident

- The flag force is **temporary**. The owning team has **1 week** to either:
  - Fix the bug and re-enable the flag, OR
  - Decommission the feature and remove the flag entirely.
- A flag left in a forced state for >1 week triggers a Sev-3 ticket.

---

## 6. Runbook: Database Hot Standby Promotion

**When to use:** Postgres primary failure (zone loss, hardware death).

### 6.1 Decision

Promoting a replica is **data-lossy** if WAL streaming is behind. Check the replication lag first:

```bash
psql -h <replica-host> -c "SELECT now() - pg_last_xact_replay_timestamp() AS lag;"
```

- Lag < 5s: promote. Expected data loss ≤ 5s.
- Lag 5–60s: page the staff engineer. Promote only if the primary is unrecoverable.
- Lag > 60s: do NOT promote. Restore from backup instead (RPO 5 min via WAL archive).

### 6.2 Promotion

```bash
# On the chosen replica:
pg_ctl promote -D /var/lib/postgresql/data

# Update the connection string in Secrets Manager
aws secretsmanager update-secret --secret-id eks-food-prod-db \
  --secret-string '{"host":"<replica-host>","port":5432,...}'

# Restart the web and worker pods to pick up the new connection string
kubectl rollout restart deployment/eks-food-web -n eks-food
kubectl rollout restart deployment/eks-food-worker -n eks-food
```

### 6.3 Post-promotion

- The promoted replica is now the primary. Stand up a **new** replica from it.
- Update the runbook with what failed and what we'd do differently.
- File a ticket to investigate why the primary failed.

---

## 7. Runbook: Payswap Provider Outage

**When to use:** Payswap is returning 5xx or timing out.

### 7.1 Confirm

```bash
curl -w "\n%{http_code} %{time_total}s\n" \
  https://api.payswap.com/v1/health \
  -H "Authorization: Bearer $EKS_PAYSWAP_API_KEY"
```

If non-200 or >5s, Payswap is degraded.

### 7.2 Mitigate

1. **Disable new payment initiation** without disabling the rest of the platform:
   ```bash
   bun run scripts/flag-force.ts --key payments.initiate --enabled false \
     --reason "Payswap outage $(date)"
   ```
   The `/api/v1/payswap/checkout` endpoint returns `503 payment.provider_unavailable`. Bookings can still be created; checkout is queued.
2. **Hold payouts.** The outbox publisher will keep retrying transfer requests; pause the payouts consumer to avoid hammering Payswap:
   ```bash
   bun run scripts/pause-consumer.ts --name eks.payments.transfer-initiator
   ```
3. **Communicate.** Post on the status page: "Payment processing is degraded. New bookings can be created but checkout is temporarily unavailable."
4. **Monitor Payswap status.** When they recover, re-enable in this order:
   - Re-enable the payouts consumer.
   - Re-enable `payments.initiate` flag.
   - Watch the error rate return to baseline.

### 7.3 Post-incident

- Confirm all queued payouts processed successfully (no DLQ growth).
- Confirm bookings created during the outage can now complete checkout (the `REQUIRES_ACTION` payment intents still resolve).
- Document the duration and impact in the post-mortem.

---

## 8. Runbook: AI Token Budget Burn

**When to use:** a tenant is burning their daily LLM token budget faster than expected.

### 8.1 Confirm

```bash
curl https://api.eks.food/api/v1/admin/ai/usage?tenantId=cm9k8j2... \
  -H "Authorization: Bearer $EKS_ADMIN_TOKEN"
```

Look at `tokensUsedToday` vs `dailyBudget`. If >80% before noon, investigate.

### 8.2 Investigate

1. Identify the offending user:
   ```sql
   SELECT "actorUserId", COUNT(*), SUM((metadata::json->>'tokens')::int) AS tokens
   FROM "AuditLog"
   WHERE action = 'AI_ASSISTANT_CALLED'
     AND "createdAt" > CURRENT_DATE
     AND "organizationId" = 'cm9k8j2...'
   GROUP BY "actorUserId"
   ORDER BY tokens DESC
   LIMIT 10;
   ```
2. Look at the prompts — is one user looping the assistant with the same query? Is a client retrying failed calls?

### 8.3 Mitigate

1. **Per-user cap:** set `FeatureFlag` `ai.per_user_daily_cap` for the tenant with a lower value.
2. **Reduce model:** switch the tenant to a cheaper model via `FeatureFlag` `ai.model_override`.
3. **Disable AI for the tenant:** `bun run scripts/flag-force.ts --key ai.assistant --enabled false --organization-id cm9k8j2...`.
4. **Reach out** to the tenant's admin if the burn is intentional (they may need a higher tier).

---

## 9. Incident Severity Matrix

| Sev | Definition | Examples | Response | Customer comms |
|---|---|---|---|---|
| **Sev-1** | Production down or major function unavailable for ≥1 tenant. Data loss. Compliance breach. | Platform unreachable in a region. Payswap down. Audit log corruption. PII leak. | Page primary + secondary + duty manager. IC assigned. War room. | Within 30 min, then every 30 min until resolved. Status page red. |
| **Sev-2** | Major function degraded, no workaround. | Booking creation failing for one tenant. Outbox backlog >10k. DLQ growing on notifications consumer. | Page primary. IC assigned. | Within 1 hour. Status page yellow. |
| **Sev-3** | Minor function degraded, workaround exists. | AI assistant slow. Admin config UI bug. Analytics dashboard delayed. | Page primary during business hours; otherwise next day. | Internal only. |
| **Sev-4** | Cosmetic, no user impact. | Typo in UI. Documentation error. | Ticket, no page. | None. |

### 9.1 Escalation path

```
Primary on-call
   ↓ (no ack in 5 min)
Secondary on-call
   ↓ (no ack in 10 min)
Staff engineer on-call
   ↓ (Sev-1, no mitigation in 30 min)
Duty manager + engineering lead
   ↓ (Sev-1, customer data loss)
CTO + legal
```

---

## 10. Escalation Contacts

> The actual contact details live in PagerDuty and are not duplicated here. This section documents **who** to escalate to and **when**.

| Role | When to escalate |
|---|---|
| Secondary on-call | Primary doesn't ack within SLA |
| Staff engineer on-call | Schema rollback, multi-region failover, architectural decision during incident |
| Duty manager | Sev-1 declared, customer communication needed, vendor escalation needed |
| Engineering lead | Sev-1 with no mitigation in 30 min, or repeat Sev-2 in same area within 7 days |
| CTO + legal | PII leak, regulatory notification threshold, data loss >5 min |
| Payswap support | Payswap-side outage confirmed; open a ticket via the partner portal |
| Cloud provider support | Region-wide outage; open a business-critical support ticket |

---

## 11. Tools & Access

| Tool | Purpose | Access |
|---|---|---|
| Grafana | Dashboards | SSO, all engineers |
| PagerDuty | On-call schedule, alerting | SSO, on-call roster |
| `kubectl` | Cluster operations | Via `eks-food-ops` AWS role, MFA |
| `psql` | Direct DB access (read-only by default) | Bastion host, MFA, audit-logged |
| `redis-cli` | Cache inspection | Bastion host, MFA |
| AWS Console | Infra changes | SSO, MFA, break-glass for prod |
| Status page | Customer comms | SSO, on-call + duty manager |

**Break-glass access** to production DB write is logged, requires dual approval (you + staff engineer), and triggers a post-incident review of why it was needed.

---

## 12. On-Call Survival Tips

- **Mitigate, don't fix.** Roll back, scale out, flag off. The fix can wait for daylight.
- **Communicate early and often.** A 1-line "investigating" update in the incident channel within 5 minutes is worth more than a perfect explanation in 30.
- **Use the runbook.** If your alert isn't in §3, page the secondary; don't improvise alone.
- **Take notes.** Timestamps, commands run, outputs. The post-mortem will thank you.
- **Hand off cleanly.** If your shift ends mid-incident, the handoff note is the most important thing you write.
- **Sleep.** A tired on-call is a dangerous on-call. If you're up for >4 hours on a Sev-1, page the secondary to take over.
- **Be kind to yourself.** You will make a mistake during an incident. The system should be resilient enough to absorb it; if it isn't, that's the post-mortem's job.
