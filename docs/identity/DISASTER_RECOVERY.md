# Eks-Food IAM — Disaster Recovery

> **Audience:** On-call identity maintainers, DBAs, security incident responders. Read alongside `OPERATIONS_RUNBOOK.md` (M1 platform runbooks), `AUDIT_AND_COMPLIANCE.md` (audit-chain integrity), and `SECURITY_HARDENING.md` (preventive controls).
>
> **Status:** M2 target architecture. Identity is a critical-path system: if it is down, no one can log in. This document covers the recovery procedures for the four failure modes that matter most for IAM: credential-store loss, session-store loss, database recovery, and key compromise. The breach runbook in §5 is the most important section — read it before you need it.

---

## 1. Failure-Mode Catalogue

| Failure | Severity | User impact | Recovery time objective |
|---|:---:|---|:---:|
| Credential-store loss (User/Identity table) | Sev-1 | No one can log in | < 4 h (PITR restore) |
| Session-store loss (Redis cache) | Sev-3 | Active sessions invalid; users re-login | < 5 min (cache rebuild) |
| Database loss (Postgres primary) | Sev-1 | Total platform outage | < 4 h (failover to replica) |
| Cookie-signing key compromise | Sev-1 | All sessions forgeable | < 1 h (key rotation) |
| MFA-encryption key compromise | Sev-1 | All TOTP secrets forgeable | < 4 h (key rotation + force re-enrol) |
| Argon2 parameter change | Sev-4 | None (lazy migration on next login) | N/A |
| Audit-log table loss | Sev-2 | Compliance gap; SIEM blind | < 8 h (restore from cold) |
| WebAuthn RP ID change | Sev-1 | All passkeys invalid; users re-enrol | < 4 h (notification + re-enrol) |
| Outbox relay stall | Sev-2 | Notifications delayed; downstream stale | < 30 min (worker restart) |
| Single-AZ outage | Sev-2 | Partial degradation | < 30 min (multi-AZ failover) |
| Region outage | Sev-1 | Full regional outage | < 4 h (cross-region failover) |

---

## 2. Credential Backup & Recovery

### 2.1 Portability of Argon2 hashes
Argon2id hashes are stored in PHC format (`$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`; see `AUTHENTICATION_FLOWS.md` §1.1). This format is:
- **Portable** across Argon2 implementations (the reference C library, the `@node-rs/argon2` Rust binding, the `argon2-browser` WASM build).
- **Self-describing** — the parameters are embedded in the string, so a hash produced with the current parameters can be verified by a future library version that defaults to different parameters.
- **Backward-compatible** — when we raise the iteration count (e.g. from `t=3` to `t=4`), existing hashes remain valid. On the next successful login, the `PasswordHasher.verify` detects the parameter mismatch and `rehash` produces a fresh hash with the new parameters (the `CredentialAggregate.rotate` method in `src/packages/domain/contexts/identity/aggregates.ts`).

### 2.2 Database backups
The `User`, `Identity`, `MFAConfiguration`, `RecoveryCode`, `Membership`, and `Role` tables are part of the standard Postgres backup:
- **Daily snapshot** to S3 in the tenant's `dataResidencyRegion` (per `MULTI_TENANCY.md` §9).
- **Continuous WAL archiving** to S3 with a 5-minute RPO (point-in-time recovery to any second within the last 35 days).
- **Weekly full backup** to a separate bucket (object-locked, 7-year retention matching the audit retention).

### 2.3 Recovery procedure — credential-store loss
1. On-call declares Sev-1, opens the incident channel, pages the DBA.
2. DBA launches the PITR restore job: `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier eks-prod --target-db-instance-identifier eks-prod-recovered --restore-time 2025-01-15T10:00:00Z`.
3. While the restore runs (~30–60 min), the on-call:
   - Switches the Caddy edge to a static "Maintenance" page (no logins possible anyway).
   - Notifies SUPPORT that all logins are failing.
4. Once the restored instance is available, DBA promotes it to primary (DNS cutover via `EKS_DB_HOST` env var change + rolling restart).
5. On-call verifies: `curl /api/v1/health?deep=true` → 200, then test-login as a known user.
6. Caddy edge flips back to normal.
7. Post-incident: audit-log gap analysis (any writes between the PITR time and the failure are lost; reconcile from outbox replay where possible).

