# Eks-Food IAM — Security Hardening

> **Audience:** Every IAM engineer, security reviewers, the SOC. Read alongside `docs/SECURITY.md` (M1 platform-wide security), `AUTHENTICATION_FLOWS.md` (cookie + CSRF specifics), `SESSION_SECURITY.md` (replay defence), and `DISASTER_RECOVERY.md` (breach runbook).
>
> **Status:** M2 target architecture. The M1 `@eks/security` package ships: AES-256-GCM encryption (`crypto.ts`), HMAC-signed cookies with constant-time verification (`cookies.ts`), HTML/SQL sanitization (`sanitization.ts`), OWASP security headers + CSP (`headers.ts`), and the RBAC permission matrix (`rbac.ts`). M2 layers identity-specific hardening on top.

---

## 1. OWASP Top 10 (2021) — Mapping to IAM Controls

| OWASP Risk | Eks-Food IAM Control | Status |
|---|---|---|
| **A01 — Broken Access Control** | (1) RBAC permission registry (`PERMISSIONS` in `@eks/security/rbac.ts`, regenerated from `@eks/authorization/permissions.ts`). (2) ABAC policy evaluator with explainable denials (`AUTHORIZATION_POLICIES.md`). (3) `TenantScopedRepository` base class injects `organizationId` into every query (`MULTI_TENANCY.md` §3). (4) `OrgStatusGuard` middleware rejects writes to SUSPENDED/TERMINATED tenants. (5) Step-up MFA demanded for privileged actions (`MFA.md` §7.1). (6) M3: PostgreSQL RLS as defence in depth. | M2 (RBAC+ABAC+tenant scope+step-up); M3 (RLS) |
| **A02 — Cryptographic Failures** | (1) Argon2id for password hashing with OWASP-tuned parameters (`AUTHENTICATION_FLOWS.md` §1.1). (2) AES-256-GCM (PBKDF2 150 000 iterations) for TOTP secrets at rest (`@eks/security/crypto.ts`, `MFA.md` §4). (3) HMAC-SHA256 for cookie signing, constant-time verification (`@eks/security/cookies.ts`). (4) SHA-256 for refresh-token hashing (only the hash is stored). (5) TLS 1.3 enforced at the Caddy edge. (6) Quarterly key rotation with dual-key window (`DISASTER_RECOVERY.md` §6.1). (7) `ipHash` always salted (`SHA-256(ip + EKS_IP_HASH_SALT)`) — raw IPs never persisted. | M2 |
| **A03 — Injection** | (1) Prisma parameterises every query — no raw SQL in IAM code paths. (2) Zod validates every inbound payload at the route boundary (`@eks/api/validation.ts`). (3) `containsSqlInjectionPattern` heuristic as defence in depth (`@eks/security/sanitization.ts`). (4) `sanitizeHtml` for any user content rendered in emails. (5) No `eval`, no `Function()`, no `dangerouslySetInnerHTML`. (6) Lint rule `@eks/no-raw-sql` bans template-string SQL. | M2 |
| **A04 — Insecure Design** | (1) Hexagonal layering: aggregates don't depend on infrastructure ports; the domain skeleton (`@eks/domain/contexts/identity`) declares interfaces only. (2) `Result<T,E>` forces explicit error handling; no exceptions cross aggregate boundaries. (3) Outbox pattern prevents dual-write inconsistency between state and events. (4) Threat modelling per IAM flow (each sequence diagram in `AUTHENTICATION_FLOWS.md` was reviewed). (5) Two-approver rule for high-risk admin actions (`mfa.reset`, `auth.impersonate`, `org.transfer_ownership`). | M2 |
| **A05 — Security Misconfiguration** | (1) `EKS_ENVIRONMENT=production` flips strict mode: demo-principal disabled, JWT auth required, `Secure` cookie attribute enforced. (2) `X-Powered-By` stripped by Caddy. (3) Error responses leak no internals — RFC 7807 `problem+json` only (`@eks/errors/problem.ts`). (4) No default credentials; `@eks/config` fail-fast refuses to boot without required secrets. (5) `__Host-` cookie prefix forces Secure + Path=/ + no Domain. (6) Security headers (CSP, HSTS, X-Frame-Options, etc.) set by Caddy + reinforced by Next.js middleware. | M2 |
| **A06 — Vulnerable & Outdated Components** | (1) `bun install --frozen-lockfile` in CI (M1). (2) `bun audit` runs in CI; high-severity CVEs block merge (M1). (3) SBOM generated per release (M2 — `bun sbom` via `@cyclonedx/bun`). (4) Argon2id library (`@node-rs/argon2`) pinned to a specific minor. (5) WebAuthn library (`@simplewebauthn/server`) pinned and monitored for CVEs. (6) Quarterly dependency review by the security lead. | M1 (lockfile+audit); M2 (SBOM) |
| **A07 — Identification & Auth Failures** | (1) Argon2id passwords (`AUTHENTICATION_FLOWS.md` §1.1). (2) Refresh-token rotation with reuse detection (`SESSION_SECURITY.md` §2). (3) Progressive account lockout (`AUTHENTICATION_FLOWS.md` §4.2). (4) Username-enumeration mitigation (timing attack defence, identical error responses). (5) MFA for privileged roles (`MFA.md` §7.2). (6) Adaptive step-up MFA driven by risk score (`MFA.md` §7). (7) Session idle + absolute timeouts (`SESSION_SECURITY.md` §1.1). (8) Concurrent-session limits. (9) Breach runbook with force-global-relogin (`DISASTER_RECOVERY.md` §5). | M2 |
| **A08 — Software & Data Integrity Failures** | (1) Bun lockfile committed and verified in CI (M1). (2) Container images signed with cosign (M2). (3) Outbox events schema-validated on consumption (Zod). (4) WebAuthn attestation + signature verification. (5) Webhook signatures verified (Payswap, M1). (6) Audit-log hash chain for tamper-evidence (`AUDIT_AND_COMPLIANCE.md` §5). (7) CI/CD pipeline runs on immutable, signed GitHub Actions runners. | M1 (lockfile, webhook); M2 (cosign, audit chain) |
| **A09 — Security Logging & Monitoring Failures** | (1) Every state-changing IAM action writes an immutable `AuditLog` row + an outbox event in the same transaction (`AUDIT_AND_COMPLIANCE.md` §1). (2) Structured logs carry `requestId`/`correlationId`/`traceId` from `AsyncLocalStorage` (M1). (3) SIEM ingests via OTel collector (M3 — outbox already publishes every event). (4) SOC dashboards for auth health, authz denials, compliance posture (`AUDIT_AND_COMPLIANCE.md` §8). (5) Audit retention: hot 90 d, cold 7 y. (6) Tamper-evident hash chain with weekly verification. | M2 |
| **A10 — Server-Side Request Forgery** | (1) No outbound HTTP from user-controlled URLs in IAM code paths. (2) The IP-reputation provider's URL is env-configured, never user-configurable. (3) WebAuthn origin verification rejects assertions from unexpected origins. (4) Image uploads (avatars, M3) go through a size+type-validated proxy, not direct fetch. (5) The OIDC discovery endpoint (M3) will be allow-listed, not user-supplied. | M2 |

