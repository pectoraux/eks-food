# Eks-Food IAM — Audit & Compliance

> **Audience:** Security reviewers, compliance officers, support engineers handling data-subject requests, on-call. Read alongside `ARCHITECTURE.md` (§8.1 outbox), `MULTI_TENANCY.md` (§9 data residency), and `DISASTER_RECOVERY.md` (§5 breach runbook).
>
> **Status:** M2 target architecture. The M1 `@eks/observability/audit.ts` ships an `AuditLog` writer that writes a single `AuditLog` row per call (never crashes the request; falls back to console on failure). M2 extends the `AuditActions` registry with the IAM-specific codes below, adds the `LoginHistory` model, the audit-chain hash compactor for tamper-evidence, the export API, and the GDPR data-subject-rights endpoints.

---

## 1. Audit Platform Overview

Every state-changing identity action produces **two** records in the **same Prisma transaction** as the state change:

1. An **immutable `AuditLog` row** — the canonical "who did what when" record.
2. A **versioned domain event** staged to the `EventOutbox` — the canonical "what happened" record for downstream subscribers.

The two are complementary: the `AuditLog` row is queryable by `actorUserId` / `entityType` / `organizationId` / `action` / `createdAt`; the outbox event is consumed by `@eks/notifications` (for emails), `@eks/identity` projections (for `LoginHistory`), and any future SIEM/warehouse sink. Both are written in the same transaction so they cannot diverge.

```
                       State change
                            │
                            ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  BEGIN TX                                                    │
   │    INSERT/MUTATE business row(s)                             │
   │    INSERT AuditLog { action, actor, entity, metadata, ipHash }│
   │    INSERT EventOutbox { eventType, payload, metadata }       │
   │  COMMIT                                                      │
   └─────────────┬───────────────────────────────────┬───────────┘
                 │                                   │
                 ▼                                   ▼
   ┌──────────────────────────────┐   ┌────────────────────────────┐
   │  AuditLog table              │   │  Outbox relay worker       │
   │  • Queryable (action, actor, │   │  • SELECT FOR UPDATE       │
   │    entity, org, time)        │   │    SKIP LOCKED             │
   │  • Tamper-evident (§5)       │   │  • eventBus.publish(event) │
   │  • Retention: hot 90d,       │   │  • mark PUBLISHED          │
   │    cold 7y (§6)              │   │  • on 5th fail → DLQ       │
   └──────────────────────────────┘   └────────────┬───────────────┘
                                                  │
                                                  ▼
                                     ┌────────────────────────────┐
                                     │  Subscribers               │
                                     │  • @eks/notifications      │
                                     │  • @eks/identity           │
                                     │    projections (LoginHist) │
                                     │  • SIEM collector (M3)     │
                                     └────────────────────────────┘
```

---

## 2. The AuditLog Model

```prisma
model AuditLog {
  id              String   @id @default(cuid())
  organizationId  String   // tenant scope ("" for global actions)
  actorUserId     String?  // null for system actions (e.g. session reaper)
  impersonatorUserId String?  // set when actor is impersonating
  action          String   // see §3 taxonomy
  entityType      String   // "User" | "Session" | "Organization" | "Membership" | …
  entityId        String?
  metadata        String   @default("{}") // JSON, redacted for PII
  ipAddress       String?  // stored as ipHash (SHA-256 salted); never raw
  userAgent       String?
  // Tamper-evidence (§5)
  previousHash    String?  // hash of the previous AuditLog row in the chain
  rowHash         String   // SHA-256(this row's canonical form, including previousHash)
  // Request context
  requestId       String?
  correlationId   String?
  traceId         String?
  // Time
  createdAt       DateTime @default(now())

  @@index([organizationId, action, createdAt])
  @@index([actorUserId, createdAt])
  @@index([entityType, entityId])
  @@index([createdAt])
}
```