### 2.4 Credential material is the only "irreplaceable" data
- User preferences, sessions, login history can be regenerated or tolerated as lost.
- Password hashes, MFA secrets, recovery codes, WebAuthn public keys **cannot** be regenerated — losing them forces every user to re-authenticate via account recovery (`AUTHENTICATION_FLOWS.md` §12), which is a multi-day SUPPORT burden.
- Therefore: the credential tables are backed up with the highest frequency (5-min WAL) and tested monthly via a restore drill.

---

## 3. Session-Store Resilience

The session store is **Postgres** (the `Session` table), not Redis. This is a deliberate choice: sessions are critical and Postgres gives us ACID + PITR. Redis is used only for:
- Rate-limit counters (transient — a Redis loss resets all counters; clients see higher limits for 60 s).
- Idempotency-Key cache (transient — a Redis loss means some retried POSTs may double-execute; the outbox + idempotency-Key at the database layer catches duplicates).
- Magic-link / OTP tokens (transient — a Redis loss invalidates outstanding tokens; users must request a fresh magic link / OTP).
- Risk-score cache (transient — a Redis loss means risk is recomputed on every request for up to 60 s, increasing load on the IP-reputation provider).

### 3.1 Redis loss
If Redis is unavailable:
1. The `@eks/cache` registry falls back to the in-memory cache (single-process; per-pod).
2. The session lookup still hits Postgres (no fallback needed — it's the source of truth).
3. Magic-link / OTP flows return `503 Service Unavailable` for new requests (existing tokens are lost).
4. Rate-limit counters reset — clients see full quota for up to 60 s (acceptable).
5. The risk-score cache misses — every request hits the IP-reputation provider; the provider has its own rate limit, so we may need to back off (the `RiskScoringService` degrades gracefully: if the provider is unavailable, risk score defaults to the session's last-known score + 10).

**User-visible impact:** users with an existing session continue working. Users mid-magic-link-flow must re-request. New logins work (password / passkey) but skip the rate-limit (acceptable for a short outage).

### 3.2 Forced re-login
If both Postgres and Redis are unavailable (catastrophic), the platform cannot validate any session and the edge returns `503`. Once Postgres is restored, all pre-existing sessions are still valid (they were never lost — the Session table is in Postgres). Only sessions created during the outage are missing (none, because no logins could occur).

If we **must** force a global re-login (e.g. as part of a breach response — see §5), the procedure is:
```
UPDATE Session SET status='REVOKED', revokeReason='global_force_relogin', revokedAt=now()
WHERE status='ACTIVE';
```
This is a single SQL statement (millions of rows in a few seconds on a typical Postgres instance). Every subsequent request fails the session lookup and returns `401`; users must re-authenticate.

---

## 4. Database Recovery (Point-in-Time Recovery)

The IAM tables (`User`, `Identity`, `Session`, `Device`, `Membership`, `Invitation`, `MFAConfiguration`, `RecoveryCode`, `AuditLog`, `LoginHistory`, `UserPreference`, `TenantConfiguration`, `FeatureFlagAssignment`, `Role`, `Permission`, `Policy`, `Team`, `Organization`) live in the primary Postgres database. Recovery is the standard PITR flow:

### 4.1 PITR procedure
1. Identify the recovery point (the failure time minus a safety margin — typically 5 min before the reported failure).
2. DBA: `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier eks-prod --target-db-instance-identifier eks-prod-recovered --restore-time <recovery-point>`.
3. The new instance is created in ~30–60 min (depending on WAL volume).
4. DBA verifies the restored instance: row counts on `User`, `Session`, `AuditLog` match the pre-failure baseline.
5. DBA promotes the restored instance: update `EKS_DB_HOST`, trigger a rolling restart of the API pods.
6. On-call verifies health, then re-enables the edge.

### 4.2 PITR for identity tables only (selective)
If only the identity tables need recovery (e.g. a botched migration dropped the `Identity` table), we restore the entire database to a new instance, then `pg_dump` the identity tables from the restored instance and `pg_restore` them into the live primary inside a maintenance window.

### 4.3 PITR limitations
- **Cannot recover data after the PITR point.** Any writes between the recovery point and the failure are lost. For identity tables, this means: users who registered, sessions created, role changes made in that window are gone. The audit log on the restored instance reflects the recovery point, not the failure time.
- **Audit-log chain integrity.** Restoring the `AuditLog` table from PITR may break the hash chain (§5 of `AUDIT_AND_COMPLIANCE.md`) if rows were inserted after the recovery point. The verification job will flag the gap. The on-call records the gap in the incident report; the chain resumes from the recovery point forward.
- **Outbox replay.** The `EventOutbox` table is also restored. Any events staged after the recovery point are gone; subscribers will not receive them. The on-call identifies the lost events (by comparing the restored outbox to the SIEM's record of received events) and re-stages critical ones manually.

---

## 5. Incident Runbook — Credential Breach

This is the most important procedure in this document. Read it now, not when you need it.

### 5.1 When to invoke
A credential breach is confirmed when **any** of:
- The `AuditLog` chain verification fails (§5 of `AUDIT_AND_COMPLIANCE.md`) — someone modified the database outside the application.
- An attacker publicly posts Eks-Food password hashes (e.g. on a crime forum).
- A former employee with database access is identified as a threat.
- A dependency discloses a vulnerability that may have exposed `EKS_AUTH_COOKIE_SECRET` or `EKS_AUTH_MFA_ENCRYPTION_KEY`.
- A `SUPER_ADMIN` account is observed behaving anomalously (impossible travel, mass role grants, mass session revocations).

### 5.2 Severity
Sev-1. Page the on-call, the security lead, the CTO, and (for ≥ 1000 users affected) the data-protection officer. Open a war room. Start the incident clock.

### 5.3 Containment (first 30 minutes)
1. **Revoke all sessions.**
   ```
   UPDATE Session SET status='REVOKED', revokeReason='breach_response', revokedAt=now()
   WHERE status='ACTIVE';
   ```
   Every active session dies. Users must re-authenticate.
2. **Disable password login** (keep passkey / SSO if available).
   ```
   UPDATE Identity SET status='REVOKED', updatedAt=now()
   WHERE type='password' AND status='ACTIVE';
   ```
   This forces every password user through password reset (§5.5).
3. **Rotate `EKS_AUTH_COOKIE_SECRET`** (§6). Deploy immediately. Old session cookies become unverifiable.
4. **Rotate `EKS_AUTH_MFA_ENCRYPTION_KEY`** (§6). Existing TOTP secrets become unreadable; users must re-enrol MFA.
5. **Block new registrations** (feature-flag `auth.registration` off) until the breach scope is understood.
6. **Notify SUPPORT** to expect a flood of "I can't log in" tickets. Publish a status-page incident.

### 5.4 Investigation (first 4 hours)
1. **Pull the audit log** for the suspected breach window:
   ```
   GET /api/v1/audit?from=<window-start>&to=<window-end>&action=AUTH_*
   ```
   Cross-reference with the SIEM (network logs, database query logs).
2. **Identify affected users.** If the breach exposed a specific table (e.g. `Identity`), every user with an `Identity` row in the breach window is "affected".
3. **Check the audit chain.** Run the verification job (§5 of `AUDIT_AND_COMPLIANCE.md`). Any chain break indicates the attacker modified the audit log itself — escalate to law-enforcement notification.
4. **Determine the exfiltration vector.** Database backup leak? Insider with DB access? SQL injection in a forgotten endpoint? Stolen laptop with prod access keys? The vector determines the remediation.

### 5.5 Eradication (4–24 hours)
1. **Force global password reset.**
   - Mark every `Identity(type=password)` row `REVOKED` (already done in §5.3.2).
   - Send a "Reset your password" email to every affected user via `@eks/notifications` (rate-limited; can take hours for millions of users).
   - The password-reset flow (`AUTHENTICATION_FLOWS.md` §11) requires the user to click the emailed link and set a new password.
2. **Re-enrol MFA.**
   - Mark every `MFAConfiguration` row `RESET_PENDING`.
   - On next login (with the new password), the user is forced into the MFA enrolment flow (`MFA.md` §4).
3. **Rotate WebAuthn credentials if the breach exposed `Identity(type=webauthn)` rows.**
   - Public keys are not secret, but if the attacker can substitute them (DB write access), every passkey must be re-enrolled.
   - Mark every `Identity(type=webauthn)` row `REVOKED`. Users must re-enrol their passkeys.
4. **Rotate all secrets** that may have been exposed:
   - `EKS_AUTH_COOKIE_SECRET` (already done in §5.3.3).
   - `EKS_AUTH_MFA_ENCRYPTION_KEY` (already done in §5.3.4).
   - `EKS_IP_HASH_SALT` (forces all `ipHash` values to become uncorrelatable — acceptable; new hashes are fresh).
   - `EKS_DB_PASSWORD` (in case the attacker has DB credentials).
   - Provider API keys (Twilio, SMTP) — in case the breach exposed env vars.
5. **Apply the security patch** that fixes the breach vector.

### 5.6 Recovery (24 hours – 7 days)
1. **Re-enable registration** once the breach vector is patched and verified.
2. **Re-enable password login** (it was disabled in §5.3.2).
3. **Monitor** for anomalous login patterns (the SOC dashboards, §8 of `AUDIT_AND_COMPLIANCE.md`).
4. **User communications.** Send a clear, honest breach notification to every affected user within 72 hours of discovery (GDPR Article 33 / NDPR / Act 843 requirement). The notification includes:
   - What happened.
   - What data was exposed.
   - What we did (forced password reset, rotated keys).
   - What the user must do (set a new password, re-enrol MFA).
   - How to contact us.
5. **Post-incident review** within 7 days. Document the timeline, the root cause, the remediation, the lessons learned, and the follow-up actions (with owners and due dates).

### 5.7 Regulatory notification
- **GDPR (if EU users affected):** notify the supervisory authority within 72 hours of becoming aware of the breach.
- **Ghana Act 843:** notify the Data Protection Commission "without undue delay".
- **Nigeria NDPR:** notify the Nigeria Data Protection Bureau within 72 hours.
- **PCI DSS** (if card data — unlikely, since Payswap stores it — but verify): notify the acquiring bank.

The DPO owns the regulatory notifications. The incident commander ensures they happen within the deadlines.

---

## 6. Key Rotation

### 6.1 Cookie-signing keys (`EKS_AUTH_COOKIE_SECRET`)
The cookie-signing key is rotated quarterly (and immediately on breach). The rotation uses a **dual-key window**:

1. Deploy with `EKS_AUTH_COOKIE_SECRET_NEW=<new-key>` while `EKS_AUTH_COOKIE_SECRET=<old-key>` remains.
2. The `verifyCookie` function checks against both keys (try new first, fall back to old).
3. The `signCookie` function signs only with the new key.
4. After 30 days (the max refresh-token TTL — every active session has refreshed at least once with the new key), deploy with `EKS_AUTH_COOKIE_SECRET=<new-key>` only and remove the old.

This dual-key window ensures no sessions are invalidated by the rotation.

### 6.2 MFA encryption keys (`EKS_AUTH_MFA_ENCRYPTION_KEY`)
The MFA-encryption key encrypts the `MFAConfiguration.totpSecret` column at the application layer. Rotation is more involved because every existing ciphertext must be re-encrypted:

1. Deploy with `EKS_AUTH_MFA_ENCRYPTION_KEY_NEW=<new-key>`.
2. A background job walks `MFAConfiguration` rows:
   - Decrypt `totpSecret` with the old key.
   - Re-encrypt with the new key.
   - UPDATE the row.
   - Audit `MFA_KEY_ROTATED`.
3. The job processes 100 rows per batch (to avoid lock contention) and can be paused/resumed.
4. After the job completes (a few hours for millions of rows), deploy with `EKS_AUTH_MFA_ENCRYPTION_KEY=<new-key>` only.

On breach (§5), we do **not** rotate lazily — we mark every `MFAConfiguration` `RESET_PENDING` and force re-enrolment. This is faster and avoids the risk that the attacker with the old key can still decrypt.

### 6.3 WebAuthn RP ID
The WebAuthn RP ID (`EKS_AUTH_WEBAUTHN_RP_ID`) **cannot** be rotated without invalidating every passkey. If the RP ID must change (e.g. domain rename from `eks.food` to `eks-food.com`):
1. Notify users 30 days in advance.
2. On cutover day, every `Identity(type=webauthn)` row is `REVOKED`.
3. Users must re-enrol passkeys against the new RP ID.
4. The old RP ID is retained read-only for 90 days for audit purposes.

This is a planned, communicated change — never an emergency.

---

## 7. Outbox Relay Stall

If the outbox relay worker stalls (the `outbox_pending_count` metric is rising), downstream subscribers stop receiving events. For identity, this means:
- Welcome emails, password-changed alerts, MFA-enabled emails do not send.
- `LoginHistory` projections stop updating.
- SIEM (M3) stops receiving identity events.

### 7.1 Detection
- The M1 `outbox_pending_count` metric crosses 1000 (yellow) or 10000 (red).
- The outbox relay worker's heartbeat stops appearing in logs.
- SUPPORT sees "I registered but didn't get a welcome email" tickets.

### 7.2 Mitigation
1. Restart the relay worker (`bun run workers:outbox-relay` or via the K8s deployment scale-up).
2. If the worker is running but not making progress, check the DB connection pool — the relay uses `SELECT FOR UPDATE SKIP LOCKED`, which can stall on a long-running transaction. Kill the blocking transaction.
3. If the outbox table itself is the bottleneck (millions of pending rows), scale up the worker count (env var `EKS_OUTBOX_WORKER_CONCURRENCY`) to drain faster.
4. Once the backlog is drained, verify downstream subscribers caught up (the `LoginHistory` row count for the last hour should match the `Session` insert count).

---

## 8. Single-AZ and Region Outage

### 8.1 Single-AZ outage
- Postgres primary fails over to the replica in another AZ (RDS Multi-AZ, < 60 s).
- API pods in the failed AZ are drained; the load balancer routes to healthy AZs.
- Redis (if ElastiCache Multi-AZ) fails over similarly.
- User impact: brief 503s during failover, then normal operation.

### 8.2 Region outage
A full region outage is Sev-1. Procedure:
1. Switch DNS to the secondary region (active-active in M3; active-passive in M2).
2. The secondary region's Postgres is a read replica in M2 — promote it to primary (`aws rds promote-read-replica`).
3. The M2 secondary has up to 5 minutes of data lag (async replication) — the lost writes are reconciled from the outbox replay once the primary region returns.
4. API pods in the secondary region scale up to handle full load.
5. Notify users via status page.

**Identity-specific considerations:**
- The `Session` table in the secondary may be up to 5 min stale. Users who logged in during the lag window must re-authenticate (their session is not in the promoted primary).
- The `AuditLog` chain may have a gap. The verification job will flag it; the on-call records the gap.
- The `EKS_AUTH_COOKIE_SECRET` is the same in both regions (synced via AWS Secrets Manager). Sessions continue to validate.

---

## 9. DR Drills

Quarterly DR drills verify the procedures above:

| Drill | Frequency | Owner | Pass criteria |
|---|---|---|---|
| PITR restore of identity tables | Quarterly | DBA | Restored DB matches baseline row counts; test login succeeds. |
| Forced global re-login | Annually | On-call + DBA | All sessions revoked in < 60 s; users can re-authenticate within 5 min. |
| Cookie-key rotation | Quarterly | On-call | Dual-key window deploys cleanly; no session invalidations. |
| MFA-key rotation | Annually | On-call | All `MFAConfiguration` rows re-encrypted within 4 h; test TOTP login succeeds. |
| Breach runbook tabletop | Annually | Security lead + on-call | Walk-through of §5; identify gaps; update runbook. |
| Audit-chain verification | Weekly (automated) | Worker | All chains verify; no tamper alerts. |
| Outbox backlog drain | Quarterly | On-call | 10 000-row backlog drains within 10 min. |

Drill results are recorded in the incident-management system; failures generate follow-up tickets.

---

## 10. Cross-References

| Topic | Document |
|---|---|
| Audit-chain verification (the detection mechanism for breach) | `AUDIT_AND_COMPLIANCE.md` §5 |
| Session revocation SQL, refresh-token reuse detection | `SESSION_SECURITY.md` §2 |
| Password reset flow, account recovery flow | `AUTHENTICATION_FLOWS.md` §11–§12 |
| MFA re-enrolment after key rotation | `MFA.md` §9 |
| M1 platform runbook (broader incident response) | `docs/OPERATIONS_RUNBOOK.md` |
| OWASP mapping (preventive controls that reduce breach likelihood) | `SECURITY_HARDENING.md` |