---

## 2. Password Policy

The password policy is enforced at registration and at password-reset, in `@eks/auth/password-policy.ts`:

| Rule | Value | Configurable via |
|---|---|---|
| Minimum length | 12 characters | `EKS_AUTH_PASSWORD_MIN_LENGTH` |
| Maximum length | 1024 characters | (hardcoded — prevents DoS in Argon2id) |
| Character classes required | At least 3 of: uppercase, lowercase, digit, symbol | `EKS_AUTH_PASSWORD_REQUIRE_CLASSES` (default 3) |
| Common-password block | Yes — checked against a breach list | `EKS_AUTH_BREACH_LIST_PATH` |
| Sequential-char block | Yes — "abcdef", "123456", "qwerty" rejected | (hardcoded) |
| Repeating-char block | Yes — "aaaaaa", "111111" rejected | (hardcoded) |
| Reuse block | New password cannot match the user's previous password | `EKS_AUTH_PASSWORD_HISTORY` (default 5) |
| User-data block | Password cannot contain the user's email local-part, displayName, or org slug | (always on) |

### 2.1 Breach-list check hook
The breach-list check is a pluggable hook:

```ts
export interface PasswordBreachChecker {
  /** Returns the number of times `password` appears in known breaches (0 = safe). */
  check(password: string): Promise<number>;
}
```

M2 ships two implementations:
- `LocalBreachListChecker` — loads a HIBP-style SHA-1 hash list from `EKS_AUTH_BREACH_LIST_PATH` into memory at boot; checks `SHA-1(password)` membership. Suitable for environments without outbound internet.
- `HaveIBeenPwnedChecker` — calls the HIBP range API (`https://api.pwnedpasswords.com/range/{prefix}`) and checks the suffix. Suitable for environments with outbound internet and a privacy-acceptable policy (only the first 5 chars of the SHA-1 hash are sent).