### 2.1 Why both `AuditLog` and `EventOutbox`?
- **AuditLog** is for **forensics and compliance**. It is queryable, retained for 7 years, and tamper-evident. It does **not** carry the full domain event payload (to keep storage small); it carries a `metadata` JSON with the relevant forensic fields.
- **EventOutbox** is for **event-driven reactions**. It carries the full domain event payload, is consumed by subscribers, and is purged after 30 days (once successfully published and acknowledged by all subscribers).

A single state change writes both. The `AuditLog` is the permanent record; the `EventOutbox` is the temporary delivery vehicle.

### 2.2 PII redaction
The `metadata` JSON is redacted before storage. PII fields (`email`, `phone`, `password`, `recoveryCode`, `token`, `secret`) are replaced with `"[REDACTED]"`. The redaction is performed by a `redactMetadata()` helper in `@eks/observability/audit` that walks the JSON and replaces any key matching the PII patterns. The original values are never logged.

The `ipAddress` field stores `ipHash = SHA-256(ip + EKS_IP_HASH_SALT)`. The raw IP is never persisted to `AuditLog`. Coarse geo (`ipCountry`, `ipRegion`, `ipCity`) is stored separately on `LoginHistory` for the user-facing "recent activity" UI.

---

## 3. AuditEvent Taxonomy

The M1 `AuditActions` registry (in `src/packages/observability/audit.ts`) ships business actions (`BOOKING_CREATED`, `PAYMENT_SUCCEEDED`, etc.). M2 extends it with the IAM-specific codes below, grouped by domain. Every code is a stable string used by the audit log, the SIEM, and the SOC dashboards.

### 3.1 AUTH_* — authentication actions

| Code | When | Key metadata |
|---|---|---|
| `AUTH_REGISTER` | User registers | `email`, `invitedVia` |
| `AUTH_EMAIL_VERIFIED` | Email verification succeeds | `userId` |
| `AUTH_LOGIN` | Successful login | `method`, `riskScore`, `ipHash`, `deviceId` |
| `AUTH_LOGIN_FAILED` | Failed login (wrong password) | `identityType`, `attempts` |
| `AUTH_LOGIN_MAGIC_LINK` | Magic-link login | `riskScore` |
| `AUTH_LOGIN_WEBAUTHN` | Passkey login | `credentialId`, `riskScore` |
| `AUTH_LOGOUT` | User-initiated logout | `sessionId` |
| `AUTH_REFRESH` | Refresh-token rotation | `sessionId`, `riskScore` |
| `AUTH_TENANT_SWITCHED` | User switches active tenant | `fromOrg`, `toOrg` |
| `AUTH_PASSWORD_CHANGED` | User changes their password | (no PII) |
| `AUTH_PASSWORD_RESET` | Password reset flow completes | `userId` |
| `AUTH_ACCOUNT_LOCKED` | Progressive lockout engages | `identityType`, `attempts`, `lockedUntil` |
| `AUTH_IMPERSONATION_STARTED` | SUPPORT/SUPER_ADMIN impersonates | `targetUserId` |
| `AUTH_IMPERSONATION_ENDED` | Impersonation session ends | `targetUserId`, `durationMs` |

### 3.2 SESSION_* — session actions

| Code | When | Key metadata |
|---|---|---|
| `SESSION_CREATED` | Session created (login or refresh) | `sessionId`, `method`, `riskScore` |
| `SESSION_REFRESHED` | Refresh-token rotation succeeds | `sessionId`, `riskScore` |
| `SESSION_REVOKED` | Session revoked | `sessionId`, `reason` (`user_logout`, `admin_revoke`, `reuse_detected`, `risk_too_high`, `idle_timeout`, `absolute_timeout`, `concurrent_limit`, `password_reset`) |
| `SESSION_EXPIRED` | Reaper marks expired | `sessionId`, `reason` |
| `SESSION_REUSE_DETECTED` | Refresh-token reuse detected | `refreshFamilyId`, `sessionId` |
| `SESSION_DEVICE_TRUSTED` | User marks device trusted | `deviceId` |
| `SESSION_DEVICE_UNTRUSTED` | User untrusts device | `deviceId` |

