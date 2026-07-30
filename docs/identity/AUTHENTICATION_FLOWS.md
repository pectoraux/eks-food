# Eks-Food IAM — Authentication Flows

> **Audience:** Identity engineers, security reviewers, frontend engineers wiring up login flows. Read alongside `ARCHITECTURE.md` (§4 Session Model, §7 Request Flow), `SESSION_SECURITY.md` (refresh-token rotation + risk scoring), and `MFA.md`.
>
> **Status:** M2 target architecture. Sequence diagrams use ASCII art; numbered arrows map to the implementation steps in `@eks/auth`. Every flow ends with the same three side-effects: an `AuditLog` row, a domain event staged to the `EventOutbox`, and (where relevant) a notification queued via `@eks/notifications`.

---

## 1. Credential Storage

### 1.1 Password — Argon2id
Passwords are hashed with **Argon2id** (the OWASP-recommended variant — side-channels + GPU resistance). Parameters are configurable via `@eks/config` and stored alongside the hash so legacy hashes can be migrated lazily:

| Parameter | Env var | Default | Notes |
|---|---|---|---|
| Memory | `EKS_AUTH_ARGON2_MEMORY_KIB` | 65 536 (64 MiB) | Tuned for a typical API pod. |
| Iterations (time cost) | `EKS_AUTH_ARGON2_ITERATIONS` | 3 | OWASP minimum. |
| Parallelism (lanes) | `EKS_AUTH_ARGON2_PARALLELISM` | 4 | Match pod CPU quota. |
| Hash length | (hardcoded) | 32 bytes | 256-bit output. |
| Salt length | (hardcoded) | 16 bytes | Per-credential random salt. |

The stored `credentialData` JSON blob:

```json
{
  "algorithm": "argon2id",
  "hash": "$argon2id$v=19$m=65536,t=3,p=4$<base64-salt>$<base64-hash>",
  "params": { "m": 65536, "t": 3, "p": 4, "len": 32 },
  "rotatedAt": "2025-01-15T10:23:00Z"
}
```

The hash string is the PHC-format ($-delimited) representation so it is portable across argon2 implementations and across the Postgres / SQLite switch in M3. The `Identity` row of `type:"password"` carries this blob in `credentialData`.

### 1.2 WebAuthn (passkey)
The `Identity` row of `type:"webauthn"` stores:

```json
{
  "credentialId": "<base64url>",
  "publicKey": "<COSE_Key, base64url>",
  "signCount": 7,
  "transports": ["usb", "nfc", "internal"],
  "aaguid": "<authenticator model GUID>",
  "enrolledAt": "2025-01-15T10:23:00Z",
  "name": "Amara's iPhone"
}
```

The private key never leaves the authenticator. The server stores only the public key, the credential ID, and the last-seen signature counter (a clone-detection signal — if a new signature has a counter lower than or equal to the stored value, the authenticator may have been cloned; the session is denied and `identity.webauthn.clone_suspected.v1` is staged).

### 1.3 Magic-link and OTP
Magic-link and OTP credentials are **not stored in `Identity`**. They are one-time, short-TTL tokens kept in the `@eks/cache` registry:
- Magic-link: 32-byte URL-safe random token, key `magic:{tokenHash}`, value `{ userId, orgId, expiresAt }`, TTL 10 min, single-use.
- Email/SMS OTP: 6-digit code, key `otp:{channel}:{userIdHash}`, value `{ codeHash, attempts, expiresAt }`, TTL 5 min, max 3 verification attempts.

The token is hashed (SHA-256) before storage; the plaintext exists only in the URL we send to the user or the code we display in the email/SMS body.

### 1.4 TOTP (MFA factor)
The `MFAConfiguration` row stores the TOTP secret encrypted at rest using `@eks/security/crypto` (AES-256-GCM, key derived from `EKS_AUTH_MFA_ENCRYPTION_KEY` via PBKDF2 150 000 iterations — same primitive as `src/packages/security/crypto.ts`). The plaintext secret is shown to the user **once** at enrolment as a QR code; subsequent logins verify the 6-digit code against the encrypted secret.

### 1.5 Recovery codes
Generated as 10 codes of the form `XXXX-XXXX-XXXX-XXXX` (16 base32 chars, hyphenated for readability), each hashed with SHA-256 and stored in the `RecoveryCode` table with `usedAt: null`. A recovery code is single-use; consuming one zeroes `usedAt` and rotates a fresh code so the user always has 10 unused codes (until they explicitly regenerate). See `MFA.md` §3.

---

## 2. Cookie Attributes

Every authentication cookie is set by `cookieHeader()` in `src/packages/security/cookies.ts` with these defaults:

| Attribute | Value | Why |
|---|---|---|
| Name | `__Host-eks.session` | `__Host-` prefix forces `Secure`, `Path=/`, no `Domain`. Browsers reject the cookie if any of those are violated. |
| `HttpOnly` | always `true` | JavaScript cannot read the cookie; XSS cannot exfiltrate it. |
| `Secure` | always `true` in staging/prod | Browser only sends the cookie over HTTPS. `@eks/config` enforces `EKS_ENVIRONMENT=production` ⇒ `Secure=true`. |
| `SameSite` | `Lax` (session), `Strict` (CSRF token) | `Lax` allows the cookie on top-level navigations from external sites (so a magic-link click works). `Strict` on the CSRF token prevents cross-site inclusion. |
| `Path` | `/` | `__Host-` requires `/`. |
| `Domain` | (omitted) | `__Host-` forbids `Domain=`. The cookie is host-only — never sent to subdomains. |
| `Max-Age` | access-token TTL (15 min) / refresh-token TTL (30 d) | Browsers discard the cookie when `Max-Age` elapses. |

