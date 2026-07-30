# Eks-Food — Deployment Guide

> **Audience:** Engineers deploying Eks-Food and SREs operating it. Read alongside `OPERATIONS_RUNBOOK.md` (what to do when it breaks) and `infra/` (the IaC).
>
> **Status:** Milestone 1 ships a single-container sandbox deployment (Next.js standalone + SQLite). Milestone 2 adds Docker multi-stage builds, Postgres, Redis, the outbox worker, and multi-region routing via Caddy. This doc covers the M2+ production target; M1 specifics are called out inline.

---

## 1. Build

### 1.1 The build command

```bash
bun run build
```

`package.json` defines:

```json
"build": "next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/"
```

This:
1. Runs `next build`, producing `.next/` (compiled output) and `.next/standalone/` (a self-contained Node server with all deps inlined).
2. Copies the static chunks into the standalone tree (Next.js doesn't bundle them by default).
3. Copies `public/` so the server can serve static assets.

The resulting `.next/standalone/` directory is the deployable artefact.

### 1.2 Starting the production server

```bash
bun run start
```

Which runs:

```bash
NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log
```

> **Bun vs Node:** The `start` script uses Bun for consistency with the dev toolchain. In production, Bun is also supported; if a runtime issue surfaces, substitute `node .next/standalone/server.js` (Node 20+). Both are CI-tested.

### 1.3 Prisma client generation

The build includes `prisma generate` as part of `next build` (via a `postinstall` hook or a build pre-step). The generated client is committed to `.next/standalone/` and is the one the production server loads.

**MUST NOT** run `prisma generate` at runtime in production. The client must be baked into the image.

### 1.4 Build artefacts

| Path | Contents |
|---|---|
| `.next/standalone/server.js` | The Next.js standalone server entry point |
| `.next/standalone/.next/static/` | Compiled JS/CSS chunks |
| `.next/standalone/.next/server/` | Server components, route handlers |
| `.next/standalone/public/` | Static assets (images, logo, robots.txt) |
| `.next/standalone/node_modules/` | Inlined production deps (no devDeps) |

---

## 2. Docker Build Stages

The Dockerfile uses multi-stage builds to keep the final image small and cache-friendly.

### 2.1 Stages

```dockerfile
# Stage 1: deps — install all deps (including devDeps for build)
FROM oven/bun:1.1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Stage 2: build — generate Prisma client, build Next.js
FROM oven/bun:1.1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run db:generate
RUN bun run build

# Stage 3: runtime — minimal image, only production deps + build output
FROM oven/bun:1.1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/standalone/public ./public
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server.js"]
```

### 2.2 Worker image

A separate `Dockerfile.worker` builds the outbox publisher and event consumer process:

```dockerfile
FROM oven/bun:1.1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/prisma ./prisma
CMD ["bun", "scripts/run-worker.ts"]
```

`scripts/run-worker.ts` boots:
- Outbox Publisher
- Event consumers (matching, notifications, audit, demand)
- A graceful-shutdown handler (drains in-flight messages on `SIGTERM`).

### 2.3 Image sizes (target)

| Image | Target size | Notes |
|---|---|---|
| `eks-food-web` | < 250 MB | Bun base + standalone + static |
| `eks-food-worker` | < 200 MB | Same base, no static assets |
| `eks-food-migrate` | < 150 MB | One-shot job: `prisma migrate deploy` |

### 2.4 Build caching

- `deps` stage is cached on `bun.lock` change only.
- `build` stage is cached on source change.
- CI builds on `main` push and tags images with both the git SHA and the semantic version.
- Multi-arch builds (`linux/amd64` + `linux/arm64`) for cross-region deploy targets.

---

## 3. Environment Variables

### 3.1 Naming convention

All Eks-Food env vars are prefixed `EKS_`. External library vars (`DATABASE_URL`, `NODE_ENV`) keep their conventional names.

### 3.2 Full env var table

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `NODE_ENV` | enum (`development`/`test`/`production`) | yes | — | Runtime mode. Production enables prod optimisations and disables dev HMR. |
| `DATABASE_URL` | string (URL) | yes | — | Prisma datasource URL. Postgres in prod: `postgresql://user:pass@host:5432/db?schema=public`. SQLite in M1 sandbox: `file:./db/custom.db`. |
| `EKS_DB_MAX_CONNECTIONS` | int | no | `10` | Prisma connection pool size per process. Tune for pool sizing: `processes × this ≤ Postgres max_connections`. |
| `EKS_DB_STATEMENT_TIMEOUT_MS` | int | no | `30000` | Postgres `statement_timeout`. Long-running queries are killed; protects the pool. |
| `EKS_DB_IDLE_TIMEOUT_MS` | int | no | `30000` | Prisma client idle connection timeout. |
| `EKS_REDIS_URL` | string (URL) | prod yes, dev no | — | Redis URL for cache, rate-limit counters, idempotency-key store, outbox streams. `redis://host:6379/0`. |
| `EKS_REDIS_MAX_CONNECTIONS` | int | no | `20` | Redis connection pool size. |
| `EKS_REDIS_KEY_PREFIX` | string | no | `eks:` | Namespace prefix for all keys. Useful for shared Redis clusters. |
| `EKS_TENANT_DEFAULT_SLUG` | string | no | `eks-ghana` | Default tenant slug used in M1 demo mode when no `x-eks-org` header is sent. |
| `EKS_AUTH_MODE` | enum (`header-demo`/`jwt`) | yes | `header-demo` | M1 uses `header-demo` (resolves principal from `x-eks-*` headers). M2 switches to `jwt` (NextAuth + signed JWT). |
| `EKS_JWT_SECRET` | string (≥32 chars) | prod yes | — | HMAC secret for signing JWTs. Required when `EKS_AUTH_MODE=jwt`. Rotate quarterly. |
| `EKS_JWT_ISSUER` | string | no | `https://api.eks.food` | JWT `iss` claim. |
| `EKS_JWT_AUDIENCE` | string | no | `eks-food` | JWT `aud` claim. |
| `EKS_JWT_TTL_SECONDS` | int | no | `3600` | Access token lifetime. Refresh tokens are 30 days. |
| `EKS_PAYSWAP_API_KEY` | string | prod yes | — | Payswap secret API key. NEVER commit. |
| `EKS_PAYSWAP_WEBHOOK_SECRET` | string | prod yes | — | HMAC secret for verifying inbound Payswap webhooks. |
| `EKS_PAYSWAP_API_BASE` | string (URL) | no | `https://api.payswap.com` | Payswap API base URL. Override for sandbox: `https://api.sandbox.payswap.com`. |
| `EKS_PAYSWAP_ENABLED` | boolean | no | `true` | Master switch. When `false`, payment endpoints return `503 payment.disabled`. |
| `EKS_OUTBOX_POLL_INTERVAL_MS` | int | no | `1000` | How often the Outbox Publisher polls for pending rows. |
| `EKS_OUTBOX_BATCH_SIZE` | int | no | `100` | Rows fetched per poll. |
| `EKS_OUTBOX_MAX_ATTEMPTS` | int | no | `10` | After this many failed publish attempts, a row moves to DLQ. |
| `EKS_OUTBOX_BACKOFF_MAX_MS` | int | no | `3600000` | Cap on exponential backoff between retries (1 hour). |
| `EKS_EVENT_STREAM_PATTERN` | string | no | `eks.events.{aggregate}` | Redis Stream name pattern. `{aggregate}` is substituted (e.g. `eks.events.Booking`). |
| `EKS_EVENT_CONSUMER_GROUP` | string | no | `eks-consumers` | Redis consumer group name. |
| `EKS_EVENT_MAX_ATTEMPTS` | int | no | `5` | Consumer delivery attempts before DLQ. |
| `EKS_EVENT_TTL_SECONDS` | int | no | `86400` | Message TTL in the stream. |
| `EKS_RATE_LIMIT_TIER_<ROLE>` | int | no | (see API_CONVENTIONS §9.3) | Per-role rate limit override. E.g. `EKS_RATE_LIMIT_TIER_CUSTOMER=1200`. |
| `EKS_RATE_LIMIT_WINDOW_SECONDS` | int | no | `3600` | Rate limit window. |
| `EKS_RATE_LIMIT_BURST_MULTIPLIER` | float | no | `2.0` | Token-bucket burst multiplier. |
| `EKS_IDEMPOTENCY_TTL_SECONDS` | int | no | `86400` | How long `Idempotency-Key` responses are cached (24h). |
| `EKS_AI_SDK_ENDPOINT` | string (URL) | no | (z-ai default) | Override for the z-ai-web-dev-sdk endpoint. |
| `EKS_AI_MODEL` | string | no | `glm-4.6` | Default LLM model for AI assistants. |
| `EKS_AI_MAX_TOKENS` | int | no | `2048` | Max tokens per assistant response. |
| `EKS_AI_TEMPERATURE` | float | no | `0.4` | LLM temperature. Lower = more deterministic. |
| `EKS_AI_DAILY_TOKEN_BUDGET` | int | no | `1000000` | Per-tenant daily LLM token budget. Hard stop when exceeded. |
| `EKS_FEATURE_FLAG_DEFAULT_STATE` | enum (`on`/`off`) | no | `off` | Default state for feature flags not explicitly configured. |
| `EKS_AUDIT_LOG_RETENTION_DAYS` | int | no | `365` | Days to retain `AuditLog` rows before archiving to cold storage. |
| `EKS_AUDIT_PII_REDACT` | boolean | no | `true` | Redact PII from audit `metadata` before persistence. |
| `EKS_LOG_LEVEL` | enum (`trace`/`debug`/`info`/`warn`/`error`) | no | `info` | Structured log level. |
| `EKS_LOG_FORMAT` | enum (`json`/`text`) | no | `json` in prod, `text` in dev | Log line format. |
| `EKS_REQUEST_ID_HEADER` | string | no | `X-Request-Id` | Header name for request IDs. |
| `EKS_CORRELATION_ID_HEADER` | string | no | `X-Correlation-Id` | Header name for correlation IDs. |
| `EKS_CORS_ALLOWED_ORIGINS` | string (CSV) | yes | — | Comma-separated allowed origins. |
| `EKS_CSP_REPORT_URI` | string (URL) | no | — | Where CSP violations are reported. |
| `EKS_REGION` | string | prod yes | — | Deployment region identifier: `aws-af-west-1`, `aws-af-south-1`. Drives data residency. |
| `EKS_ENVIRONMENT` | enum (`sandbox`/`staging`/`production`) | yes | — | Environment tag. Drives strictness (e.g. `production` requires `EKS_AUTH_MODE=jwt`). |
| `EKS_SEED_ON_BOOT` | boolean | no | `false` | M1 sandbox convenience: run `seed.ts` on first boot. NEVER `true` in prod. |
| `EKS_HEALTH_TIMEOUT_MS` | int | no | `3000` | Internal timeout for the `/api/health` deep check. |
| `EKS_SHUTDOWN_GRACE_MS` | int | no | `30000` | Grace period for in-flight requests on `SIGTERM` before force-close. |
| `PORT` | int | no | `3000` | HTTP port the server listens on. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | string (URL) | no | — | OpenTelemetry OTLP collector endpoint. |
| `OTEL_SERVICE_NAME` | string | no | `eks-food` | OTel service name. Suffix per process: `eks-food-web`, `eks-food-worker`. |

### 3.3 Required env vars per environment

| Variable | sandbox | staging | production |
|---|---|---|---|
| `DATABASE_URL` | ✅ (SQLite) | ✅ (Postgres) | ✅ (Postgres HA) |
| `EKS_REDIS_URL` | — | ✅ | ✅ (cluster) |
| `EKS_AUTH_MODE` | `header-demo` | `jwt` | `jwt` |
| `EKS_JWT_SECRET` | — | ✅ | ✅ |
| `EKS_PAYSWAP_API_KEY` | — | ✅ (sandbox key) | ✅ (prod key) |
| `EKS_PAYSWAP_WEBHOOK_SECRET` | — | ✅ | ✅ |
| `EKS_REGION` | — | ✅ | ✅ |
| `EKS_ENVIRONMENT` | `sandbox` | `staging` | `production` |
| `EKS_CORS_ALLOWED_ORIGINS` | — | ✅ | ✅ |

### 3.4 Secret management

- **Sandbox:** `.env.local` file (gitignored).
- **Staging/production:** AWS Secrets Manager (or equivalent) loaded into the container at boot via an init sidecar. Secrets are NEVER baked into the image, NEVER in env files committed to git, NEVER logged.
- **Rotation:** `EKS_JWT_SECRET`, `EKS_PAYSWAP_API_KEY`, `EKS_PAYSWAP_WEBHOOK_SECRET` are rotated quarterly. JWT secret rotation supports a grace window: the server accepts tokens signed by either the current or previous secret for 24h after rotation.

---

## 4. Migration Strategy

### 4.1 The rule

Schema migrations are **forward-only** in production. We deploy the new code, run `prisma migrate deploy`, and never run `migrate dev` or `migrate reset` against prod.

### 4.2 The migrate command

```bash
bun run db:migrate:deploy
```

Which runs:

```bash
prisma migrate deploy
```

This applies pending migrations in `prisma/migrations/` to the target database. It is **safe and idempotent** — already-applied migrations are skipped.

### 4.3 Migration lifecycle

1. Engineer modifies `prisma/schema.prisma`.
2. `bun run db:migrate -- --name <descriptive_name>` generates a new migration in `prisma/migrations/<timestamp>_<name>/migration.sql`.
3. Engineer reviews the generated SQL — Prisma is not perfect, especially for complex column type changes.
4. If the migration is destructive (`DROP COLUMN`, `DROP TABLE`), engineer writes a **two-phase migration**:
   - Phase 1 (this deploy): add the new column/table; keep the old one; deploy code that writes to both.
   - Phase 2 (next deploy, ≥ 1 week later): drop the old column/table after confirming no reads from it.
5. Migration is committed and reviewed in the PR.
6. CI runs `prisma migrate deploy` against a fresh Postgres container; the build fails if the migration doesn't apply cleanly.

### 4.4 Pre-deploy check

Before promoting a new image to production:

```bash
bun run scripts/migrate.ts --dry-run
```

This connects to the production DB (read-only) and lists the pending migrations without applying. A non-empty list means there are migrations to apply; an empty list means the DB is ahead of the code (deploy will be a no-op for migrations).

### 4.5 Migration job

Migrations run as a **separate one-shot Kubernetes job** (`eks-food-migrate`) before the new web/worker pods roll out. The job:

1. Acquires an advisory lock (`SELECT pg_advisory_lock(...)`) to prevent concurrent migrations.
2. Runs `prisma migrate deploy`.
3. Verifies the resulting schema matches `schema.prisma` (`prisma migrate status`).
4. Releases the lock and exits 0.

The web/worker rollout waits for the migrate job to complete (`kubectl wait --for=condition=complete job/eks-food-migrate-<sha>`).

### 4.6 Rollback

- **Code rollback** is always safe: the previous image works against the current schema (migrations are forward-only; we don't auto-rollback schemas).
- **Schema rollback** is **manual and rare**. Each destructive migration has a documented `down.sql` in the migration folder. Running it requires staff-engineer approval and is performed only during incident response.
- The preferred recovery from a bad migration is a forward-fix: write a new migration that undoes the damage, deploy it.

---

## 5. Health & Readiness Probes

### 5.1 Endpoints

| Endpoint | Purpose | Checks |
|---|---|---|
| `GET /api/health` | **Liveness** — is the process alive? | Process responds. Always 200 if the server is up. |
| `GET /api/health?deep=true` | **Readiness** — can I serve traffic? | DB ping, Redis ping, Payswap reachability (cached 30s), outbox backlog < threshold. |
| `GET /api/health?deep=true&verbose=true` | Debug — full detail | Same as readiness plus per-dependency latency, version, region. |

### 5.2 Response shape

```jsonc
// GET /api/health (liveness)
{
  "status": "ok",
  "version": "1.4.2",
  "region": "aws-af-west-1"
}

// GET /api/health?deep=true (readiness)
{
  "status": "ok",                    // "ok" | "degraded" | "down"
  "version": "1.4.2",
  "region": "aws-af-west-1",
  "checks": {
    "database": { "status": "ok", "latencyMs": 4 },
    "redis":   { "status": "ok", "latencyMs": 1 },
    "payswap": { "status": "ok", "latencyMs": 87, "cachedAt": "2025-07-30T12:34:25Z" },
    "outbox":  { "status": "ok", "backlog": 12, "threshold": 1000 }
  }
}
```

### 5.3 Status semantics

| `status` | HTTP | Load balancer routes traffic? | PagerDuty |
|---|---|---|---|
| `ok` | 200 | yes | no |
| `degraded` | 200 | yes (with reduced rate) | warn |
| `down` | 503 | no | critical |

### 5.4 Probe configuration (Kubernetes)

```yaml
livenessProbe:
  httpGet: { path: /api/health, port: 3000 }
  initialDelaySeconds: 20
  periodSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet: { path: /api/health?deep=true, port: 3000 }
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 2
```

The worker image uses a TCP probe on its metrics port (no HTTP server) plus a custom exec probe that checks the consumer lag metric.

---

## 6. Rolling Deploys

### 6.1 The sequence

1. CI builds and tags the image `eks-food-web:<sha>` and `eks-food-worker:<sha>`.
2. CI runs the migrate job (`eks-food-migrate:<sha>`); waits for completion.
3. CI updates the Kubernetes Deployment to reference the new image tag.
4. Kubernetes rolls pods: spins up new pod → waits for readiness → drains old pod.
5. The Caddy ingress continues routing to old pods until new pods are ready; traffic shifts gradually.

### 6.2 Surge configuration

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 2              # spin up to 2 new pods above the desired count
    maxUnavailable: 0        # never drop below the desired count
```

This gives zero-downtime deploys: new pods must be ready before any old pod is removed.

### 6.3 Graceful shutdown

On `SIGTERM`:

1. Pod tells the load balancer to stop sending new requests (Caddy removes it from the upstream pool).
2. Pod waits `EKS_SHUTDOWN_GRACE_MS` (default 30s) for in-flight requests to drain.
3. Worker pod stops pulling new messages; lets in-flight messages complete or NACK for redelivery.
4. Pod closes the Prisma connection pool and Redis pool.
5. Pod exits 0.

Kubernetes `terminationGracePeriodSeconds` MUST be ≥ `EKS_SHUTDOWN_GRACE_MS + 5s` to give the pod time to clean up.

### 6.4 Deploy verification

After a deploy, CI runs:

- Smoke tests against the new pods: `GET /api/health?deep=true` returns `ok`.
- A synthetic booking creation: `POST /api/v1/bookings` with a test payload, expects `201`.
- A synthetic Payswap webhook delivery, expects `200`.
- A read of the audit log, expects the synthetic events to be present.

If any smoke test fails, the deploy auto-rolls back (§7).

---

## 7. Rollback Procedure

### 7.1 Automatic rollback

If deploy verification (§6.4) fails within 5 minutes of rollout, Kubernetes reverts to the previous Deployment revision. PagerDuty alerts; an engineer investigates.

### 7.2 Manual rollback

```bash
# Rollback the web deployment to the previous revision
kubectl rollout undo deployment/eks-food-web -n eks-food

# Or to a specific revision
kubectl rollout undo deployment/eks-food-web --to-revision=42 -n eks-food

# Watch the rollback
kubectl rollout status deployment/eks-food-web -n eks-food
```

### 7.3 Schema-aware rollback

If the failing deploy included a schema migration that the previous code can't tolerate:

1. Roll back the code (§7.2).
2. **Do NOT** roll back the schema automatically. The previous code may have already written rows using the new schema.
3. Assess: can the previous code read the new schema? (Usually yes for additive migrations; usually no for destructive ones.)
4. If the previous code can't tolerate the new schema, write a **forward-fix migration** that adds compatibility shims, deploy the previous code + the fix, then investigate the root cause.

### 7.4 Rollback drill

Quarterly, the on-call team runs a rollback drill in staging: deploy a deliberately broken image, verify auto-rollback, then manually roll forward. This keeps the procedure muscle-memory fresh.

---

## 8. Multi-Region Considerations

### 8.1 Active-active per region

Eks-Food runs **active-active** per region. Each region (e.g. `aws-af-west-1` Accra, `aws-af-south-1` Cape Town) has:

- Its own Postgres primary (with replicas in-region).
- Its own Redis cluster.
- Its own web + worker pools.
- Its own outbox + consumers.

There is **no cross-region synchronous write path**. A tenant's data lives in one region; requests for that tenant are routed to that region.

### 8.2 Routing

Caddy at the edge inspects the host (`<tenant>.eks.food` → tenant's home region) or the `X-Tenant` header and routes accordingly. A tenant-to-region map is held in a global control plane (DynamoDB Global Table, M3 target); updates propagate to all edges within 60s.

If a tenant's home region is unavailable, Caddy serves a `503` with `Retry-After` and a static fallback page. We do **not** fail over to another region automatically — cross-region data residency constraints forbid it.

### 8.3 Cross-region reads

Cross-region aggregates (global analytics, cross-tenant benchmarks) are computed by an async pipeline:

1. Each region's audit + demand events stream to a global S3 bucket (per-region prefix).
2. A global aggregator (running in a single "control" region) reads from all buckets and produces global read models.
3. Global read models are served from the control region; not used for latency-sensitive paths.

### 8.4 Currency & locale

`Organization.baseCurrency` and `User.locale` are tenant- and user-scoped; the same code path serves all regions. There is no global "current currency" — every money operation is explicit.

### 8.5 Region failover

If a region goes down hard (lost zone), the procedure is:

1. Edge Caddy marks the region's upstreams as down; tenant traffic gets `503`.
2. On-call declares an incident (see `OPERATIONS_RUNBOOK.md` § Incident Severity).
3. For tenants with a documented DR agreement, a region-failover playbook runs:
   a. Restore the latest Postgres backup to the DR region.
   b. Update the tenant-to-region map to point affected tenants at the DR region.
   c. Edge Caddy picks up the map update; traffic flows.
4. Data written between the last backup and the failure is **lost**. We document RPO (recovery point objective) per tenant in their SLA; default RPO is 5 minutes (via WAL streaming to S3).

---

## 9. Observability Hooks

### 9.1 Logs

- Structured JSON to stdout, parsed by the OTel collector → Loki / CloudWatch.
- Every log line carries `requestId`, `correlationId`, `tenantId`, `userId` (when authenticated), `region`, `version`.
- No PII, no secrets, no card data. The `@eks/audit` consumer is the single source of truth for PII-bearing audit records.

### 9.2 Metrics

- Prometheus-compatible `/metrics` endpoint on the web and worker pods (port 9090).
- Key metrics: `http_requests_total`, `http_request_duration_seconds`, `outbox_backlog`, `outbox_publish_duration_seconds`, `event_consumer_lag`, `db_pool_active`, `db_pool_idle`, `payswap_request_duration_seconds`, `ai_tokens_used_total`.

### 9.3 Tracing

- OpenTelemetry traces propagated via `traceparent` header.
- Spans: HTTP handler → application use case → repository → DB query → external call.
- The correlation ID is attached as a span attribute; traces and logs join on it.

---

## 10. Pre-deploy Checklist

Before promoting a build to production:

- [ ] All CI checks green: lint, typecheck, unit tests, integration tests, coverage.
- [ ] Migrations reviewed and tested against a fresh Postgres.
- [ ] Env var changes documented in `DEPLOYMENT_GUIDE.md` §3.
- [ ] New feature flags default to `off`; rollout plan in the PR.
- [ ] New events registered in the schema registry; consumers deployed.
- [ ] Smoke tests pass in staging.
- [ ] On-call team notified in `#eks-eng` 24h ahead (for high-risk changes).
- [ ] Rollback plan identified (image tag, feature flag, or forward-fix migration).
- [ ] `OPERATIONS_RUNBOOK.md` updated if new alerts or runbooks are needed.

---

## 11. Post-deploy Verification

Within 30 minutes of a production deploy:

- [ ] `GET /api/health?deep=true` returns `ok` on all pods.
- [ ] Error rate (`http_requests_total{status=~"5.."}`) is at baseline.
- [ ] p99 latency is at baseline.
- [ ] Outbox backlog is at baseline (< 100 pending).
- [ ] DLQ depth is at baseline (0 new messages).
- [ ] Synthetic booking creation succeeds end-to-end (browse → book → pay → confirm).
- [ ] No new PagerDuty alerts.
- [ ] The deploy is announced in `#eks-eng` with the SHA, version, and what changed.

If any check fails, roll back (§7) and open an incident.