A password with `breachCount > 0` is rejected with `code=VALIDATION_FAILED`, `details.fields=[{ path: "password", message: "This password has appeared in a known data breach." }]`.

### 2.2 Password history
The `Identity(type=password)` row retains `previous` credential records (see `CredentialAggregate.previous` in the domain skeleton). When a user changes their password, the new password is checked against the last `EKS_AUTH_PASSWORD_HISTORY` (default 5) hashes. A match is rejected with `code=BUSINESS_RULE`, `details.rule=password_reused`.

### 2.3 Password rotation (no forced periodic rotation)
Eks-Food does **not** force periodic password rotation (the NIST 800-63B recommendation against forced rotation is followed). Users are encouraged to rotate only on suspected compromise. Forced rotation drives users to weaker, predictable passwords ("winter2024", "winter2025", …).

---

## 3. Credential Rotation

| Credential | Default rotation cadence | Rotation procedure |
|---|---|---|
| User password | On demand (user-initiated) | `AUTHENTICATION_FLOWS.md` §11 |
| TOTP secret | On demand (user re-enrols) | Disable + re-enrol via `MFA.md` §4 |
| WebAuthn credential | On demand (user re-registers a passkey) | `AUTHENTICATION_FLOWS.md` §8.1 |
| Recovery codes | Annually (worker nudge) or on demand | `MFA.md` §3.4 |
| `EKS_AUTH_COOKIE_SECRET` | Quarterly + on breach | `DISASTER_RECOVERY.md` §6.1 (dual-key window) |
| `EKS_AUTH_MFA_ENCRYPTION_KEY` | Annually + on breach | `DISASTER_RECOVERY.md` §6.2 (lazy re-encryption) |
| `EKS_IP_HASH_SALT` | Annually + on breach | Deploy new salt; existing `ipHash` values become uncorrelatable (acceptable) |
| `EKS_DB_PASSWORD` | Quarterly + on breach | DBA rotates via AWS Secrets Manager; rolling restart of API pods |
| Provider API keys (Twilio, SMTP) | Quarterly + on breach | Provider-specific rotation; update `@eks/config` |
| `EKS_AUTH_WEBAUTHN_RP_ID` | Only on domain rename | `DISASTER_RECOVERY.md` §6.3 (invalidates all passkeys — planned, never emergency) |

Every rotation is audited as `SECRET_ROTATED` with the secret's name (never the value). The on-call verifies the rotation by performing a test login + cookie validation post-deploy.

---

## 4. Account Lockout Thresholds

See `AUTHENTICATION_FLOWS.md` §4.2 for the full progressive-lockout table. Summary:

| Consecutive failures | Lockout duration |
|---|---|
| 1–4 | (none, counter increments) |
| 5 | 15 min |
| 6 | 30 min |
| 7 | 1 hour |
| 8 | 4 hours |
| 9 | 24 hours |
| 10+ | until admin unlock |

The lockout is on the `Identity` (per-credential), not the `User`. A user with a locked password Identity can still authenticate with a passkey.

Lockout thresholds are per-tenant-overridable via `TenantConfiguration.sessionPolicy.lockoutThreshold` and `lockoutDurationMs`.

---

## 5. Rate Limiting per Endpoint

The M1 `@eks/api/rate-limit` (sliding window, cache-backed) wraps every identity endpoint. Per-endpoint limits:

| Endpoint | Limit | Window | Key |
|---|---:|---:|---|
| `POST /api/v1/auth/login` | 20 | 1 min | IP + path |
| `POST /api/v1/auth/register` | 5 | 1 min | IP |
| `POST /api/v1/auth/magic-link` | 5 | 1 min | email |
| `POST /api/v1/auth/magic-link/verify` | 10 | 1 min | IP |
| `POST /api/v1/auth/refresh` | 60 | 1 min | IP |
| `POST /api/v1/auth/reset-password/request` | 3 | 1 hour | email |
| `POST /api/v1/auth/reset-password/confirm` | 5 | 1 hour | IP |
| `POST /api/v1/auth/webauthn/login` | 10 | 1 min | IP |
| `POST /api/v1/mfa/verify` | 10 | 1 min | session |
| `POST /api/v1/mfa/send-otp` | 5 | 1 hour | user |
| `POST /api/v1/mfa/enroll-totp` | 3 | 1 hour | user |
| `POST /api/v1/invitations` | 20 | 1 min | user |
| `POST /api/v1/invitations/bulk` | 5 | 1 hour | user |
| `POST /api/v1/audit/export` | 3 | 1 hour | user |
| `GET /api/v1/audit` | 60 | 1 min | user |
| All other authenticated endpoints | 120 | 1 min | user |