The cookie value is signed with HMAC-SHA256 (`signCookie` in `src/packages/security/cookies.ts`); verification uses constant-time comparison (`verifyCookie`). The signing key is `EKS_AUTH_COOKIE_SECRET` (≥32 chars, rotated quarterly — see `DISASTER_RECOVERY.md` §4).

Two cookies are issued at login:
- `__Host-eks.session` — the opaque access token (15 min TTL).
- `__Host-eks.refresh` — the opaque refresh token (30 d TTL, `SameSite=Lax`, `Path=/api/v1/auth/refresh` only — scoping reduces exposure).

A third cookie, `__Host-eks.csrf`, holds the double-submit token (see §3).

---

## 3. CSRF Protection — Double-Submit Token

CSRF is mitigated with the **double-submit cookie** pattern: a random 256-bit token is generated per session, set as an `HttpOnly=False`, `SameSite=Strict` cookie (`__Host-eks.csrf`), and the client is required to echo it back in the `X-CSRF-Token` header on every state-changing request.

```
On login:
  csrfToken = randomBytes(32)
  setCookie __Host-eks.csrf = csrfToken (SameSite=Strict, HttpOnly=false, Secure, 15min TTL)

On POST/PUT/PATCH/DELETE:
  header X-CSRF-Token must equal cookie __Host-eks.csrf
  if not → 403 (code=AUTHZ_ABAC_DENIED, details.rule="csrf_token_mismatch")
```

Because the token is bound to the session (it rotates with each refresh), an attacker site cannot guess it. Because it must be sent in a header (not a cookie), a cross-site form submission cannot forge it. Because the cookie is `SameSite=Strict`, even cross-site top-level navigations cannot include it.

`@eks/auth/middleware` enforces the check on every method other than `GET`/`HEAD`/`OPTIONS`. Exemptions: webhook endpoints (`/api/v1/webhooks/*`) which authenticate via HMAC signature, not cookie.

---

## 4. Brute-Force Protection — Progressive Lockout + Rate Limit

Two layers:

### 4.1 Per-endpoint rate limit (M1, `@eks/api/rate-limit`)
The login endpoint is wrapped in `rateLimit(req, { limit, windowMs })`:

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/v1/auth/login` | 20 | 1 min per IP+path |
| `POST /api/v1/auth/register` | 5 | 1 min per IP |
| `POST /api/v1/auth/magic-link` | 5 | 1 min per email |
| `POST /api/v1/auth/refresh` | 60 | 1 min per IP |
| `POST /api/v1/auth/reset-password` | 3 | 1 hour per email |
| `POST /api/v1/mfa/verify` | 10 | 1 min per session |
| All other authenticated endpoints | 120 | 1 min per user |

Exceeding the limit returns `429` with `Retry-After` (seconds) and `code=RATE_LIMITED`. The sliding-window counter is stored in the `@eks/cache` registry (Redis-ready).

### 4.2 Progressive account lockout (M2, `@eks/auth/lockout`)
After each failed password verification, the `Identity` row of `type:"password"` records `failedAttempts` and `lockedUntil`:

| Consecutive failures | Lockout duration | Notes |
|---|---|---|
| 1–4 | (none) | Counter increments. |
| 5 | 15 min | First lockout. |
| 6 (after release) | 30 min | Doubles. |
| 7 | 1 hour | |
| 8 | 4 hours | |
| 9 | 24 hours | |
| 10+ | until admin unlock | `Identity.status=REVOKED`; user must contact support. |

The lockout is on the `Identity` (per-credential), not the `User`. A user with a locked password Identity can still authenticate with their passkey. Each lockout transition stages `identity.identity.locked.v1` and sends an email alert ("Your account was temporarily locked after multiple failed sign-in attempts") via `@eks/notifications`.

### 4.3 Username enumeration mitigation
To prevent timing-based username enumeration:
- The Argon2id hash of a random constant is computed **even when the username does not exist** (so the response time is identical to a real failed login).
- The "user not found" path stores a 5 s negative cache entry so repeat probes for the same bogus username return instantly (rate-limiting the search without revealing anything).
- The error response is identical for "wrong password" and "unknown user": `{ "code": "AUTH_INVALID_CREDENTIALS" }`.

---

## 5. Flow: Email / Password Registration

```
Browser                Edge/Next              @eks/auth               Prisma            Outbox            Notifications
   │                       │                      │                       │                 │                    │
   │  POST /api/v1/auth/register                                                                                      │
   │  { email, password, displayName, inviteToken? }                                                                  │
   ├──────────────────────▶│                      │                       │                 │                    │
   │                       │  apiHandler()        │                       │                 │                    │
   │                       │  newRequestContext   │                       │                 │                    │
   │                       ├─────────────────────▶│                       │                 │                    │
   │                       │                      │ ① Zod validate body    │                 │                    │
   │                       │                      │ ② Check password policy│                 │                    │
   │                       │                      │    (≥12 chars, breach  │                 │                    │
   │                       │                      │    list, complexity)   │                 │                    │
   │                       │                      │ ③ If inviteToken:      │                 │                    │
   │                       │                      │    resolve Invitation  │                 │                    │
   │                       │                      │    (else default org)  │                 │                    │
   │                       │                      │ ④ rateLimit check      │                 │                    │
   │                       │                      │ ⑤ Check email unique   │                 │                    │
   │                       │                      ├──────────────────────▶│                 │                    │
   │                       │                      │                       │  User.exists?   │                    │
   │                       │                      │◀──────────────────────┤                 │                    │
   │                       │                      │ ⑥ Argon2id.hash(pw)    │                 │                    │
   │                       │                      │ ⑦ BEGIN TX             │                 │                    │
   │                       │                      │    INSERT User         │                 │                    │
   │                       │                      │      status=PENDING_  │                 │                    │
   │                       │                      │      ACTIVATION        │                 │                    │
   │                       │                      │    INSERT Identity     │                 │                    │
   │                       │                      │      type=password     │                 │                    │
   │                       │                      │      credentialData    │                 │                    │
   │                       │                      │      verifiedAt=null   │                 │                    │
   │                       │                      │    INSERT UserPref     │                 │                    │
   │                       │                      │      (defaults)        │                 │                    │
   │                       │                      │    INSERT Membership   │                 │                    │
   │                       │                      │      (if invite)       │                 │                    │
   │                       │                      │    stage outbox event  │                 │                    │
   │                       │                      │      identity.user.    │                 │                    │
   │                       │                      │      registered.v1     │                 │                    │
   │                       │                      │    audit.record(      │                 │                    │
   │                       │                      │      AUTH_REGISTER)    │                 │                    │
   │                       │                      │    COMMIT TX           │                 │                    │
   │                       │                      ├──────────────────────▶│                 │                    │
   │                       │                      │                       │  INSERT User    │                    │
   │                       │                      │                       │  INSERT Identity│                    │
   │                       │                      │                       │  INSERT AuditLog│                    │
   │                       │                      │                       │  INSERT Outbox  │                    │
   │                       │                      │◀──────────────────────┤                 │                    │
   │                       │                      │ ⑧ Generate email-     │                 │                    │
   │                       │                      │    verification token │                 │                    │
   │                       │                      │    (cache, 24h TTL)   │                 │                    │
   │                       │                      │ ⑨ Send verification   │                 │                    │
   │                       │                      │    email (async)      │                 │                    │
   │                       │                      ├───────────────────────────────────────────▶│                    │
   │                       │                      │                       │                 │  publish to bus    │
   │                       │                      │                       │                 │  subscriber:       │
   │                       │                      │                       │                 │  notifications     │
   │                       │                      │                       │                 ├───────────────────▶│
   │                       │                      │                       │                 │                    │ send email
   │                       │                      │ ⑩ Return 201          │                 │                    │
   │                       │                      │    { userId, status:  │                 │                    │
   │                       │                      │      PENDING_ACTIVATION}                │                    │
   │                       │◀─────────────────────┤                       │                 │                    │
   │  201 Created          │                       │                       │                 │                    │
   │  { data: { userId,    │                       │                       │                 │                    │
   │    status: "PENDING_  │                       │                       │                 │                    │
   │    ACTIVATION" } }    │                       │                       │                 │                    │
   │◀──────────────────────┤                       │                       │                 │                    │
```

**Key invariants:**
- Steps ⑦ happen in one Prisma transaction; the audit row and outbox row are committed atomically with the User/Identity/Membership rows. If the COMMIT fails, no audit row exists.
- The verification email is sent **after** the commit (failure to send does not roll back registration). If the send fails, the user can request a fresh verification link via `POST /api/v1/auth/resend-verification`.
- The user is `PENDING_ACTIVATION` until they click the verification link; they cannot log in (returns `code=AUTH_ACCOUNT_NOT_ACTIVATED`).

---

## 6. Flow: Login with MFA

```
Browser                @eks/auth               Prisma            Cache             Audit/Outbox
   │                       │                       │                 │                    │
   │  POST /api/v1/auth/login                                                                            │
   │  { email, password }                                                                                │
   ├──────────────────────▶│                       │                 │                    │
   │                       │ ① rateLimit (20/min)  │                 │                    │
   │                       │ ② Lookup User by email│                 │                    │
   │                       ├──────────────────────▶│                 │                    │
   │                       │                       │  User + Identity │                    │
   │                       │                       │  + MFAConfig     │                    │
   │                       │◀──────────────────────┤                 │                    │
   │                       │ ③ If User missing:    │                 │                    │
   │                       │    Argon2id.verify(   │                 │                    │
   │                       │    random constant)   │                 │                    │
   │                       │    (mitigate timing)  │                 │                    │
   │                       │    return 401         │                 │                    │
   │                       │    AUTH_INVALID_      │                 │                    │
   │                       │    CREDENTIALS        │                 │                    │
   │                       │ ④ Argon2id.verify(    │                 │                    │
   │                       │    password, hash)    │                 │                    │
   │                       │ ⑤ If mismatch:        │                 │                    │
   │                       │    Identity.failed++  │                 │                    │
   │                       │    if ≥5 → lockout    │                 │                    │
   │                       │    audit(AUTH_LOGIN_  │                 │                    │
   │                       │    FAILED)            │                 │                    │
   │                       │    return 401         │                 │                    │
   │                       │ ⑥ If Identity.locked: │                 │                    │
   │                       │    return 423         │                 │                    │
   │                       │    AUTH_ACCOUNT_LOCKED│                 │                    │
   │                       │ ⑦ Reset failed=0      │                 │                    │
   │                       │ ⑧ Compute risk score: │                 │                    │
   │                       │    IP reputation,     │                 │                    │
   │                       │    new device,        │                 │                    │
   │                       │    geo-velocity       │                 │                    │
   │                       │ ⑨ If MFA enrolled:    │                 │                    │
   │                       │    BEGIN TX           │                 │                    │
   │                       │      stage pending_   │                 │                    │
   │                       │      login:{userId}   │                 │                    │
   │                       │      (cache, 5 min)   │                 │                    │
   │                       │    COMMIT             │                 │                    │
   │                       │    return 401         │                 │                    │
   │                       │    AUTH_MFA_REQUIRED  │                 │                    │
   │                       │    { mfaChallengeId } │                 │                    │
   │                       │ ⑩ If risk ≥ 90:       │                 │                    │
   │                       │    return 401         │                 │                    │
   │                       │    AUTH_DEVICE_       │                 │                    │
   │                       │    UNTRUSTED          │                 │                    │
   │                       │ ⑪ If risk ≥ 70 (and   │                 │                    │
   │                       │    MFA not enrolled): │                 │                    │
   │                       │    return 401         │                 │                    │
   │                       │    AUTH_DEVICE_       │                 │                    │
   │                       │    UNTRUSTED          │                 │                    │
   │                       │    (step-up demands   │                 │                    │
   │                       │    enrolment)         │                 │                    │
   │                       │ ⑫ Else proceed to     │                 │                    │
   │                       │    session creation   │                 │                    │
   │  401 AUTH_MFA_REQUIRED│                       │                 │                    │
   │  { mfaChallengeId }   │                       │                 │                    │
   │◀──────────────────────┤                       │                 │                    │
   │                       │                       │                 │                    │
   │  POST /api/v1/mfa/verify                                                                              │
   │  { mfaChallengeId, code }                                                                            │
   ├──────────────────────▶│                       │                 │                    │
   │                       │ ① Lookup challenge in │                 │                    │
   │                       │    cache              │                 │                    │
   │                       ├──────────────────────────────────────────▶│                    │
   │                       │◀──────────────────────────────────────────┤                    │
   │                       │ ② Verify TOTP code    │                 │                    │
   │                       │    against encrypted  │                 │                    │
   │                       │    secret (decrypt,   │                 │                    │
   │                       │    TOTP verify, ±1   │                 │                    │
   │                       │    window)            │                 │                    │
   │                       │ ③ If invalid:         │                 │                    │
   │                       │    challenge.attempts++│                 │                    │
   │                       │    if ≥3 → delete     │                 │                    │
   │                       │      challenge,       │                 │                    │
   │                       │      audit(AUTH_MFA_  │                 │                    │
   │                       │      FAILED)          │                 │                    │
   │                       │    return 401         │                 │                    │
   │                       │    AUTH_MFA_INVALID_  │                 │                    │
   │                       │    CODE               │                 │                    │
   │                       │ ④ Delete challenge    │                 │                    │
   │                       │    (single-use)       │                 │                    │
   │                       │ ⑤ Proceed to session  │                 │                    │
   │                       │    creation (below)   │                 │                    │
   │                       │                       │                 │                    │
   │  [Session creation — shared by all login methods]                                                    │
   │                       │ ⑥ Device fingerprint  │                 │                    │
   │                       │    computation (UA,   │                 │                    │
   │                       │    Accept-Language,   │                 │                    │
   │                       │    TZ, screen,        │                 │                    │
   │                       │    deviceId cookie)   │                 │                    │
   │                       │ ⑦ Resolve Device or   │                 │                    │
   │                       │    INSERT new Device  │                 │                    │
   │                       │ ⑧ BEGIN TX            │                 │                    │
   │                       │    INSERT Session     │                 │                    │
   │                       │      status=ACTIVE    │                 │                    │
   │                       │      method=password  │                 │                    │
   │                       │      riskScore=…      │                 │                    │
   │                       │      refreshFamilyId  │                 │                    │
   │                       │      refreshTokenHash │                 │                    │
   │                       │    INSERT LoginHistory│                 │                    │
   │                       │    stage outbox:      │                 │                    │
   │                       │      identity.session.│                 │                    │
   │                       │      started.v1       │                 │                    │
   │                       │    audit(AUTH_LOGIN)  │                 │                    │
   │                       │ ⑨ COMMIT              │                 │                    │
   │                       │ ⑩ Issue cookies:      │                 │                    │
   │                       │    __Host-eks.session │                 │                    │
   │                       │      (signed, 15min)  │                 │                    │
   │                       │    __Host-eks.refresh │                 │                    │
   │                       │      (signed, 30d,    │                 │                    │
   │                       │       Path=/api/v1/   │                 │                    │
   │                       │       auth/refresh)   │                 │                    │
   │                       │    __Host-eks.csrf    │                 │                    │
   │                       │      (Strict, 15min)  │                 │                    │
   │  200 OK               │                       │                 │                    │
   │  Set-Cookie: __Host-eks.session=…; HttpOnly; Secure; SameSite=Lax; Path=/                          │
   │  Set-Cookie: __Host-eks.refresh=…; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/refresh      │
   │  Set-Cookie: __Host-eks.csrf=…; Secure; SameSite=Strict; Path=/                                    │
   │  { data: { user, session: { id, expiresAt } } }                                                    │
   │◀──────────────────────┤                       │                 │                    │
```

---

## 7. Flow: Magic-Link Login

```
Browser                @eks/auth               Cache              Notifications
   │                       │                       │                    │
   │  POST /api/v1/auth/magic-link                                                                       │
   │  { email }                                                                                           │
   ├──────────────────────▶│                       │                    │
   │                       │ ① rateLimit (5/min/email)                  │                    │
   │                       │ ② Lookup User by email (do NOT reveal     │                    │
   │                       │    existence; always return 202)          │                    │
   │                       │ ③ Generate magic token = randomBytes(32)  │                    │
   │                       │ ④ Store in cache:                         │                    │
   │                       │    key magic:{SHA256(token)}              │                    │
   │                       │    val { userId, orgId, expiresAt:+10min }│                    │
   │                       ├──────────────────────▶│                    │
   │                       │ ⑤ Queue email with link:                  │                    │
   │                       │    https://eks.food/auth/magic?token=…    │                    │
   │                       │    (token in URL fragment? NO — query     │                    │
   │                       │     param so the SPA can read it;         │                    │
   │                       │     Referer-Policy strips it on           │                    │
   │                       │     cross-origin navigation)              │                    │
   │                       ├───────────────────────────────────────────▶│                    │
   │                       │                       │                    │ send email        │
   │                       │ ⑥ Return 202 (always) │                    │                    │
   │                       │    (no information leak)│                   │                    │
   │  202 Accepted         │                       │                    │
   │◀──────────────────────┤                       │                    │
   │                       │                       │                    │
   │  [User clicks link in email]                                                                        │
   │  GET /auth/magic?token=…                                                                            │
   │  (SPA sends token to API)                                                                           │
   │  POST /api/v1/auth/magic-link/verify                                                                │
   │  { token }                                                                                           │
   ├──────────────────────▶│                       │                    │
   │                       │ ① Hash token (SHA-256)│                    │
   │                       │ ② Lookup cache entry │                    │
   │                       ├──────────────────────▶│                    │
   │                       │◀──────────────────────┤                    │
   │                       │ ③ If missing or expired → 401             │                    │
   │                       │    AUTH_INVALID_CREDENTIALS               │                    │
   │                       │ ④ Delete cache entry (single-use)         │                    │
   │                       │ ⑤ Compute risk score                      │                    │
   │                       │ ⑥ Insert Identity(type=magic_link,        │                    │
   │                       │    status=REVOKED, usedAt=now) — audit    │                    │
   │                       │    trail that the user used magic-link    │                    │
   │                       │    (but not a re-usable credential)       │                    │
   │                       │ ⑦ Create session (same as login ⑥–⑩)      │                    │
   │                       │ ⑧ audit(AUTH_LOGIN_MAGIC_LINK)            │                    │
   │  200 OK + cookies     │                       │                    │
   │◀──────────────────────┤                       │                    │
```

Magic-link is only available when `@eks/features` flag `auth.magic_link` is enabled for the tenant. The Identity row for `magic_link` is created with `status=REVOKED` at use time — magic-link is a one-shot authentication method, not a persistent credential.

---

## 8. Flow: Passkey (WebAuthn) Registration and Login

### 8.1 Registration (enrol a passkey on an authenticated session)

```
Browser (auth'd)       @eks/auth               Prisma
   │                       │                       │
   │  POST /api/v1/mfa/enroll-webauthn (or /webauthn/register)                                          │
   │  (no body; uses authenticated session)                                                             │
   ├──────────────────────▶│                       │
   │                       │ ① Generate challenge = randomBytes(32)    │
   │                       │ ② Store challenge in cache (5 min TTL)    │
   │                       │    keyed by sessionId                     │
   │                       │ ③ Return PublicKeyCredentialCreationOptions:│
   │                       │    { rp: { id: "eks.food", name: "Eks-Food" },│
   │                       │      user: { id: userId, name: email,    ││
   │                       │        displayName: username },          ││
   │                       │      challenge: <base64url>,             ││
   │                       │      pubKeyCredParams: [{alg:-7,type:"public-key"},│
   │                       │                          {alg:-257,...}], ││
   │                       │      authenticatorSelection: {            ││
   │                       │        userVerification: "preferred",     ││
   │                       │        residentKey: "preferred" },        ││
   │                       │      excludeCredentials: [existing       ││
   │                       │        passkey credentialIds] }           ││
   │  200 { options }      │                       │
   │◀──────────────────────┤                       │
   │                       │                       │
   │  [navigator.credentials.create({ publicKey: options })]                                            │
   │  → returns attestation containing credentialId, publicKey, signCount                              │
   │                       │                       │
   │  POST /api/v1/mfa/enroll-webauthn/verify                                                           │
   │  { credentialId, publicKey, attestationObject, clientDataJSON, signCount, name }                   │
   ├──────────────────────▶│                       │
   │                       │ ① Lookup challenge in cache              │
   │                       │ ② Verify clientDataJSON.origin against    │
   │                       │    EKS_AUTH_WEBAUTHN_ORIGIN              │
   │                       │ ③ Verify clientData.challenge == stored  │
   │                       │ ④ Verify attestation signature (none /   │
   │                       │    packed / tpm — none is acceptable for │
   │                       │    M2; packed is verified)               │
   │                       │ ⑤ BEGIN TX                               │
   │                       │    INSERT Identity(type=webauthn,        │
   │                       │      credentialData={credentialId,       │
   │                       │      publicKey, signCount, transports,   │
   │                       │      aaguid, enrolledAt, name},          │
   │                       │      verifiedAt=now, status=ACTIVE)      │
   │                       │    stage outbox:                         │
   │                       │      identity.webauthn.registered.v1     │
   │                       │    audit(MFA_WEBAUTHN_REGISTERED)        │
   │                       │  COMMIT                                  │
   │                       │ ⑥ Return 201 { credentialId, name }      │
   │  201 Created          │                       │
   │◀──────────────────────┤                       │
```

### 8.2 Login (assert an existing passkey)

```
Browser                @eks/auth               Prisma
   │                       │                       │
   │  POST /api/v1/auth/webauthn/login (or /webauthn/assert)                                            │
   │  { email? }                                                                                        │
   ├──────────────────────▶│                       │
   │                       │ ① If email given: lookup user + identities │
   │                       │    of type=webauthn, return allowCredentials│
   │                       │    listing them; else return empty        │
   │                       │    allowCredentials (discoverable)        │
   │                       │ ② Generate assertion challenge = randomBytes(32)│
   │                       │ ③ Cache challenge (5 min) keyed by random │
   │                       │    assertionId                           │
   │                       │ ④ Return PublicKeyCredentialRequestOptions:│
   │                       │    { challenge, rpId, allowCredentials,  │
   │                       │      userVerification: "preferred" }     │
   │  200 { assertionId, options }       │
   │◀──────────────────────┤                       │
   │                       │                       │
   │  [navigator.credentials.get({ publicKey: options })]                                               │
   │  → returns assertion containing credentialId, authenticatorData, signature, clientDataJSON         │
   │                       │                       │
   │  POST /api/v1/auth/webauthn/login/verify                                                           │
   │  { assertionId, credentialId, authenticatorData, signature, clientDataJSON }                       │
   ├──────────────────────▶│                       │
   │                       │ ① Lookup challenge in cache              │
   │                       │ ② Verify clientData.origin, challenge    │
   │                       │ ③ Lookup Identity by credentialId        │
   │                       │ ④ Verify signature against stored pubKey │
   │                       │ ⑤ Compare signCount:                     │
   │                       │    if new ≤ stored → CLONE SUSPECTED     │
   │                       │      return 401 AUTH_DEVICE_UNTRUSTED    │
   │                       │      stage identity.webauthn.clone_      │
   │                       │      suspected.v1                        │
   │                       │    else update signCount = new           │
   │                       │ ⑥ Compute risk (passkey login starts     │
   │                       │    at lower risk — phishing-resistant)   │
   │                       │ ⑦ Create session (method=webauthn)       │
   │                       │ ⑧ audit(AUTH_LOGIN_WEBAUTHN)             │
   │  200 OK + cookies     │                       │
   │◀──────────────────────┤                       │
```

---

## 9. Flow: Refresh-Token Rotation

```
Browser                @eks/auth               Prisma            Audit/Outbox
   │                       │                       │                    │
   │  POST /api/v1/auth/refresh                                                                            │
   │  Cookie: __Host-eks.refresh=…                                                                       │
   │  X-CSRF-Token: …                                                                                    │
   ├──────────────────────▶│                       │                    │
   │                       │ ① rateLimit (60/min/IP)│                    │
   │                       │ ② verifyCookie(refresh,│                    │
   │                       │    COOKIE_SECRET) → raw token             │
   │                       │    (constant-time HMAC)│                    │
   │                       │ ③ Session.findByRefreshTokenHash(         │
   │                       │    SHA256(token))       │                    │
   │                       ├──────────────────────▶│                    │
   │                       │◀──────────────────────┤                    │
   │                       │ ④ If not found:       │                    │
   │                       │    possible REUSE —    │                    │
   │                       │    revoke family       │                    │
   │                       │    Session.revokeAllByFamily(familyId)     │
   │                       │    audit(AUTH_SESSION_ │                    │
   │                       │    REUSE_DETECTED)     │                    │
   │                       │    stage identity.     │                    │
   │                       │    session.revoked.v1  │                    │
   │                       │    return 401          │                    │
   │                       │    AUTH_SESSION_REVOKED│                    │
   │                       │ ⑤ If Session.status=   │                    │
   │                       │    REVOKED → 401       │                    │
   │                       │ ⑥ If Session.refreshTok-│                    │
   │                       │    enHash != SHA256(   │                    │
   │                       │    presented token) AND│                    │
   │                       │    == previousRefresh- │                    │
   │                       │    TokenHash → REUSE   │                    │
   │                       │    detected (rotated   │                    │
   │                       │    token reused)       │                    │
   │                       │    revoke entire family│                    │
   │                       │    audit + outbox (as ④) │                  │
   │                       │ ⑦ Compute risk score   │                    │
   │                       │    (re-evaluate at     │                    │
   │                       │     every refresh)     │                    │
   │                       │ ⑧ If risk ≥ 90 → revoke│                    │
   │                       │    return 401 AUTH_    │                    │
   │                       │    DEVICE_UNTRUSTED    │                    │
   │                       │ ⑨ If idle timeout      │                    │
   │                       │    exceeded → revoke   │                    │
   │                       │    return 401 AUTH_    │                    │
   │                       │    SESSION_EXPIRED     │                    │
   │                       │ ⑩ BEGIN TX             │                    │
   │                       │    UPDATE Session      │                    │
   │                       │      previousRefresh-  │                    │
   │                       │      TokenHash = old   │                    │
   │                       │      refreshTokenHash  │                    │
   │                       │      refreshTokenHash =│                    │
   │                       │        SHA256(newToken)│                    │
   │                       │      lastSeenAt = now  │                    │
   │                       │      expiresAt = now + │                    │
   │                       │        ACCESS_TOKEN_TTL│                    │
   │                       │      riskScore = new   │                    │
   │                       │    stage identity.     │                    │
   │                       │    session.refreshed.v1│                    │
   │                       │    audit(AUTH_REFRESH) │                    │
   │                       │  COMMIT                │                    │
   │                       │ ⑪ Issue new cookies    │                    │
   │  200 OK               │                       │                    │
   │  Set-Cookie: __Host-eks.session=newAccessTok…                                                      │
   │  Set-Cookie: __Host-eks.refresh=newRefreshTok…                                                     │
   │  Set-Cookie: __Host-eks.csrf=newCsrf…                                                              │
   │  { data: { session: { id, expiresAt } } }                                                          │
   │◀──────────────────────┤                       │                    │
```

**Reuse detection.** Two cases trigger family revocation:
1. The presented refresh token's hash matches `previousRefreshTokenHash` on a session that has already rotated — the legitimate client would have used the new token; an attacker has captured the old one.
2. The presented refresh token is unknown entirely, but its family is tracked (the family ID is embedded in the encrypted token payload) — the family is being probed.

In both cases the entire `refreshFamilyId` is revoked. The user must re-authenticate. An email alert is queued ("We detected suspicious activity on your account — please sign in again").

---

## 10. Flow: Logout

```
Browser                @eks/auth               Prisma            Audit/Outbox
   │                       │                       │                    │
   │  POST /api/v1/auth/logout                                                                            │
   │  Cookie: __Host-eks.session=…; __Host-eks.refresh=…                                                 │
   │  X-CSRF-Token: …                                                                                    │
   ├──────────────────────▶│                       │                    │
   │                       │ ① Resolve session from │                    │
   │                       │    __Host-eks.session  │                    │
   │                       │ ② BEGIN TX             │                    │
   │                       │    UPDATE Session      │                    │
   │                       │      status=REVOKED    │                    │
   │                       │      revokedAt=now     │                    │
   │                       │      revokeReason=     │                    │
   │                       │        "user_logout"   │                    │
   │                       │    UPDATE LoginHistory │                    │
   │                       │      logoutAt=now      │                    │
   │                       │    stage outbox:       │                    │
   │                       │      identity.session. │                    │
   │                       │      revoked.v1        │                    │
   │                       │    audit(AUTH_LOGOUT)  │                    │
   │                       │  COMMIT                │                    │
   │                       │ ③ Set cookies with     │                    │
   │                       │    Max-Age=0 (expire)  │                    │
   │  204 No Content       │                       │                    │
   │  Set-Cookie: __Host-eks.session=; Max-Age=0…                                                       │
   │  Set-Cookie: __Host-eks.refresh=; Max-Age=0…                                                       │
   │  Set-Cookie: __Host-eks.csrf=; Max-Age=0…                                                          │
   │◀──────────────────────┤                       │                    │
```

Logout from one device does **not** revoke other sessions. `POST /api/v1/sessions/{id}/revoke` revokes a specific session; `POST /api/v1/sessions/revoke-all` revokes every session for the user (used by the "Sign out everywhere" UI button and by the breach runbook — see `DISASTER_RECOVERY.md` §5).

---

## 11. Flow: Password Reset

```
Browser                @eks/auth               Cache              Notifications
   │                       │                       │                    │
   │  POST /api/v1/auth/reset-password/request                                                          │
   │  { email }                                                                                           │
   ├──────────────────────▶│                       │                    │
   │                       │ ① rateLimit (3/hour/email)                  │                    │
   │                       │ ② Lookup User by email (do NOT reveal)     │                    │
   │                       │ ③ Generate resetToken = randomBytes(32)    │                    │
   │                       │ ④ Cache: reset:{SHA256(token)} =           │                    │
   │                       │    { userId, expiresAt:+1h } (TTL 1h)      │                    │
   │                       ├──────────────────────▶│                    │
   │                       │ ⑤ Queue email with link:                   │                    │
   │                       │    https://eks.food/auth/reset?token=…     │                    │
   │                       ├───────────────────────────────────────────▶│                    │
   │                       │ ⑥ Return 202 (always — no leak)           │                    │
   │  202 Accepted         │                       │                    │
   │◀──────────────────────┤                       │                    │
   │                       │                       │                    │
   │  [User clicks link]                                                                                  │
   │  POST /api/v1/auth/reset-password/confirm                                                           │
   │  { token, newPassword }                                                                              │
   ├──────────────────────▶│                       │                    │
   │                       │ ① Hash token, lookup cache              │                    │
   │                       │ ② If missing/expired → 401 AUTH_INVALID_CREDENTIALS │          │
   │                       │ ③ Validate newPassword against policy    │                    │
   │                       │ ④ Argon2id.hash(newPassword)            │                    │
   │                       │ ⑤ BEGIN TX                              │                    │
   │                       │    UPDATE Identity(type=password)        │                    │
   │                       │      status=REVOKED (rotate old)         │                    │
   │                       │    INSERT Identity(type=password,        │                    │
   │                       │      credentialData=newHash,             │                    │
   │                       │      status=ACTIVE, verifiedAt=now)      │                    │
   │                       │    UPDATE User                           │                    │
   │                       │      passwordChangedAt=now               │                    │
   │                       │    Session.revokeAllForUser(userId)      │                    │
   │                       │      (force re-login on all devices)     │                    │
   │                       │    stage outbox:                         │                    │
   │                       │      identity.password.changed.v1        │                    │
   │                       │    audit(AUTH_PASSWORD_RESET)            │                    │
   │                       │  COMMIT                                  │                    │
   │                       │ ⑥ Delete reset token from cache (single-use)│                  │
   │                       │ ⑦ Queue password-changed alert email    │                    │
   │                       ├───────────────────────────────────────────▶│                    │
   │  204 No Content       │                       │                    │
   │◀──────────────────────┤                       │                    │
```

**Key invariant:** Resetting the password **revokes all sessions** for the user. If the user's password was compromised, the attacker's session is killed alongside the legitimate user's. Both must re-authenticate with the new password.

---

## 12. Flow: Account Recovery

Account recovery handles the case where the user has lost their MFA device **and** cannot produce a recovery code. This is a high-risk flow and is gated by the `SUPPORT` role.

```
User (locked out)     Support agent (SUPPORT)   @eks/auth            Notifications
   │                       │                       │                    │
   │  contact support       │                       │                    │
   ├──────────────────────▶│                       │                    │
   │                       │  ① Verify identity via     │                    │
   │                       │     out-of-band channel     │                    │
   │                       │     (e.g. phone call +      │                    │
   │                       │      gov ID on file)        │                    │
   │                       │  ② Support opens admin UI:  │                    │
   │                       │     POST /api/v1/admin/users/{id}/recover       │
   │                       │     (requires SUPPORT role   │                    │
   │                       │      + second approver       │                    │
   │                       │      SUPER_ADMIN or          │                    │
   │                       │      another SUPPORT)        │                    │
   │                       ├──────────────────────▶│                    │
   │                       │                       │  ③ BEGIN TX         │
   │                       │                       │    UPDATE MFAConfig │
   │                       │                       │      status=RESET_ │
   │                       │                       │      PENDING        │
   │                       │                       │      resetAt=+24h   │
   │                       │                       │    UPDATE User      │
   │                       │                       │      status=ACTIVE  │
   │                       │                       │      (if was locked)│
   │                       │                       │    Session.revokeAll│
   │                       │                       │      ForUser(userId)│
   │                       │                       │    stage outbox:    │
   │                       │                       │      identity.mfa.  │
   │                       │                       │      reset.v1       │
   │                       │                       │    audit(MFA_RESET_ │
   │                       │                       │      ADMIN)         │
   │                       │                       │  COMMIT             │
   │                       │                       │  ④ Generate one-   │
   │                       │                       │    time recovery   │
   │                       │                       │    link (cache 1h) │
   │                       │                       │  ⑤ Queue email to  │
   │                       │                       │    user's verified │
   │                       │                       │    email with link │
   │                       │                       ├───────────────────▶│
   │                       │                       │  ⑥ Return 204      │
   │                       │◀──────────────────────┤                    │
   │                       │                       │                    │
   │  [User clicks link in email]                                                                       │
   │  POST /api/v1/auth/recover/confirm                                                                   │
   │  { token, newPassword, newMfaSecret? }                                                              │
   ├──────────────────────────────────────────────▶│                    │
   │                       │                       │  ① Verify recovery │
   │                       │                       │    token (cache)   │
   │                       │                       │  ② Set new password│
   │                       │                       │    (rotate Identity)│
   │                       │                       │  ③ If newMfaSecret:│
   │                       │                       │    enroll new TOTP │
   │                       │                       │  ④ Mark MFAConfig  │
   │                       │                       │    status=ACTIVE   │
   │                       │                       │  ⑤ audit + outbox  │
   │                       │                       │  ⑥ Issue session   │
   │  200 + cookies        │                       │                    │
   │◀──────────────────────────────────────────────┤                    │
```

The two-approver rule prevents a single rogue SUPPORT agent from taking over any account. Every recovery is fully audited and surfaces in the SOC dashboard.

---

## 13. Flow: Account Lockout

```
Attacker (or forgetful user)    @eks/auth          Audit/Outbox          Notifications
   │                                 │                    │                    │
   │  POST /api/v1/auth/login (×5 wrong)                                                           │
   ├────────────────────────────────▶│                    │                    │
   │                                 │  ① Each failure:    │                    │
   │                                 │     Identity.failed++                   │
   │                                 │     audit(AUTH_LOGIN_FAILED)            │
   │                                 │  ② At failure #5:                       │
   │                                 │     Identity.lockedUntil=+15min         │
   │                                 │     stage outbox:                       │
   │                                 │       identity.identity.locked.v1       │
   │                                 │     audit(AUTH_ACCOUNT_LOCKED)          │
   │                                 ├───────────────────▶│                    │
   │                                 │                    │ publish →          │
   │                                 │                    │ subscriber:        │
   │                                 │                    │ notifications      │
   │                                 │                    ├───────────────────▶│
   │                                 │                    │                    │ queue email:
   │                                 │                    │                    │   "Your account
   │                                 │                    │                    │    was locked
   │                                 │                    │                    │    after 5 failed
   │                                 │                    │                    │    attempts"
   │  423 AUTH_ACCOUNT_LOCKED        │                    │                    │
   │  { retryAfter: 900 }            │                    │                    │
   │◀────────────────────────────────┤                    │                    │
   │                                 │                    │                    │
   │  [15 min later]                                                                            │
   │  POST /api/v1/auth/login (×1 wrong)                                                          │
   ├────────────────────────────────▶│                    │                    │
   │                                 │  ③ Failure #6:                          │
   │                                 │     lockedUntil=+30min (doubles)        │
   │                                 │     audit(AUTH_ACCOUNT_LOCKED)          │
   │                                 │     notifications: email alert          │
   │  423 AUTH_ACCOUNT_LOCKED        │                    │                    │
   │◀────────────────────────────────┤                    │                    │
   │                                 │                    │                    │
   │  [User authenticates via passkey while password Identity is locked]                         │
   │  POST /api/v1/auth/webauthn/login/verify                                                     │
   ├────────────────────────────────▶│                    │                    │
   │                                 │  ④ WebAuthn Identity is not locked;     │
   │                                 │     session created normally            │
   │                                 │     audit(AUTH_LOGIN_WEBAUTHN)          │
   │  200 + cookies                  │                    │                    │
   │◀────────────────────────────────┤                    │                    │
```

The lockout is on the `Identity` of type `password`, not the `User`. A user who has forgotten their password but still has their passkey can log in normally; the lockout is irrelevant. (Conversely, an attacker who has the password but not the passkey is blocked.)

---

## 14. Email Verification

Email verification is decoupled from registration (§5). The flow:

```
Browser                @eks/auth               Cache              Notifications
   │                       │                       │                    │
   │  POST /api/v1/auth/verify-email                                                                  │
   │  { token }                                                                                         │
   ├──────────────────────▶│                       │                    │
   │                       │ ① Hash token, lookup cache              │                    │
   │                       │ ② If missing/expired → 401              │                    │
   │                       │ ③ BEGIN TX                              │                    │
   │                       │    UPDATE Identity(type=password)       │                    │
   │                       │      verifiedAt=now                     │                    │
   │                       │    UPDATE User                          │                    │
   │                       │      status=ACTIVE                      │                    │
   │                       │    stage outbox:                        │                    │
   │                       │      identity.user.activated.v1         │                    │
   │                       │    audit(AUTH_EMAIL_VERIFIED)           │                    │
   │                       │  COMMIT                                 │                    │
   │                       │ ④ Delete cache token (single-use)       │                    │
   │  200 OK               │                       │                    │
   │◀──────────────────────┤                       │                    │
```

If the user did not receive the verification email (typo in the address, spam filter), `POST /api/v1/auth/resend-verification` queues a fresh one (rate-limited to 3 per hour per email).

---

## 15. Cross-References

| Topic | Document |
|---|---|
| Refresh-token rotation mechanics, device fingerprinting, risk scoring algorithm | `SESSION_SECURITY.md` |
| MFA enrolment, recovery codes, adaptive step-up | `MFA.md` |
| Cookie security, CSRF, brute-force protection (OWASP mapping) | `SECURITY_HARDENING.md` |
| Breach runbook (force global password reset, revoke all sessions) | `DISASTER_RECOVERY.md` |
| REST API reference for every flow's endpoints | `API_REFERENCE.md` |
