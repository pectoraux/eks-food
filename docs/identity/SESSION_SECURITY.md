# Eks-Food IAM — Session Security

> **Audience:** Identity engineers, security reviewers, on-call. Read alongside `ARCHITECTURE.md` (§4 Session Model), `AUTHENTICATION_FLOWS.md` (§9 refresh-token rotation, §6 login with MFA), and `SECURITY_HARDENING.md` (OWASP A07 mapping).
>
> **Status:** M2 target architecture. The M1 `@eks/security/cookies` (signCookie/verifyCookie with HMAC-SHA256, constant-time compare) and `@eks/cache` (rate-limit + idempotency) are reused. M2 adds the `Session` and `Device` Prisma models, the refresh-token rotation reuse-detection algorithm, the device-fingerprinting abstraction, the risk-scoring engine, and the concurrent-session limiter.

---

## 1. Session Lifecycle

A `Session` row represents one authenticated device for one user in one tenant. Its lifecycle:

```
                ┌─────────────┐
                │   (none)    │
                └──────┬──────┘
                       │ POST /api/v1/auth/login (or magic-link / passkey / OIDC)
                       │ ① authenticate credential
                       │ ② compute device fingerprint
                       │ ③ compute initial risk score
                       │ ④ INSERT Session(status=ACTIVE, method=…, riskScore=…,
                       │     refreshFamilyId=uuid, refreshTokenHash=SHA256(tok),
                       │     issuedAt=now, expiresAt=now+15min,
                       │     lastSeenAt=now, idleExpiresAt=now+24h)
                       │ ⑤ INSERT LoginHistory
                       │ ⑥ stage identity.session.started.v1
                       │ ⑦ audit(AUTH_LOGIN)
                       │ ⑧ issue cookies
                       ▼
                ┌─────────────┐
                │   ACTIVE    │◀────────────────────────┐
                └──────┬──────┘                         │
                       │ every request:                │
                       │  • verifyCookie(__Host-eks.session) │
                       │  • Session.findActiveByAccessTokenHash │
                       │  • bump lastSeenAt            │
                       │  • if now > idleExpiresAt → EXPIRED │
                       │  • if now > expiresAt and refresh │
                       │    token used → refresh cycle │
                       │  • recompute riskScore (cached) │
                       │  • if risk ≥ 90 → REVOKE      │
                       │                                │
                       │ POST /api/v1/auth/refresh      │
                       │ (every 15 min, by the SPA)     │
                       │ ① verifyCookie(refresh)        │
                       │ ② Session.findByRefreshTokenHash │
                       │ ③ REUSE DETECTION (see §2)     │
                       │ ④ rotate refresh token         │
                       │ ⑤ update Session.refreshTokenHash, │
                       │   previousRefreshTokenHash,    │
                       │   expiresAt, lastSeenAt        │
                       │ ⑥ recompute riskScore          │
                       │ ⑦ issue new cookies            │
                       │ ⑧ stage identity.session.refreshed.v1 │
                       │ ⑨ audit(AUTH_REFRESH)          │
                       └────────────────────────────────┘
                       │
                       │ 4 ways a session ends:
                       │ ① idle timeout (now > idleExpiresAt)
                       │ ② absolute timeout (now > issuedAt + 30d)
                       │ ③ user-initiated logout (POST /api/v1/auth/logout)
                       │ ④ admin-initiated revoke (POST /api/v1/sessions/{id}/revoke)
                       │ ⑤ risk-driven revoke (riskScore ≥ 90)
                       │ ⑥ refresh-token reuse detected (revoke family)
                       │ ⑦ concurrent-session limit exceeded (oldest revoked)
                       │ ⑧ password reset (revoke all sessions for the user)
                       ▼
                ┌─────────────┐
                │  REVOKED    │  (revokedAt, revokeReason set)
                │  or EXPIRED │  (expiredAt set; no revokeReason)
                └─────────────┘
                       │
                       │ Retention: 90 days for forensics, then archived to cold storage.
                       ▼
                ┌─────────────┐
                │  ARCHIVED   │  (cold storage, read-only)
                └─────────────┘
```

### 1.1 Timeouts