### 3.3 ORG_* — organization actions

| Code | When | Key metadata |
|---|---|---|
| `ORG_CREATED` | Organization provisioned | `name`, `type`, `plan` |
| `ORG_ACTIVATED` | Status → ACTIVE | `verifiedAt` |
| `ORG_SUSPENDED` | Status → SUSPENDED | `reason` |
| `ORG_REACTIVATED` | Status → ACTIVE from SUSPENDED | (none) |
| `ORG_TERMINATED` | Status → TERMINATED | `reason` |
| `ORG_DELETED` | 30-day retention elapsed, hard scrub | (none) |
| `ORG_CONFIG_CHANGED` | `TenantConfiguration` updated | `key`, `previousValue`, `newValue` |
| `ORG_OWNERSHIP_TRANSFERRED` | Owner changed | `fromUserId`, `toUserId` |
| `ORG_INVITATION_SENT` | Invitation created | `invitedEmail`, `roleSlug` |
| `ORG_INVITATION_BULK_SENT` | Bulk invitations sent | `batchId`, `count` |
| `ORG_INVITATION_REVOKED` | Invitation revoked | `invitationId` |
| `ORG_INVITATION_EXPIRED` | Daily worker marks expired | `invitationId` |
| `ORG_FEATURE_FLAG_TOGGLED` | Per-tenant flag changed | `flagKey`, `enabled` |

### 3.4 MEMBERSHIP_* — membership actions

| Code | When | Key metadata |
|---|---|---|
| `MEMBERSHIP_INVITED` | Invitation sent | `invitedEmail`, `roleSlug`, `teamId` |
| `MEMBERSHIP_ACCEPTED` | Recipient accepts | `userId`, `roleSlug` |
| `MEMBERSHIP_ADDED_DIRECT` | Admin adds user directly (no invite) | `userId`, `roleSlug` |
| `MEMBERSHIP_ROLE_CHANGED` | Role changed | `previousRole`, `newRole` |
| `MEMBERSHIP_REVOKED` | Membership revoked | `userId`, `reason` |
| `MEMBERSHIP_REACTIVATED` | Re-activated | `userId` |
| `MEMBERSHIP_LEFT` | User self-removes | `userId` |

### 3.5 ROLE_* — role + permission actions

| Code | When | Key metadata |
|---|---|---|
| `ROLE_GRANTED` | Role granted to user | `roleId`, `roleSlug`, `grantedBy` |
| `ROLE_REVOKED` | Role revoked from user | `roleId`, `roleSlug`, `revokedBy` |
| `ROLE_PERMISSION_ADDED` | Permission added to a role | `roleId`, `permissionCode` |
| `ROLE_PERMISSION_REMOVED` | Permission removed from a role | `roleId`, `permissionCode` |
| `POLICY_CREATED` | ABAC policy created | `policyId`, `roleSlug`, `permissionCode` |
| `POLICY_UPDATED` | ABAC policy updated | `policyId`, `changes` |
| `POLICY_DELETED` | ABAC policy deleted | `policyId` |
| `AUTHZ_DENIED` | Authorization denied (any layer) | `permission`, `reason`, `resourceId` |
| `AUTHZ_CROSS_TENANT_READ` | Cross-tenant read by SUPPORT/SUPER_ADMIN | `targetTenant`, `resourceType`, `resourceId` |
| `AUTHZ_CROSS_REGION_READ` | Cross-region read | `targetRegion`, `resourceType` |

### 3.6 MFA_* — multi-factor actions