Exceeding the limit returns `429` with `Retry-After` (seconds) and `code=RATE_LIMITED`. The sliding-window counter is stored in `@eks/cache` (Redis-ready).

The rate limiter is **separate** from the account-lockout mechanism (§4). A user can hit the rate limit without being locked out (429 ≠ 423), and can be locked out without hitting the rate limit (a single failed login attempt every 5 min won't trip the limiter but will accumulate the lockout counter).

---

## 6. IP Reputation Hook Interface

The `IpReputationProvider` interface (in `@eks/security/ip-reputation.ts`) decouples the risk-scoring engine from the provider:

```ts
export interface IpReputationProvider {
  /** Returns the reputation verdict for an IP. Cached 5 min per IP. */
  lookup(ip: string): Promise<IpReputationVerdict>;
}

export interface IpReputationVerdict {
  bad: boolean;          // known-bad IP (spam, malware C2, etc.)
  tor: boolean;          // TOR exit node
  vpn: boolean;          // known VPN
  proxy: boolean;        // known proxy
  datacenter: boolean;   // AWS/GCP/Azure IP range
  country: string;       // ISO 3166-1 alpha-2
  region: string;        // ISO 3166-2
  city: string;          // city name
  lat?: number;
  lng?: number;
}
```

M2 ships `MockIpReputationProvider` (returns benign verdicts for everything; suitable for tests and dev). M3 will wire:
- `IPQualityScoreProvider` — paid service, high accuracy.
- `MaxMindGeoIP2Provider` — MaxMind's GeoIP2 + GeoIP2-Proxy databases.

The provider is selected via `EKS_AUTH_IP_REPUTATION_PROVIDER` env var. Application code (the `RiskScoringService`) is unchanged across providers — the interface contract is the same.

The provider is **always** called through a 5-minute cache (per IP). On cache miss, the call is async with a 2-second timeout; on timeout, the verdict is treated as benign (fail-open, since blocking legitimate users is worse than letting a borderline case through).

---

## 7. Device Fingerprinting Abstraction

See `SESSION_SECURITY.md` §3 for the full design. Summary of the abstraction:

```ts
export interface DeviceFingerprinter {
  /** Compute a stable, privacy-respecting fingerprint from request context. */
  fingerprint(req: Request): DeviceFingerprint;
}

export interface DeviceFingerprint {
  hash: string;          // SHA-256 of the composite (the identifier)
  context: {
    userAgent: string;
    platform: string;
    browser: string;
    acceptLanguage: string;
    timezone: string;
    screenColorDepth: number;
    hardwareConcurrencyBucket: number;
    deviceMemoryBucket: number;
  };
}
```

The fingerprint is **not** a canvas/WebGL fingerprint (which is fragile and privacy-invasive). It is a coarse, stable composite that:
- Identifies a device + browser combination reliably across sessions (via the `__Host-eks.device` long-lived cookie).
- Drifts detectably when an attacker spoofs a different UA / TZ (driving the `ua_drift` and `tz_drift` risk factors).
- Cannot uniquely identify a user across different browsers (privacy-preserving).

The implementation lives in `@eks/security/device-fingerprint.ts` and is the single point of change if we later add server-side TLS fingerprinting (JA3) as a secondary signal.

---

## 8. Secure Defaults

Every IAM component ships with secure defaults. Override requires an explicit env var or per-tenant config; no override is silent.

| Default | Value | Override |
|---|---|---|
| Auth mode | `jwt` (production) / `header_demo` (dev only — `@eks/config` rejects in prod) | `EKS_AUTH_MODE` |
| Cookie `HttpOnly` | `true` | (cannot be disabled) |
| Cookie `Secure` | `true` in staging/prod | (auto-detected from `EKS_ENVIRONMENT`) |
| Cookie `SameSite` | `Lax` (session), `Strict` (CSRF) | (cannot be relaxed) |
| Cookie `Domain` | (none — `__Host-` prefix) | (cannot be set) |
| CORS | `same-origin` (no wildcard) | `EKS_CORS_ALLOWED_ORIGINS` (explicit list) |
| CSP | strict (see `docs/SECURITY.md` §3.1) | (cannot be relaxed without security review) |
| Rate limit | on for every endpoint | (cannot be disabled; limits can be tuned) |
| Audit logging | on for every state change | (cannot be disabled) |
| MFA for privileged roles | required | `EKS_AUTH_MFA_REQUIRED_ROLES` |
| Risk score thresholds | 70 step-up, 90 revoke | `EKS_AUTH_RISK_STEPUP_THRESHOLD`, `EKS_AUTH_RISK_REVOKE_THRESHOLD` |
| Password min length | 12 | `EKS_AUTH_PASSWORD_MIN_LENGTH` |
| Session idle timeout | 24 h | `EKS_AUTH_IDLE_TIMEOUT_MS` |
| Refresh-token TTL | 30 d | `EKS_AUTH_REFRESH_TOKEN_TTL_MS` |
| Concurrent-session limit | 5 | `EKS_AUTH_MAX_CONCURRENT_SESSIONS` |
| `denied by default` for authorization | always on | (cannot be disabled — the deny-by-default principle is non-negotiable) |
| Least-privilege role grants | new roles start with the minimum permission set | (cannot be disabled) |

---

## 9. Secrets Management Boundary

### 9.1 What is a secret
Any value whose disclosure would compromise security:
- `EKS_AUTH_COOKIE_SECRET` (cookie signing)
- `EKS_AUTH_MFA_ENCRYPTION_KEY` (TOTP secret encryption)
- `EKS_IP_HASH_SALT` (IP hash salting)
- `EKS_DB_PASSWORD`
- Provider API keys (Twilio, SMTP, IPQualityScore, Payswap)
- WebAuthn RP ID seed (if different from public RP ID)

### 9.2 Where secrets live
- **Local dev:** `.env.local` (gitignored, validated by `@eks/config`).
- **Staging/prod:** AWS Secrets Manager (rotated automatically where supported; manually rotated otherwise).
- **CI:** GitHub Actions secrets, masked in logs.

### 9.3 What we never do
- **Never log a secret.** The `@eks/observability/logger` redacts any field name matching `password|secret|token|key|salt|recoveryCode` (case-insensitive) before serialisation.
- **Never return a secret in an API response.** No endpoint returns `Identity.credentialData`, `MFAConfiguration.totpSecret`, `RecoveryCode.codeHash`, or any env var value.
- **Never commit a secret to git.** The CI secret-scan job (`gitleaks`) blocks the PR. The pre-commit hook (`secretlint`) blocks the commit.
- **Never include a secret in an error message.** `problem+json` responses are scrubbed by `toProblemJson()` (`@eks/errors/problem.ts`).
- **Never send a secret over an unencrypted channel.** TLS 1.3 everywhere; no HTTP endpoints (Caddy redirects to HTTPS).
- **Never hard-code a secret.** The lint rule `@eks/no-hardcoded-secrets` bans string literals matching common secret patterns.

### 9.4 Validation by `@eks/config`
Every secret is Zod-validated at boot:
- `EKS_AUTH_COOKIE_SECRET`: string, min 32 chars, not equal to any well-known value (e.g. "secret", "password", "changeme").
- `EKS_AUTH_MFA_ENCRYPTION_KEY`: string, min 32 chars.
- `EKS_IP_HASH_SALT`: string, min 16 chars.
- `EKS_DB_PASSWORD`: string, min 16 chars.

`@eks/config`'s fail-fast loader refuses to boot the process if any secret is missing or malformed. The error message names the env var but never the value. This is the "fail-fast loader" shipped in M1 (`src/packages/config/loader.ts`).

### 9.5 Quarterly rotation
The security lead schedules quarterly secret rotations. Each rotation follows the procedure in `DISASTER_RECOVERY.md` §6. The rotation is audited and verified by a test login + cookie validation.

---

## 10. WebAuthn Security Particulars

WebAuthn (passkey) enrolment and authentication have specific security considerations beyond the general authentication flows:

### 10.1 Attestation
M2 accepts attestation formats: `none` (most consumer passkeys — Apple, Google), `packed` (YubiKey and similar), `tpm` (Windows Hello). The `none` format is acceptable because:
- The authenticator model is conveyed via `aaguid` regardless of attestation.
- Requiring attestation would exclude consumer passkeys (the vast majority).
- The phishing-resistance value of WebAuthn does not depend on attestation.

Attestation *verification* (proving the authenticator is a genuine hardware device) is M3 — gated by a feature flag for high-security tenants.

### 10.2 Sign-count checking
The `signCount` returned in each assertion is compared to the stored value:
- If `new > stored` → update stored, accept (normal case).
- If `new == stored == 0` → accept (some authenticators always return 0).
- If `new == stored > 0` → suspect a cloned authenticator; deny (`AUTH_DEVICE_UNTRUSTED`); stage `identity.webauthn.clone_suspected.v1`; audit `MFA_WEBAUTHN_CLONE_SUSPECTED`.
- If `new < stored` → impossible without authenticator rollback; deny.

### 10.3 Origin verification
The `clientDataJSON.origin` is checked against `EKS_AUTH_WEBAUTHN_ORIGIN` (default `https://eks.food`). An assertion from any other origin is rejected. This is the **primary phishing defence** — a phishing site at `https://eks-food-login.com` cannot produce a valid assertion because the authenticator refuses to sign for an origin it was not enrolled for.

### 10.4 RP ID
The RP ID (`EKS_AUTH_WEBAUTHN_RP_ID`, default `eks.food`) is the domain scope of the credential. It must be a registrable suffix of the request origin. Changing it invalidates all passkeys (`DISASTER_RECOVERY.md` §6.3).

### 10.5 User verification
`authenticatorSelection.userVerification: "preferred"` requests biometric/PIN verification where available. If the authenticator cannot perform user verification, the assertion still succeeds (with `userVerified=false` in the authenticator data) but the risk score is bumped by 10 (the session is slightly less trustworthy than a verified one).

---

## 11. CSRF Defence In Depth

The primary CSRF defence is the double-submit cookie (`AUTHENTICATION_FLOWS.md` §3). Defence in depth:

1. **Double-submit cookie** — `__Host-eks.csrf` (SameSite=Strict) echoed in `X-CSRF-Token` header.
2. **`SameSite=Lax`** on the session cookie — blocks cross-site POST inclusion.
3. **`Origin` header check** — `@eks/auth/middleware` rejects any state-changing request whose `Origin` header is not in `EKS_CORS_ALLOWED_ORIGINS`.
4. **`__Host-` cookie prefix** — prevents subdomain cookie injection.
5. **Custom header requirement** — state-changing endpoints require the `X-CSRF-Token` header, which cannot be set by a cross-site form submission (only by JS with CORS access).

A CSRF attack must bypass all five layers to succeed. The defence in depth makes CSRF a non-issue for Eks-Food IAM.

---

## 12. Security Review Checklist

Before any IAM PR is merged:

- [ ] No `organizationId`-less query (verified by lint + test).
- [ ] No credential material in logs (verified by lint).
- [ ] No `Identity` row deleted (soft-revoked only, except GDPR erasure).
- [ ] Every state-changing handler writes `AuditLog` + stages outbox event in the same transaction.
- [ ] Every authorization decision (allow or deny) is logged.
- [ ] New cookies use `__Host-` prefix + `HttpOnly` + `Secure` + `SameSite`.
- [ ] New endpoints have a rate limit.
- [ ] New endpoints require an explicit permission (`authorize(principal, perm)`).
- [ ] Zod schema validates every inbound payload.
- [ ] No raw SQL (`@eks/no-raw-sql` lint).
- [ ] No `eval`, `Function()`, `dangerouslySetInnerHTML`.
- [ ] No secrets in code or logs (`@eks/no-hardcoded-secrets` lint).
- [ ] Argon2id used for any new password-like credential.
- [ ] Refresh tokens are opaque, single-use, with reuse detection.
- [ ] New roles start with minimum permissions.
- [ ] Tests cover the happy path + denial path + cross-tenant path.
- [ ] If the PR adds a new Prisma model, it carries `organizationId` (unless explicitly global).
- [ ] Documentation updated (this folder + `API_REFERENCE.md`).

---

## 13. Cross-References

| Topic | Document |
|---|---|
| M1 platform-wide security posture (headers, CORS, CSP, secrets) | `docs/SECURITY.md` |
| Cookie attributes, CSRF, brute-force protection | `AUTHENTICATION_FLOWS.md` §2–§4 |
| Session risk scoring, replay-attack mitigation | `SESSION_SECURITY.md` §4, §7 |
| MFA enrolment security, adaptive step-up | `MFA.md` |
| Breach runbook (force global re-login, key rotation) | `DISASTER_RECOVERY.md` §5, §6 |
| Audit log tamper-evidence (chain verification) | `AUDIT_AND_COMPLIANCE.md` §5 |