| Timeout | Default | Env var | Notes |
|---|---|---|---|
| Access token TTL | 15 min | `EKS_AUTH_ACCESS_TOKEN_TTL_MS` | The `__Host-eks.session` cookie expires; the SPA must refresh before this. |
| Refresh token absolute TTL | 30 d | `EKS_AUTH_REFRESH_TOKEN_TTL_MS` | Even with continuous refresh, the session dies at 30 d. The user must re-authenticate. |
| Idle timeout | 24 h | `EKS_AUTH_IDLE_TIMEOUT_MS` | If `now - lastSeenAt > idle timeout`, the next request revokes the session. |
| Concurrent-session limit | 5 | `EKS_AUTH_MAX_CONCURRENT_SESSIONS` | Per user; oldest is revoked when the 6th login happens. |

Per-tenant overrides come from `TenantConfiguration.sessionPolicy` (JSON: `{ accessTtlMs, refreshTtlMs, idleTimeoutMs, maxSessions }`).

### 1.2 Session record

```prisma
model Session {
  id              String   @id @default(cuid())
  userId          String
  organizationId  String
  // Status
  status          String   @default("ACTIVE") // ACTIVE | EXPIRED | REVOKED
  method          String   // password | otp | sso | api_key | webauthn | magic_link | impersonation
  // Tokens (opaque blobs; only hashes are stored)
  accessTokenHash     String   @unique
  refreshTokenHash    String   @unique
  previousRefreshTokenHash String?  // for reuse detection
  refreshFamilyId     String   // groups all tokens derived from one login
  // Timeouts
  issuedAt        DateTime @default(now())
  expiresAt       DateTime          // access TTL
  absoluteExpiresAt DateTime        // issuedAt + 30d
  lastSeenAt      DateTime @default(now())
  idleExpiresAt   DateTime          // lastSeenAt + idle TTL
  revokedAt       DateTime?
  revokeReason    String?           // user_logout | admin_revoke | reuse_detected | risk_too_high | idle_timeout | absolute_timeout | concurrent_limit | password_reset
  // Risk
  riskScore       Int      @default(0)  // 0..100
  riskFactors     String   @default("[]") // JSON array of factor codes
  // Device + network (for audit; privacy-preserving)
  deviceId        String?
  ipHash          String?  // SHA-256 of IP, salted; never the raw IP
  ipCountry       String?
  ipRegion        String?
  userAgent       String?
  // Impersonation
  impersonatorUserId String?
  // Audit
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user            User     @relation(fields: [userId], references: [id])
  organization    Organization @relation(fields: [organizationId], references: [id])
  device          Device?  @relation(fields: [deviceId], references: [id])

  @@index([userId, status])
  @@index([refreshFamilyId])
  @@index([organizationId, status])
}
```

---

## 2. Refresh-Token Rotation — Reuse Detection

This is the **primary** defence against token theft (the OWASP-recommended pattern). The algorithm is in `@eks/auth/refresh.ts`:

```
On every POST /api/v1/auth/refresh:

  presentedToken = verifyCookie(__Host-eks.refresh, COOKIE_SECRET) // raw opaque token
  if !presentedToken → 401 AUTH_INVALID_CREDENTIALS

  presentedHash = SHA256(presentedToken)
  session = Session.findActiveByRefreshTokenHash(presentedHash)

  ┌── Case A: session found and active ────────────────────────────┐
  │  Normal refresh path:                                          │
  │    1. newRefreshToken = randomBytes(32) + familyId (encrypted) │
  │    2. BEGIN TX                                                  │
  │       UPDATE Session                                            │
  │         previousRefreshTokenHash = refreshTokenHash            │
  │         refreshTokenHash = SHA256(newRefreshToken)             │
  │         expiresAt = now + ACCESS_TTL                            │
  │         lastSeenAt = now                                        │
  │         idleExpiresAt = now + IDLE_TTL                          │
  │         riskScore = recompute(...)                              │
  │       stage identity.session.refreshed.v1                       │
  │       audit(AUTH_REFRESH)                                       │
  │    COMMIT                                                       │
  │    3. issue new cookies                                         │
  │    return 200                                                   │
  └─────────────────────────────────────────────────────────────────┘

  ┌── Case B: session found but its refreshTokenHash != presentedHash
  │           AND its previousRefreshTokenHash == presentedHash ────┐
  │  REUSE DETECTED — an attacker has captured the old token and    │
  │  is presenting it AFTER the legitimate client already refreshed.│
  │    1. revoke entire family:                                     │
  │       Session.revokeAllByFamily(refreshFamilyId,                │
  │         reason="reuse_detected")                                │
  │    2. audit(AUTH_SESSION_REUSE_DETECTED)                        │
  │    3. stage identity.session.revoked.v1 (reason=reuse_detected) │
  │    4. @eks/notifications → email the user:                      │
  │       "Suspicious activity detected on your account —           │
  │        please sign in again."                                    │
  │    return 401 AUTH_SESSION_REVOKED                              │
  └─────────────────────────────────────────────────────────────────┘

  ┌── Case C: session found but status=REVOKED or EXPIRED ─────────┐
  │  return 401 AUTH_SESSION_EXPIRED (if EXPIRED)                  │
  │           or AUTH_SESSION_REVOKED (if REVOKED)                 │
  └─────────────────────────────────────────────────────────────────┘

  ┌── Case D: no session found for presentedHash ──────────────────┐
  │  The token is invalid OR (more dangerously) belongs to a       │
  │  family we don't recognise. Look up by familyId embedded in   │
  │  the encrypted token payload:                                   │
  │    if familyId known:                                           │
  │      revoke entire family (reuse detected — see Case B)        │
  │    else:                                                        │
  │      log anomaly, return 401 AUTH_INVALID_CREDENTIALS          │
  └─────────────────────────────────────────────────────────────────┘
```

**Family revocation.** When reuse is detected, **every session in the family** is revoked — not just the one with the reused token. This is critical: an attacker who has captured a refresh token has likely also captured the access token; both must die. The legitimate user must re-authenticate.

**Why opaque tokens (not JWTs)?** JWT refresh tokens are stateless — the server cannot revoke them without a blocklist, which defeats the purpose. Opaque tokens (random bytes the server hashes and stores) make revocation trivial: delete the row.

### 2.1 Token shape

The opaque token is a base64url-encoded concatenation of:
- 32 random bytes (the entropy).
- 16 bytes encoding the `refreshFamilyId` (so Case D can look up the family even when the hash is unknown).
- An HMAC-SHA256 tag over the above, keyed by `EKS_AUTH_COOKIE_SECRET`.

The cookie carries this opaque token; the server stores only `SHA256(opaqueToken)` (so a database leak does not immediately yield usable tokens — the attacker would still need the HMAC key).

---

## 3. Device Fingerprinting Abstraction

A `Device` row identifies a physical browser/app installation in a privacy-respecting way. The M2 device fingerprint is **not** a canvas/WebGL fingerprint (which is fragile and privacy-invasive); it is a coarse, stable composite:

```
deviceFingerprint = SHA256(
  userAgent.normalize(),         // UA-CH high-entropy brands + version
  acceptLanguage,                // first 2 chars (e.g. "en")
  screenColorDepth + screenOrientation,
  timezone,                      // IANA tz, e.g. "Africa/Accra"
  hardwareConcurrency_bucket,    // 2|4|8|16+ (bucketed)
  deviceMemory_bucket,           // 2|4|8+ (bucketed)
  platform,                      // "macOS" | "Windows" | "iOS" | "Android" | "Linux"
  deviceIdCookie                 // long-lived random cookie (1y) — the only
                                 // piece that uniquely identifies the device
).base64url
```

The `deviceIdCookie` (`__Host-eks.device`, `SameSite=Lax`, `Max-Age=31536000`, `HttpOnly`) is the primary identifier. The other components are **context** — they are checked for drift, not used as the identifier. If a session's stored fingerprint context drifts (e.g. the timezone changes mid-session), the risk score increases by 15 (a possible session hijack where the attacker is in a different TZ).