| Code | When | Key metadata |
|---|---|---|
| `MFA_TOTP_ENROLLED` | TOTP enrolment completed | `userId` |
| `MFA_WEBAUTHN_REGISTERED` | Passkey registered | `userId`, `credentialId` |
| `MFA_WEBAUTHN_REMOVED` | Passkey removed | `userId`, `credentialId` |
| `MFA_WEBAUTHN_CLONE_SUSPECTED` | Sign-count regression | `userId`, `credentialId` |
| `MFA_RECOVERY_CODE_USED` | Recovery code consumed | `userId` |
| `MFA_RECOVERY_CODE_REGENERATED` | Recovery codes regenerated | `userId` |
| `MFA_DISABLED` | User disabled MFA | `userId` |
| `MFA_RESET_ADMIN` | Admin-initiated MFA reset | `userId`, `requester`, `approver` |
| `MFA_VERIFIED` | Step-up MFA succeeded | `userId`, `factor` |
| `MFA_VERIFY_FAILED` | Step-up MFA failed | `userId`, `factor`, `attempts` |
| `MFA_STEPUP_REQUIRED` | Risk score ≥ 70 triggered step-up | `userId`, `riskScore`, `factors` |
| `OTP_SENT` | Email/SMS OTP sent | `userId`, `channel` |

### 3.7 DATA_SUBJECT_* — GDPR / privacy actions

| Code | When | Key metadata |
|---|---|---|
| `DATA_SUBJECT_EXPORT_REQUESTED` | User requests data export | `userId` |
| `DATA_SUBJECT_EXPORT_COMPLETED` | Export job finishes | `userId`, `artifactUrl` |
| `DATA_SUBJECT_DELETION_REQUESTED` | User requests deletion | `userId` |
| `DATA_SUBJECT_DELETION_COMPLETED` | Deletion job finishes | `userId` |
| `RIGHT_TO_ERASURE_EXERCISED` | Erasure completed | `userId` |

---

## 4. GDPR-Ready Data Subject Rights

Eks-Food supports the four core GDPR (and Ghana Act 843, Nigeria NDPR) data-subject rights:

### 4.1 Right to access (export)
`POST /api/v1/users/me/export` queues an export job. The job:
1. Collects every record referencing the user across all tenant-scoped tables (`User`, `Identity`, `Session`, `Device`, `Membership`, `AuditLog` where actor=userId, `LoginHistory`, `UserPreference`, `MFAConfiguration`, `RecoveryCode`, `Booking` as customer/cook, `PayswapPayment` as customer, etc.).
2. Serializes to JSON and ZIPs it.
3. Uploads to a per-tenant S3 bucket (encrypted SSE-KMS) in the tenant's `dataResidencyRegion`.
4. Generates a pre-signed URL valid for 7 days.
5. Emails the user a download link.
6. Audit: `DATA_SUBJECT_EXPORT_REQUESTED` then `DATA_SUBJECT_EXPORT_COMPLETED`.

The export must complete within 30 days (GDPR deadline). The job is retried 3 times on failure; on the 3rd failure, SUPPORT is paged.

### 4.2 Right to erasure (deletion)
`POST /api/v1/users/me/delete` queues a deletion job. The job (after a 14-day cool-down so the user can cancel):
1. Verifies the user has no active bookings, pending payouts, or pending inspections (these block deletion; the user must resolve them first).
2. Soft-deletes the `User` (sets `status=DEACTIVATED`, replaces `email` with `SHA-256(originalEmail + salt)@deleted.eks.food`, replaces `displayName` with "Deleted User", nulls `phone`, `avatarUrl`).
3. REVOKES every `Identity` row (does not hard-delete — the audit trail retains them).
4. Hard-deletes `MFAConfiguration.totpSecret`, all `RecoveryCode` rows, all `UserPreference` rows.
5. REVOKES every `Session` and `Membership`.
6. Anonymizes the user's `AuditLog` rows (actor → `"<deleted>"`), but **does not delete** them — the audit log is retained for compliance.
7. Marks `User.deletedAt=now`.
8. Audit: `DATA_SUBJECT_DELETION_REQUESTED`, then `RIGHT_TO_ERASURE_EXERCISED`, then `DATA_SUBJECT_DELETION_COMPLETED`.

After deletion, the user cannot log in (the email no longer resolves to a User row). The audit log retains the historical actions but no PII.

### 4.3 Right to rectification
`PATCH /api/v1/users/me` allows the user to update `displayName`, `phone`, `locale`, `avatarUrl`, `UserPreference`. Each update is audited as `USER_UPDATED` with the previous and new values (PII-redacted where appropriate).

### 4.4 Right to portability
The export (§4.1) is in a portable JSON format (no Eks-Food-internal IDs in the user-facing parts; references are by email/code). The user can take this to a competitor.

### 4.5 Right to object (processing restriction)
A user can request processing restriction via support (no self-serve API). SUPPORT marks `User.restrictedProcessing=true`, which:
- Blocks marketing notifications (transactional notifications still send).
- Removes the user from analytics aggregation jobs.
- Prevents the user from being included in demand-signal computation.

---

## 5. Tamper-Evidence — Hash Chaining

The `AuditLog` table is append-only (no `UPDATE` or `DELETE` allowed at the database-role level — enforced by PostgreSQL GRANT in M3; enforced by application convention in M2). To detect tampering, each row carries a `rowHash` chained to the previous row:

```
rowHash(n) = SHA-256(
  canonicalize(
    id(n), organizationId(n), actorUserId(n), action(n),
    entityType(n), entityId(n), metadata(n), ipAddress(n),
    createdAt(n),
    previousHash(n)        // = rowHash(n-1)
  )
)
```

`previousHash` for the first row in a chain is a constant (`"GENESIS"`). Chains are per-`organizationId` (each tenant has its own chain) so a high-volume tenant doesn't slow down verification for others.

### 5.1 Daily compactor
A daily worker (scheduled via `@eks/workers`):
1. Reads all `AuditLog` rows from the previous day, ordered by `createdAt`.
2. For each row, recomputes `rowHash` from the row's fields + the previous row's `rowHash`.
3. Compares the recomputed hash to the stored `rowHash`. Any mismatch is a tamper alert (paged to on-call).
4. Stores a daily "anchor" record: `AuditChainAnchor { date, organizationId, lastRowHash, rowCount }`. This anchor is published to a write-once S3 bucket (object-lock) so even a database admin with `UPDATE` privileges cannot recompute the chain without leaving a trace at the anchor.

### 5.2 Verification
A verification job (run weekly + on-demand by SUPPORT):
1. For each tenant, walks the chain from the genesis row to the latest.
2. Recomputes every `rowHash` and compares to the stored value.
3. Compares the daily anchor's `lastRowHash` to the chain's hash at end-of-day.
4. Reports any mismatch.

A mismatch indicates either a bug (unlikely — tested) or tampering (the database was modified outside the application). The response is `DISASTER_RECOVERY.md` §5 (breach runbook).

### 5.3 Why this works
An attacker with database `UPDATE` privileges who modifies an `AuditLog` row must:
- Recompute that row's `rowHash`.
- Recompute every subsequent row's `rowHash` (because each includes the previous).
- Modify the daily anchors in S3 (which is object-locked — they cannot).

The chain makes tampering computationally detectable; the S3 anchors make it computationally evident.

---

## 6. Retention Policy

The audit log retention follows a hot/cold model:

| Tier | Storage | Retention | Query speed |
|---|---|---|---|
| Hot | Primary Postgres `AuditLog` table | 90 days | < 100 ms (indexed) |
| Cold | S3 + Glacier (per-tenant, encrypted SSE-KMS) | 7 years | minutes to hours (restore on demand) |
| Anchor | S3 Object Lock (write-once) | 7 years (matching cold) | < 1 s (read-only) |

A daily worker moves rows older than 90 days to cold storage:
1. Selects `AuditLog` rows with `createdAt < now - 90d`, ordered by chain.
2. Writes them to a Parquet file in the tenant's `dataResidencyRegion` S3 bucket.
3. Verifies the Parquet row count matches the SQL row count.
4. Deletes the SQL rows (in batches, within transactions, to avoid lock contention).
5. Records the daily anchor (§5.1) before deletion.

### 6.1 Why 7 years
- Ghana Act 843: personal data retained no longer than necessary, but financial records are 6 years minimum (Income Tax Act).
- Nigeria NDPR: similar "no longer than necessary" with sector-specific retention.
- 7 years covers both with margin; longer retention is available on legal-hold.