```prisma
model Device {
  id              String   @id @default(cuid())
  userId          String
  organizationId  String
  // Fingerprint
  fingerprintHash String   // SHA256 of the composite
  // Context (for risk scoring + UI display)
  userAgent       String
  platform        String
  browser         String
  deviceName      String?  // "Amara's iPhone", set by user
  // Trust
  trusted         Boolean  @default(false)  // user-marked "don't challenge"
  trustedAt       DateTime?
  trustedUntil    DateTime?
  // First/last seen
  firstSeenAt     DateTime @default(now())
  lastSeenAt      DateTime @default(now())
  // Audit
  createdAt       DateTime @default(now())
  @@unique([userId, organizationId, fingerprintHash])
  @@index([userId, organizationId])
}
```

### 3.1 Trusted devices
A user can mark a Device as "trusted" via `POST /api/v1/sessions/devices/{id}/trust` (requires a fresh MFA verification). Trusted devices:
- Skip step-up MFA when the risk score is in the 70–89 range.
- Skip the new-device alert email.
- Have a `trustedUntil` of 90 days; after that, trust expires and must be renewed.

A user with a compromised device can mark it untrusted (or revoke it) from `GET /api/v1/sessions` → `DELETE /api/v1/sessions/devices/{id}`. This revokes every session bound to the device.

### 3.2 New-device alert
On the first login from a new Device, `@eks/notifications` sends an email:
> We noticed a new sign-in to your Eks-Food account from:
> Chrome on macOS · Accra, Ghana · 2025-01-15 14:30 GMT
> If this was you, no action is needed. If not, [revoke this session].

This is implemented as a subscriber to `identity.session.started.v1` that checks if the `deviceId` was first-seen in the last 5 minutes and emails accordingly.

---

## 4. Risk Scoring

Every session carries a `riskScore` 0–100. The score is computed at issue time, re-computed at refresh, and a cached version is consulted on every request (TTL 60s — short enough to catch mid-session drift, long enough to avoid hammering the IP-reputation provider).

### 4.1 Factors

| Factor | Code | Score contribution |
|---|---|---|
| IP reputation: known-bad IP | `ip_reputation_bad` | +50 |
| IP reputation: TOR exit node | `ip_tor` | +40 |
| IP reputation: known VPN/proxy | `ip_vpn` | +15 |
| IP reputation: datacenter IP | `ip_datacenter` | +20 |
| New device (first time we've seen this fingerprint) | `new_device` | +25 |
| Untrusted device | `untrusted_device` | +10 |
| New country (different from user's last successful login) | `new_country` | +30 |
| Geo-velocity > 500 km/h (impossible travel) | `impossible_travel` | +50 |
| Geo-velocity > 200 km/h (unlikely travel) | `unlikely_travel` | +25 |
| Login at unusual hour (off the user's normal pattern) | `unusual_hour` | +10 |
| User-Agent drift mid-session | `ua_drift` | +15 |
| Timezone drift mid-session | `tz_drift` | +15 |
| Failed login in the last hour on the same Identity | `recent_failure` | +15 |
| Privileged role (SUPER_ADMIN, SUPPORT, ADMIN) | `privileged_role` | baseline 30 |
| Tenant switch to unfamiliar org | `tenant_switch_unfamiliar` | +20 |
| Passkey authentication (WebAuthn) | `passkey_factor` | −20 (phishing-resistant) |
| MFA verified at login | `mfa_factor` | −10 |

The final score is the sum, clamped to [0, 100]. The `riskFactors` JSON array on the Session row records which factors fired (for audit + UI display).

### 4.2 Thresholds

| Score range | Action |
|---|---|
| 0–69 | No action — request proceeds. |
| 70–89 | Step-up MFA demanded. The request returns `401 AUTH_MFA_REQUIRED` with a fresh `mfaChallengeId`; the user must verify a TOTP / passkey before the request is retried. Trusted devices skip this (see §3.1). |
| 90–100 | Session revoked. The user must re-authenticate from scratch. `AUTH_DEVICE_UNTRUSTED` is returned; the user is emailed an alert. |

### 4.3 IP reputation provider

The `IpReputationProvider` interface (in `@eks/security`):

```ts
export interface IpReputationProvider {
  /** Returns the reputation verdict for an IP. Cached 5 min per IP. */
  lookup(ip: string): Promise<{
    bad: boolean;
    tor: boolean;
    vpn: boolean;
    datacenter: boolean;
    country: string;
    region: string;
    city: string;
  }>;
}
```

M2 ships a `MockIpReputationProvider` (returns `{bad:false, …, country:"GH", region:"Greater Accra", city:"Accra"}` for everything). M3 will wire `ipqualityscore` or `maxmind` via the same interface — no application code changes.

The IP itself is **never stored**; only `ipHash = SHA256(ip + EKS_IP_HASH_SALT)` is persisted. The country/region/city (from the provider) are stored as coarse strings for the UI ("Signed in from Accra, Ghana").

### 4.4 Geo-velocity

The `GeoVelocityService` keeps a rolling window of the user's last 5 successful login locations (latitude/longitude, from the IP-reputation provider's city lookup). On each new login:
- Compute great-circle distance from the most recent prior location.
- Compute elapsed time.
- If `distance / elapsed > 500 km/h` → `impossible_travel` (+50).
- If `distance / elapsed > 200 km/h` → `unlikely_travel` (+25).

The threshold is intentionally below commercial-airline speed so a same-day flight from Accra to Lagos (which is plausible) does not trigger `impossible_travel` but does trigger `unlikely_travel` (+25) — combined with `new_country` (+30) and `new_device` (+25), the total is 80, demanding step-up MFA.

---

## 5. Concurrent-Session Limits

A user may have at most `EKS_AUTH_MAX_CONCURRENT_SESSIONS` (default 5) active sessions. When the 6th login occurs:

1. The oldest active session (by `issuedAt`) is selected.
2. It is revoked with `revokeReason="concurrent_limit"`.
3. `identity.session.revoked.v1` is staged.
4. `audit(AUTH_SESSION_REVOKED, reason=concurrent_limit)` is written.

The user is emailed: "Your oldest session (Chrome on macOS, last seen 2025-01-08) was signed out because you reached the 5-session limit."

Per-tenant overrides: `TenantConfiguration.sessionPolicy.maxSessions` can lower (never raise) the limit for sensitive tenants.

---

## 6. Remote Revocation

A user can review and revoke their active sessions:

```
GET /api/v1/sessions
  → 200 { data: [
       { id, device: { name, platform, browser }, ipCountry, ipRegion,
         lastSeenAt, issuedAt, riskScore, current: true|false },
       …
     ] }

DELETE /api/v1/sessions/{id}
  → 204 (revokes the specified session, reason="user_revoke")
  → 403 if the session belongs to another user (the repo scope enforces this)

POST /api/v1/sessions/revoke-all
  → 204 (revokes ALL the user's sessions including the current one;
         the SPA must re-authenticate)
```

`SUPER_ADMIN` and `SUPPORT` (with `session.revoke.any` permission) can revoke any user's sessions via `POST /api/v1/admin/users/{id}/sessions/revoke-all`. This is the lever pulled by the breach runbook (`DISASTER_RECOVERY.md` §5).

---

## 7. Replay-Attack Mitigation

Replay attacks are mitigated by the combination of:

1. **Rotating refresh tokens** (§2) — a stolen refresh token is single-use; once the legitimate client rotates, the stolen token is invalid (and its use triggers family revocation).
2. **Device binding** — the access token is bound to the device fingerprint. If a request presents an access token from a device fingerprint that differs from the session's stored fingerprint, the risk score increases by 15 (`ua_drift` or `tz_drift`). If the drift is severe (different platform entirely), the session is revoked.
3. **Short access-token TTL** (15 min) — even if an access token is stolen, it is valid for at most 15 minutes; the next refresh would invalidate it (because the legitimate client refreshes first, and the attacker's stolen access token is replaced).
4. **TLS 1.3** (Caddy enforces) — tokens in transit are not interceptable by network-level attackers.
5. **`__Host-` cookie prefix** — the cookie cannot be set by a subdomain or non-HTTPS origin, preventing cookie-injection attacks.
6. **CSRF double-submit token** (see `AUTHENTICATION_FLOWS.md` §3) — prevents cross-site request forgery, which could otherwise replay the user's cookie on a state-changing endpoint.

### 7.1 Replay defence summary table

| Attack vector | Mitigation |
|---|---|
| Stolen refresh token | Rotation + reuse detection → family revocation |
| Stolen access token | Short TTL (15 min) + device binding |
| Network sniffing | TLS 1.3 |
| Cross-site request forgery | Double-submit CSRF token + SameSite=Lax cookies |
| Cookie injection from subdomain | `__Host-` prefix |
| XSS exfiltrating the cookie | `HttpOnly` cookie (JS cannot read it) |
| Stolen device | User can revoke from another device; new-device alert emails the user |
| Passkey replay | WebAuthn challenges are single-use + origin-bound + counter-checked |

---

## 8. Cookie Security Attributes (Quick Reference)

The full table is in `AUTHENTICATION_FLOWS.md` §2. Summary:

| Cookie | Purpose | TTL | HttpOnly | Secure | SameSite | Path |
|---|---|---|---|---|---|---|
| `__Host-eks.session` | Access token | 15 min | ✓ | ✓ | Lax | `/` |
| `__Host-eks.refresh` | Refresh token | 30 d | ✓ | ✓ | Lax | `/api/v1/auth/refresh` |
| `__Host-eks.csrf` | CSRF double-submit | 15 min | ✗ (JS reads it) | ✓ | Strict | `/` |
| `__Host-eks.device` | Device ID (for fingerprinting) | 1 y | ✓ | ✓ | Lax | `/` |

All four use the `__Host-` prefix (forces Secure + Path=/ + no Domain). All four are signed with `EKS_AUTH_COOKIE_SECRET` via `signCookie` in `src/packages/security/cookies.ts`.

---

## 9. Session Forensics

When investigating a suspected account takeover, the on-call pulls:

```
GET /api/v1/admin/users/{id}/login-history?from=2025-01-01&to=2025-01-31
GET /api/v1/admin/users/{id}/sessions?include=revoked
GET /api/v1/audit?actorUserId={id}&action=AUTH_*
```

The `LoginHistory` table records every login attempt (success or failure) with the IP hash, geo, UA, device fingerprint, MFA result, and risk score. The `Session` table (including `REVOKED` rows for 90 days) records every active and recently-ended session. The `AuditLog` records every privileged action.

These three sources together let the on-call reconstruct: "At 14:30 the user logged in from a new device in Lagos (risk 75), was challenged for MFA, completed TOTP; at 14:35 they switched tenant to org_ada (risk 80, was challenged again); at 14:40 they revoked all other sessions" — a complete narrative.

```prisma
model LoginHistory {
  id              String   @id @default(cuid())
  userId          String
  organizationId  String
  // Attempt
  attemptedAt     DateTime @default(now())
  method          String   // password | webauthn | magic_link | otp
  success         Boolean
  failureReason   String?  // AUTH_INVALID_CREDENTIALS | AUTH_ACCOUNT_LOCKED | AUTH_MFA_INVALID_CODE | …
  // Network
  ipHash          String
  ipCountry       String?
  ipRegion        String?
  userAgent       String?
  // Device
  deviceId        String?
  deviceFingerprintHash String?
  // MFA
  mfaChallenged   Boolean  @default(false)
  mfaResult       String?  // SUCCESS | FAILED | SKIPPED
  // Risk
  riskScore       Int      @default(0)
  riskFactors     String   @default("[]")
  // Session created (null on failed attempt)
  sessionId       String?

  @@index([userId, attemptedAt])
  @@index([organizationId, attemptedAt])
}
```

---

## 10. Cross-References

| Topic | Document |
|---|---|
| Refresh sequence diagram, login flow, cookie attributes | `AUTHENTICATION_FLOWS.md` |
| Architecture: session model, request flow | `ARCHITECTURE.md` |
| MFA enrolment + step-up triggers | `MFA.md` |
| OWASP A07 mapping, secrets boundary | `SECURITY_HARDENING.md` |
| Breach runbook (revoke all sessions, force re-auth) | `DISASTER_RECOVERY.md` |
| Sessions REST API (`GET /sessions`, `DELETE /sessions/{id}`) | `API_REFERENCE.md` |