### 6.2 Restoration
Cold-tier data is restored on demand for compliance investigations. The `POST /api/v1/admin/audit/restore` endpoint (SUPPORT-only) takes a date range and tenant, queues a restore job, and writes the restored rows to a separate `AuditLogCold` table for query (the primary `AuditLog` is never modified). The restore job is audited as `AUDIT_COLD_RESTORED`.

---

## 7. Audit Query, Filter, Export API

### 7.1 Query
```
GET /api/v1/audit?action=AUTH_*&actorUserId=…&from=2025-01-01&to=2025-01-31&limit=100&cursor=…
```

Filters:
- `action` (exact or `*` wildcard prefix, e.g. `AUTH_*`).
- `actorUserId` (exact).
- `entityType`, `entityId` (exact).
- `organizationId` (defaults to caller's active tenant; `SUPER_ADMIN`/`SUPPORT` can override).
- `from`, `to` (ISO date range).
- `metadata.<key>` (exact match on a metadata JSON field — limited to indexed keys).

Returns a paginated list with cursor pagination (see `API_CONVENTIONS.md`).

### 7.2 Required permission
- Within own tenant: `audit.read` (granted to `manager`, `admin`, `owner`).
- Cross-tenant: `audit.read.any` (granted to `SUPER_ADMIN`, `SUPPORT`); every cross-tenant read is itself audited as `AUTHZ_CROSS_TENANT_READ`.

### 7.3 Export
```
POST /api/v1/audit/export
  { action: "AUTH_*", from: "2025-01-01", to: "2025-01-31", format: "csv" }
```

Queues an export job. Output formats: `csv` (RFC 4180), `json` (one object per line, NDJSON), `pdf` (formatted report). The export is written to a per-tenant S3 bucket in the tenant's `dataResidencyRegion`. The user receives an email with a pre-signed URL (7-day validity). The export is audited as `AUDIT_EXPORTED` with the filter criteria.

### 7.4 SIEM integration (M3)
In M3, an OpenTelemetry collector subscribes to the outbox's `identity.*` and `organization.*` events and forwards them to the SIEM (Splunk, Elastic, or Datadog). The SIEM correlates identity events with network and application logs for threat detection. The M2 outbox already publishes every event the SIEM needs.

---

## 8. SOC Dashboards

The SOC team uses three dashboards built on top of the audit log:

### 8.1 Authentication health
- Login success rate (last 24h) — green ≥ 95 %, yellow 85–95 %, red < 85 %.
- Failed-login top sources (IP hash, country) — anomaly detection flags any IP with > 50 failures/hour.
- Account-lockout rate (last 24h).
- MFA step-up rate (last 24h) — high rate may indicate a credential-stuffing campaign.
- Risk-score distribution histogram.

### 8.2 Authorization denials
- Top-denied permissions (last 7d).
- Top-denied actors (last 7d) — may indicate a misconfigured role or a probing attacker.
- Cross-tenant read count (last 7d) — should be near-zero; spikes page SUPPORT.

### 8.3 Compliance posture
- Audit-chain verification status (green = all chains verified, red = any mismatch).
- Pending data-subject requests (export/deletion) with deadlines.
- Cold-tier restore jobs in flight.
- Audit log row count per tenant (last 24h) — anomaly detection flags a tenant with abnormally low or high volume.

---

## 9. Cross-References

| Topic | Document |
|---|---|
| Audit platform integration with outbox + event bus | `ARCHITECTURE.md` §8.1 |
| `LoginHistory` model and forensics use | `SESSION_SECURITY.md` §9 |
| Cross-tenant read auditing | `MULTI_TENANCY.md` §3.1 |
| Breach runbook (force global password reset, revoke sessions, notify) | `DISASTER_RECOVERY.md` §5 |
| Audit REST API (`GET /audit`, `POST /audit/export`) | `API_REFERENCE.md` |
