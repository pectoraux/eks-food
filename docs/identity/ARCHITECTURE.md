# Eks-Food Identity & Access Management — Architecture

> **Audience:** Platform engineers, security reviewers, and on-call identity maintainers. Read alongside `docs/ARCHITECTURE.md` (platform hexagon), `docs/EVENT_CONVENTIONS.md` (eventing), and the sibling docs in this folder: `AUTHENTICATION_FLOWS.md`, `AUTHORIZATION_POLICIES.md`, `MULTI_TENANCY.md`, `SESSION_SECURITY.md`.
>
> **Status:** Milestone 2 — Identity & Access Management. Builds on the M1 foundation (`@eks/common`, `@eks/config`, `@eks/errors`, `@eks/observability`, `@eks/events`, `@eks/cache`, `@eks/features`, `@eks/api`, `@eks/workers`, `@eks/security`, `@eks/payments`, `@eks/domain`, `@eks/testing`) and the M1 domain skeleton (`src/packages/domain/contexts/identity` + `…/organization`). This document describes the **target M2 architecture**: the package interfaces, the Prisma models, the request flow, and the integration with the M1 event bus / outbox / observability stack.

---

## 1. Goals & Non-Goals

### Goals
- Provide a single identity platform that serves every Eks-Food bounded context (Customer, Cook, Booking, Payments, Safety, Marketplace, etc.).
- Strict multi-tenant isolation: a row in any tenant-scoped table is unreachable from another tenant by construction.
- Compose authentication (who are you?) with authorization (what may you do?) without coupling them: a User can authenticate via password, OTP, magic link, or WebAuthn, and the authorization decision is identical regardless of method.
- Explainable denials: every `403 Forbidden` carries a machine-readable reason so support engineers and the audit log can answer "why was this denied?".
- Auditability: every identity action emits an immutable `AuditLog` row **and** a versioned domain event to the transactional outbox (see §6).
- Operability: identity is a critical path — refresh-token rotation, MFA enrollment, and session revocation are all observable in `@eks/observability` (metrics, traces, structured logs).

### Non-Goals
- Acting as a SAML / OIDC identity **provider** for third parties. M2 is a consumer of identity (it issues its own opaque session tokens). Federation via OIDC is M3.
- Storing raw government-issued documents. The `Verification` context (see `VERIFICATION.md`) stores **status** only.
- Replacing the `@eks/security` RBAC permission matrix with a generic policy engine. M2 keeps a typed permission registry (`PERMISSIONS` in `src/packages/security/rbac.ts`) as the single source of truth and adds an ABAC layer on top.

---

## 2. Bounded Contexts

The IAM platform is decomposed into eight bounded contexts. Each maps to one or more `@eks/*` packages and one or more Prisma models. Bounded-context boundaries are visible at every import site (the domain barrel uses `export * as identity from './contexts/identity'`, see `src/packages/domain/index.ts`).

| Bounded Context | Owns | `@eks/*` Package(s) | Prisma Models | Domain Skeleton Location |
|---|---|---|---|---|
| **Authentication** | Verifying credentials, issuing sessions, refresh-token rotation, magic-link/passkey orchestration | `@eks/auth` (M2), `@eks/security` (crypto, cookies — M1) | `Identity`, `Session`, `Device`, `LoginHistory` | `src/packages/domain/contexts/identity` |
| **Authorization** | RBAC role resolution, ABAC policy evaluation, explainable denials | `@eks/authorization` (M2), `@eks/security/rbac` (M1) | `Role`, `Permission`, `Policy`, `Membership` | `src/packages/domain/contexts/identity` (services), `…/organization` (membership) |
| **Identity** | The User profile, credential-vs-identity separation, user lifecycle | `@eks/identity` (M2) | `User`, `Identity`, `UserPreference`, `MFAConfiguration`, `RecoveryCode` | `src/packages/domain/contexts/identity` (UserAggregate, CredentialAggregate) |
| **Organizations** | Tenants, their hierarchy, lifecycle, configuration, feature flags | `@eks/organizations` (M2) | `Organization`, `TenantConfiguration`, `FeatureFlagAssignment`, `Team` | `src/packages/domain/contexts/organization` |
| **Membership** | User↔Organization join, role assignment within an org, team membership | `@eks/organizations` (M2, membership sub-module) | `Membership`, `Invitation` | `src/packages/domain/contexts/organization` (MembershipAggregate) |
| **Sessions** | Session lifecycle, device tracking, risk scoring, revocation | `@eks/auth` (M2) | `Session`, `Device`, `LoginHistory` | `src/packages/domain/contexts/identity` (SessionAggregate) |
| **Security** | MFA, account lockout, brute-force protection, CSRF, password policy | `@eks/security` (M1 hardened in M2) | `MFAConfiguration`, `RecoveryCode`, `LoginHistory` | `src/packages/domain/contexts/identity` (CredentialAggregate.enableMfa) |
| **Audit** | Tamper-evident audit log, GDPR data-subject rights, retention | `@eks/observability/audit` (M1), `@eks/identity/audit` (M2 extension) | `AuditLog`, `LoginHistory` | `src/packages/observability/audit.ts` + M2 extension |

> **Package note.** `@eks/identity`, `@eks/auth`, `@eks/authorization`, `@eks/organizations`, `@eks/notifications`, `@eks/verification` are the six new packages M2 publishes under `src/packages/`. Each follows the M1 pattern: `package.json` (name, version, private), `index.ts` barrel, source files, `__tests__/*.spec.ts`. They depend on the M1 kernel (`@eks/common`, `@eks/errors`, `@eks/observability`, `@eks/events`, `@eks/cache`, `@eks/config`, `@eks/security`) and on the M1 domain skeleton types in `@eks/domain/contexts/identity` + `…/organization`.

---

## 3. Credential vs. Identity Separation

A **User** is a person or service principal: their display name, locale, avatar, preferences. A User **does not** carry a password field.

An **Identity** is a single credential a User can authenticate with. A User has **many** Identities — one per authentication method:

```
User (1) ───< Identity (N)
              ├─ type: "password"    → argon2id hash
              ├─ type: "webauthn"    → credentialId, public key, sign count
              ├─ type: "magic_link"  → email-verifying (no shared secret)
              ├─ type: "otp_email"   → factor only (never primary)
              ├─ type: "otp_sms"     → factor only, low-trust
              └─ type: "oidc"        → external IdP subject (M3)
```

Prisma shape:

```prisma
model User {
  id              String   @id @default(cuid())
  // No password column here. Credentials live in Identity.
  email           String   @unique
  username        String?  @unique
  displayName     String
  status          String   @default("PENDING_ACTIVATION") // PENDING_ACTIVATION | ACTIVE | SUSPENDED | DEACTIVATED
  locale          String   @default("en")
  // …
  identities      Identity[]
  mfaConfiguration MFAConfiguration?
  recoveryCodes   RecoveryCode[]
  sessions        Session[]
  memberships     Membership[]
  preferences     UserPreference?
  auditLogs       AuditLog[]
  loginHistory    LoginHistory[]
}

model Identity {
  id              String   @id @default(cuid())
  userId          String
  // password | webauthn | magic_link | otp_email | otp_sms | oidc
  type            String
  // For password: argon2id hash + algorithm + params (JSON).
  // For webauthn: credentialId, publicKey, signCount, transports (JSON).
  // For oidc: issuer, subject.
  // For magic_link / otp: not stored here (one-time, in cache).
  credentialData  String   @default("{}")
  // Verified-on timestamp; null until the user proves ownership
  verifiedAt      DateTime?
  // Soft-rotate credentials: a compromised one is REVOKED, not deleted.
  status          String   @default("ACTIVE") // ACTIVE | REVOKED | EXPIRED
  createdAt       DateTime @default(now())
  lastUsedAt      DateTime?

  user            User     @relation(fields: [userId], references: [id])
  @@index([userId, type])
  @@unique([userId, type, status]) // one ACTIVE credential per (user, type)
}
```

**Why this matters:**

1. **Rotation is non-destructive.** A user changing their password produces a new `Identity` row (or a new `credentialData` blob) and `REVOKED` on the old one. The audit trail retains both.
2. **Multi-factor users have multiple identities.** Amara (a cook-manager) has `password` + `webauthn` (passkey as a second factor) + `otp_email` (recovery factor). MFA enrolment = enabling an additional `Identity` plus a `MFAConfiguration` row that records the verified factor list.
3. **Lockout is granular.** Five failed password attempts lock the `Identity` of type `password`, not the `User`. The user can still log in with their passkey while the password Identity is cooling down.
4. **Federation composes.** When M3 adds OIDC, an external IdP is just another `Identity` row. The `User` is unaffected, the authorization decision is unaffected, and the audit log records `AUTH_LOGIN_OIDC`.

This mirrors the domain skeleton: `UserAggregate` (state + role grants) and `CredentialAggregate` (current + previous `CredentialRecord`, `enableMfa`/`disableMfa`) are separate aggregates in `src/packages/domain/contexts/identity/aggregates.ts`.

---

## 4. Session Model

A **Session** is an authenticated, revocable, time-bounded grant tied to a User and a Device. The token the client holds is **opaque** (see `OpaqueToken` in `src/packages/domain/contexts/identity/value-objects.ts`): it is a random string signed by `@eks/security/cookies` (HMAC-SHA256, constant-time verify). The server resolves the token → `Session` row → `User` + active `Membership` on every request.

```
Session
  ├─ id (UUID)
  ├─ userId           → User
  ├─ deviceFingerprint → Device (abstraction; see SESSION_SECURITY.md)
  ├─ method           → password | otp | sso | api_key | webauthn | magic_link
  ├─ status           → ACTIVE | EXPIRED | REVOKED
  ├─ riskScore        → 0..100 (computed at issue + refreshed on refresh)
  ├─ refreshTokenHash → SHA-256 of the current opaque refresh token
  ├─ refreshFamilyId  → groups all refresh tokens derived from one login
  ├─ issuedAt, expiresAt, lastSeenAt, revokedAt, revokeReason
  └─ ipHash, userAgent (for audit + risk; see §6)
```

**Refresh-token rotation.** Every successful refresh **mints a new refresh token and invalidates the old one**, but keeps them in the same `refreshFamilyId`. If a refresh request presents a token that was already rotated (its hash matches a `previousRefreshTokenHash` on an active session), the entire family is revoked — this is the standard refresh-token-rotation-reuse detection and is the primary defence against token theft. Full mechanics in `SESSION_SECURITY.md` §2.

**Device tracking.** A `Device` row records a stable, privacy-respecting fingerprint (UA + Accept-Language + coarse screen/ TZ + a per-device random `deviceId` cookie). On login, the session binds to a Device; on subsequent requests, the device fingerprint is compared to the session's device and any mismatch contributes to the risk score (see §5).

**Risk scoring.** Every session carries a `riskScore` 0–100 computed from: IP reputation (via the `IpReputationProvider` hook in `@eks/security`), new device vs. known device, geo-velocity (distance from the last successful login / time elapsed), impossible-travel detection, and TOR/VPN/proxy detection. Risk ≥ 70 triggers step-up MFA; risk ≥ 90 blocks the session. Scoring is recomputed on every refresh. Full algorithm in `SESSION_SECURITY.md` §4.

---

## 5. Authorization Model — RBAC + ABAC

Eks-Food authorization is a layered evaluation. The domain service `AuthorizationService.evaluate(request: AuthorizationRequest): Promise<AuthorizationDecision>` (declared in `src/packages/domain/contexts/identity/services.ts`) is the single entry point.

```
Layer 1: Role membership
        The actor's Principal is built from their Memberships:
          global roles (SUPER_ADMIN, SUPPORT) + per-org role (OWNER/ADMIN/MANAGER/MEMBER/VIEWER)
          + per-team role (TEAM_LEAD/TEAM_MEMBER).
        No role ⇒ deny("no_memberships").

Layer 2: Permission grant
        Each role carries a set of Permission codes (e.g. "booking.assign").
        The Permission registry in @eks/security/rbac.ts is the single source of truth.
        No matching permission ⇒ deny("permission_not_granted").

Layer 3: ABAC context filter
        A Policy row may attach conditions to a (role, permission) pair:
          - ownership      (actor.id == resource.ownerId)
          - hierarchy      (resource.region in actor.managedRegions)
          - scope          (resource.tenantId == actor.activeTenantId)
          - time           (now within businessHours)
          - feature flag   (FeatureFlagService.isEnabled(flag, actor))
        Every condition must pass; first failure ⇒ deny("abac_<rule>_failed: <detail>").

Layer 4: Decision
        All layers pass ⇒ authorized=true, matchedPermissions=[…].
        Any deny ⇒ authorized=false, reason=<stable machine code>.
```

The decision is **explainable**: every `false` carries a `reason` string (`"abac_scope_failed"`, `"permission_not_granted"`, etc.) that flows into the audit log and the RFC 7807 `details` field on `403` responses. Full worked example in `AUTHORIZATION_POLICIES.md` §6 (Amara reassigning a booking in East Legon).

**Policy inheritance.** Team policies inherit from org policies inherit from global policies. A `deny` at a lower level **cannot** be overridden by a higher level (deny-by-default). An `allow` at a lower level can be **restricted** (not broadened) by a higher level — e.g. a global `ADMIN` allow for `booking.read` can be scoped by an org-level policy to "only bookings in regions this admin manages".

---

## 6. Multi-Tenancy Isolation Strategy

Multi-tenancy is enforced at three layers; breaching any one is insufficient to read another tenant's data.

**Layer 1 — Schema.** Every tenant-scoped Prisma model carries `organizationId String @default(...)` plus `@@index([organizationId])`. The IAM models (`User`, `Identity`, `Session`, `Device`, `Membership`, `Invitation`, `AuditLog`, `LoginHistory`, `MFAConfiguration`, `RecoveryCode`, `UserPreference`, `TenantConfiguration`, `FeatureFlagAssignment`) are tenant-scoped except for a small set of global models (`Role`, `Permission`, `Policy` when `scope=global`, `Organization` itself).

**Layer 2 — Repository enforcement.** Every repository in `@eks/identity` / `@eks/organizations` reads and writes through a `TenantScopedRepository` base class that injects `organizationId` into every Prisma `where` clause. The active `organizationId` is read from the `TenantContext` (see Layer 3). A repository call without a `TenantContext` returns an empty result — never another tenant's data. This is the "missing orgId returns empty, never another tenant's data" guarantee.

**Layer 3 — Request-context propagation.** The `TenantContext` is propagated via the same `AsyncLocalStorage` mechanism the M1 `@eks/observability/context.ts` uses for `RequestContext`. The M2 `withTenantContext(orgId, fn)` runs `fn` with the active tenant set; every repository call inside `fn` automatically picks it up. The middleware (`@eks/auth/middleware`) sets the `TenantContext` from the session's currently active membership before the route handler runs.

**Layer 4 — Defence in depth (M3).** PostgreSQL Row-Level Security policies will add a fourth layer: even a repository bug that forgets to filter by `organizationId` would yield zero rows because the database role's RLS policy rejects the cross-tenant row. RLS is M3; Layers 1–3 ship in M2.

Full mechanics, including the tenant-switch flow for users belonging to multiple orgs, are in `MULTI_TENANCY.md`.

---

## 7. Request → Auth → Authorization → Tenant-Scope Flow

```
                                  ┌─────────────────────────────┐
   HTTPS request                  │  Edge (Caddy)               │
   with __Host-eks.session cookie │  • TLS 1.3 termination      │
   + Idempotency-Key (if POST)    │  • HSTS, CSP, security hdrs │
   + X-Correlation-Id             │  • Rate limit (per IP+path) │
 ─────────────────────────────────▶│  • Forward to Next.js      │
                                  └──────────────┬──────────────┘
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │  @eks/api/apiHandler        │  M1
                                  │  • newRequestContext()      │
                                  │  • withRequestContext(als)  │
                                  │  • startSpan(http.server)   │
                                  │  • try/catch → problem+json │
                                  └──────────────┬──────────────┘
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │  @eks/auth/middleware       │  M2
                                  │  1. Read __Host-eks.session │
                                  │     cookie (signed).        │
                                  │  2. verifyCookie() (HMAC).  │
                                  │  3. sessionRepo.findByTok() │
                                  │  4. If REVOKED/EXPIRED → 401│
                                  │  5. Refresh riskScore; if   │
                                  │     risk≥90 → 401 + audit.  │
                                  │  6. Build Principal:        │
                                  │     { userId, orgId, roles, │
                                  │       permissions, scope }  │
                                  │  7. withTenantContext(orgId)│
                                  │  8. CSRF double-submit chk │
                                  │     on POST/PUT/PATCH/DEL.  │
                                  └──────────────┬──────────────┘
                                                 │  Principal + TenantContext in ALS
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │  @eks/authorization/authorize│ M2
                                  │  authorize(principal,       │
                                  │    "booking.assign",        │
                                  │    { resource: "Booking",   │
                                  │      resourceId: "EKS-…",   │
                                  │      tenantId: principal.   │
                                  │        activeTenantId })   │
                                  │  → AuthorizationDecision    │
                                  │  • if deny → 403 + reason   │
                                  │    + audit("AUTHZ_DENIED")  │
                                  └──────────────┬──────────────┘
                                                 │  authorized=true
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │  Route handler              │
                                  │  • Zod validate body/query  │
                                  │  • idempotency() (POST)     │
                                  │  • rateLimit() (per route)  │
                                  │  • repo.findX(...)          │
                                  │    ↳ TenantScopedRepository │
                                  │      auto-injects orgId     │
                                  │  • mutate aggregate         │
                                  │  • outbox.stage(event) in   │
                                  │    same tx as aggregate     │
                                  │  • audit.record({...})      │
                                  │  • success(data) / 201/204  │
                                  └──────────────┬──────────────┘
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │  @eks/api/apiHandler (post) │
                                  │  • span.setAttribute(       │
                                  │     http.status)            │
                                  │  • attach x-request-id,     │
                                  │    x-correlation-id         │
                                  │  • emit metrics:            │
                                  │    http_requests_total{…}   │
                                  │    http_request_duration_ms │
                                  └──────────────┬──────────────┘
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │  Outbox Relay Worker        │  M1 (@eks/events)
                                  │  • SELECT FOR UPDATE SKIP   │
                                  │    LOCKED FROM EventOutbox  │
                                  │  • eventBus.publish(event)  │
                                  │  • mark PUBLISHED           │
                                  │  • on 5th failure → DLQ     │
                                  └──────────────┬──────────────┘
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │  Subscribers                │
                                  │  • @eks/notifications →     │
                                  │    welcome/alert emails     │
                                  │  • @eks/observability/audit │
                                  │    → immutable AuditLog     │
                                  │  • @eks/identity projections│
                                  │    (LoginHistory)           │
                                  └─────────────────────────────┘
```

---

## 8. Integration with M1 Foundations

The IAM platform is **not** a parallel system — it consumes and extends the M1 kernel at every layer.

### 8.1 Event bus + transactional outbox
Every identity action that mutates state writes its domain event to the `EventOutbox` table in the **same Prisma transaction** as the aggregate write (this is the M1 outbox guarantee; see `src/packages/events/outbox.ts` and `docs/EVENT_CONVENTIONS.md`). The outbox relay worker then publishes to the `EventBus`, where M2 subscribers react:

| Domain Event | Subscriber | Reaction |
|---|---|---|
| `identity.user.registered.v1` | `@eks/notifications` | Send welcome email (`UserRegistered` template) |
| `identity.user.registered.v1` | `@eks/identity` projection | Build `UserPreference` defaults |
| `identity.session.started.v1` | `@eks/observability/audit` | Write `AuditLog` (action=`AUTH_LOGIN`) |
| `identity.session.started.v1` | `@eks/notifications` | If `deviceFingerprint` is new, send "new device" alert email |
| `identity.session.revoked.v1` | `@eks/identity` projection | Mark `Session.revokedAt`, `LoginHistory.logoutAt` |
| `identity.user.role.granted.v1` | `@eks/observability/audit` | Write `AuditLog` (action=`ROLE_GRANTED`) |
| `organization.member.added.v1` | `@eks/notifications` | Send invitation-accepted confirmation |
| `organization.member.role.changed.v1` | `@eks/observability/audit` | Write `AuditLog` (action=`MEMBERSHIP_ROLE_CHANGED`) |
| `identity.mfa.enabled.v1` | `@eks/notifications` | Send recovery-codes email |
| `identity.password.changed.v1` | `@eks/notifications` | Send password-changed alert email |

Event envelopes use the M1 shape (`EventMetadata` with `eventId`, `correlationId`, `causationId`, `version: 1`, `tier: "domain"`; see `src/packages/events/types.ts`). Event names follow the `{Aggregate}.{PastTenseVerb}` convention from `src/packages/events/naming.ts`, with the dotted lowercase form (`identity.user.registered.v1`) used as the `eventType` literal for versioning.

### 8.2 Observability
Every identity request produces:
- A **trace span** (`http.server` for the route, child spans for `auth.middleware`, `authorize`, `repo.save`, `outbox.stage`, `audit.record`). Span attributes include `auth.method`, `auth.principal.userId`, `auth.principal.orgId`, `authz.permission`, `authz.decision`.
- **Structured logs** via `@eks/observability/logger` carrying the `RequestContext` (requestId, correlationId, traceId, actorUserId, organizationId) from the M1 `AsyncLocalStorage`.
- **Metrics** via `@eks/observability/metrics`: `auth_login_total{method,result}`, `auth_login_duration_ms`, `authz_decisions_total{permission,decision}`, `mfa_stepup_total{reason}`, `session_active_count`, `session_revoked_total{reason}`, `outbox_pending_count` (M1 metric).
- An **audit log row** via `@eks/observability/audit` for every state-changing action; M2 extends the M1 `AuditActions` registry with the `AUTH_*`, `ORG_*`, `MEMBERSHIP_*`, `ROLE_*`, `MFA_*`, `SESSION_*` codes (see `AUDIT_AND_COMPLIANCE.md` §3).

### 8.3 Configuration
All identity configuration is Zod-validated at boot via `@eks/config`. The M2 schema additions (validated by `AppConfigSchema` in `src/packages/config/schema.ts`):

| Env var | Type | Default | Purpose |
|---|---|---|---|
| `EKS_AUTH_MODE` | enum: `header_demo` \| `jwt` | `header_demo` | M1 sandbox default; production must set `jwt`. |
| `EKS_AUTH_COOKIE_NAME` | string | `__Host-eks.session` | The session cookie name. `__Host-` prefix forces Secure + Path=/ + no Domain. |
| `EKS_AUTH_COOKIE_SECRET` | string (32+ chars) | (required in prod) | HMAC-SHA256 signing key for cookies; rotated quarterly. |
| `EKS_AUTH_ACCESS_TOKEN_TTL_MS` | int | `900_000` (15 min) | Access-token (session) TTL. |
| `EKS_AUTH_REFRESH_TOKEN_TTL_MS` | int | `2592000000` (30d) | Refresh-token absolute TTL. |
| `EKS_AUTH_IDLE_TIMEOUT_MS` | int | `86400000` (24h) | Idle timeout (inactivity → session revoked). |
| `EKS_AUTH_MAX_CONCURRENT_SESSIONS` | int | `5` | Hard cap on active sessions per user. |
| `EKS_AUTH_LOCKOUT_THRESHOLD` | int | `5` | Failed attempts before lockout. |
| `EKS_AUTH_LOCKOUT_WINDOW_MS` | int | `900000` (15 min) | Sliding window for the lockout counter. |
| `EKS_AUTH_LOCKOUT_DURATION_MS` | int | `900000` (15 min) | Lockout duration (doubles each strike → progressive). |
| `EKS_AUTH_ARGON2_MEMORY_KIB` | int | `65536` (64 MiB) | Argon2id memory parameter. |
| `EKS_AUTH_ARGON2_ITERATIONS` | int | `3` | Argon2id time-cost. |
| `EKS_AUTH_ARGON2_PARALLELISM` | int | `4` | Argon2id lanes. |
| `EKS_AUTH_MFA_REQUIRED_ROLES` | CSV | `SUPER_ADMIN,SUPPORT,ADMIN` | Roles that must enroll MFA. |
| `EKS_AUTH_PASSWORD_MIN_LENGTH` | int | `12` | Password policy lower bound. |
| `EKS_AUTH_BREACH_LIST_PATH` | string | (none) | Path to HIBP-style breach list for the password-check hook. |
| `EKS_AUTH_IP_REPUTATION_PROVIDER` | enum | `mock` | `mock` \| `ipqualityscore` \| `maxmind` (M3 live integration). |
| `EKS_AUTH_WEBAUTHN_RP_ID` | string | `eks.food` | WebAuthn relying-party ID. |
| `EKS_AUTH_WEBAUTHN_RP_NAME` | string | `Eks-Food` | WebAuthn relying-party display name. |
| `EKS_AUTH_WEBAUTHN_ORIGIN` | string | `https://eks.food` | WebAuthn allowed origin. |

`@eks/config`'s fail-fast loader refuses to boot the process if any required var is missing or malformed — secrets are validated for length, never logged (see `SECURITY_HARDENING.md` §6).

### 8.4 Cache
The M1 `@eks/cache` registry singleton backs:
- **Rate-limit counters** (`@eks/api/rate-limit`) — keyed `rl:{ip}:{path}` with a sliding window.
- **Idempotency-Key replay cache** (`@eks/api/idempotency`) — 24h TTL.
- **Session risk-score cache** — short-TTL cache of the most recent risk computation per session, to avoid recomputing on every request.
- **Magic-link / OTP tokens** — single-use, 10-minute TTL.
- **CSRF double-submit tokens** — short-TTL, scoped to the session.
- **Argon2 hash cache (negative)** — never cache positive password-verification results; the negative cache stores "this username is unknown" for 5s to dampen username-enumeration timing.

### 8.5 Workers
The M1 `@eks/workers` `JobQueue` schedules:
- **Outbox relay** (continuous) — publishes staged events.
- **Session reaper** (every 5 min) — marks sessions `EXPIRED` past their absolute TTL or idle timeout; emits `identity.session.expired.v1`.
- **Lockout clearer** (every 1 min) — releases `Identity` rows whose lockout window has elapsed.
- **Audit-chain hash compactor** (daily) — computes the daily tamper-evidence hash chain (see `AUDIT_AND_COMPLIANCE.md` §5).
- **Recovery-code rotation reminder** (daily) — emails users whose recovery codes are older than 1 year, prompting rotation.
- **Notification dispatcher** (continuous) — consumes the `NotificationAggregate` queue and calls the configured provider.

### 8.6 Features
The M1 `@eks/features` registry gates M2 capabilities behind flags. Twelve canonical `FLAG_KEYS` already exist; M2 adds identity-specific flags:
- `auth.passkey` — enables WebAuthn enrolment + login.
- `auth.magic_link` — enables magic-link login.
- `auth.adaptive_mfa` — enables risk-score-driven step-up.
- `auth.tenant_switch` — enables the multi-org tenant-switcher UI.
- `auth.audit_export` — enables the CSV/JSON audit-export endpoint.

Flags are evaluated per-tenant via `FeatureFlagAssignment` rows (org-level overrides) so a single org can pilot passkeys without a global rollout.

### 8.7 Errors
The M1 `@eks/errors` hierarchy (`UnauthorizedError`, `ForbiddenError`, `ValidationError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `BusinessRuleError`) maps directly to the RFC 7807 `problem+json` shape produced by `toProblemJson()` in `src/packages/errors/problem.ts`. M2 adds identity-specific error codes that extend the existing `ErrorCodes` registry:

| Code | HTTP | When |
|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | Wrong password / expired magic link. |
| `AUTH_ACCOUNT_LOCKED` | 423 | Progressive lockout engaged. |
| `AUTH_MFA_REQUIRED` | 401 | Step-up MFA demanded. |
| `AUTH_MFA_INVALID_CODE` | 401 | Wrong TOTP / OTP. |
| `AUTH_SESSION_EXPIRED` | 401 | Refresh-token TTL elapsed. |
| `AUTH_SESSION_REVOKED` | 401 | Refresh-token reuse detected or admin revoke. |
| `AUTH_DEVICE_UNTRUSTED` | 403 | Risk score too high; user must complete step-up. |
| `AUTHZ_PERMISSION_DENIED` | 403 | RBAC layer denied. |
| `AUTHZ_ABAC_DENIED` | 403 | ABAC condition failed (carries `details.rule`). |
| `AUTHZ_SCOPE_MISMATCH` | 403 | Resource tenantId ≠ principal activeTenantId. |
| `MFA_ALREADY_ENROLLED` | 409 | User tried to enrol TOTP twice. |
| `INVITATION_EXPIRED` | 410 | Invitation token TTL elapsed. |
| `INVITATION_REVOKED` | 410 | Revoker withdrew the invitation. |

Every problem+json response carries `traceId` (from `RequestContext`) and `instance` (the request path) so support can correlate.

---

## 9. Package Dependency Graph

```
                  ┌────────────────────────────────────────────────────┐
                  │ @eks/domain (M1 — 21 bounded contexts, types only) │
                  │  ├─ contexts/identity      (User, Role, Session,   │
                  │  │                          Credential, Permission) │
                  │  └─ contexts/organization (Organization, Tenant,  │
                  │                              Membership)            │
                  └──────────────┬─────────────────────────────────────┘
                                 │ type-only imports
                                 ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ @eks/identity (M2) — User & Identity aggregates, UserPreference, │
   │                       MFAConfiguration, RecoveryCode repositories│
   └──────────────┬─────────────────────────┬─────────────────────────┘
                  │                          │
                  ▼                          ▼
   ┌────────────────────────┐    ┌──────────────────────────────────┐
   │ @eks/auth (M2)         │    │ @eks/organizations (M2)          │
   │  • AuthenticationService│    │  • Organization / Team /         │
   │  • SessionService       │    │    Membership / Invitation       │
   │  • PasswordHasher       │    │  • TenantContext                 │
   │  • TokenService         │    │  • TenantScopedRepository base   │
   │  • MfaService           │    │  • OrganizationType registry     │
   │  • WebAuthnService      │    │  • TenantConfiguration           │
   │  • DeviceService        │    │  • FeatureFlagAssignment         │
   │  • RiskScoringService   │    └──────────────┬───────────────────┘
   │  • middleware           │                   │
   └────────────┬───────────┘                   │
                │                                │
                ▼                                ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ @eks/authorization (M2) — AuthorizationService, PolicyEvaluator, │
   │                            PermissionRegistry, PrincipalBuilder   │
   └──────────────┬───────────────────────────────────────────────────┘
                  │
                  ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ @eks/notifications (M2) — NotificationProvider interfaces,       │
   │                            NotificationTemplate registry,         │
   │                            identity-event → notification mapping  │
   └──────────────┬───────────────────────────────────────────────────┘
                  │
                  ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ @eks/verification (M2) — VerificationProvider interface (M2 scope│
   │                            is interface-only; no providers wired)│
   └──────────────────────────────────────────────────────────────────┘

   All M2 packages depend on the M1 kernel:
     @eks/common (Result, UUID, ids, pagination)
     @eks/config (Zod-validated env)
     @eks/errors (AppError hierarchy + RFC 7807)
     @eks/observability (logger, metrics, tracer, audit, context)
     @eks/events (EventBus, outbox, DLQ)
     @eks/cache (rate-limit + idempotency + token caches)
     @eks/features (FLAG_KEYS)
     @eks/api (apiHandler, validate, rateLimit, idempotency, success)
     @eks/security (rbac, crypto, cookies, sanitization, headers)
     @eks/workers (JobQueue for session reaper, audit compactor, etc.)
```

---

## 10. Cross-Cutting Invariants

These invariants apply to every IAM code path and are enforced by lint rules, code review, and integration tests:

1. **No `organizationId`-less query.** Every repository method in `@eks/identity` / `@eks/organizations` either accepts `organizationId` as a parameter or reads it from the `TenantContext`. A repository that issues a Prisma query without `where: { organizationId }` is a critical bug. Enforced by the `TenantScopedRepository` base class.
2. **No credential material in logs.** Passwords, TOTP secrets, refresh tokens, recovery codes, WebAuthn private keys never appear in `logger()` calls. Enforced by a lint rule banning the identifiers `password`, `secret`, `token`, `recoveryCode` as `logger()` field names.
3. **No `Identity` row is ever deleted.** Compromised credentials are `REVOKED`; the audit trail retains the row. Hard-delete is reserved for GDPR right-to-erasure (which soft-deletes the `User` and replaces PII with a hash, see `AUDIT_AND_COMPLIANCE.md` §4).
4. **Every state-changing handler writes an `AuditLog` row and stages an outbox event in the same transaction.** A handler that mutates state without an audit row fails code review.
5. **Every authorization decision (allow or deny) is logged.** Allows go to the standard audit log; denies go to the audit log **and** emit a `authz.decision` metric so the SOC can chart deny rates per permission.
6. **Cookies use `__Host-` prefix.** No `Domain=` attribute. `Secure`, `HttpOnly`, `SameSite=Lax` (or `Strict` for the CSRF token). Enforced by `cookieHeader()` in `src/packages/security/cookies.ts` (defaults).
7. **Refresh tokens are opaque, signed, single-use.** Never JWTs. Never embedded in URLs. Never logged.
8. **Risk score ≥ 90 ⇒ session revoked.** Risk ≥ 70 ⇒ step-up MFA demanded before the request proceeds.

---

## 11. Cross-References

| Topic | Document |
|---|---|
| Authentication sequence diagrams (registration, login+MFA, magic-link, passkey, refresh, logout, reset, recovery, lockout) | `AUTHENTICATION_FLOWS.md` |
| RBAC role catalogue, Permission registry, ABAC policy evaluation, worked Amara example | `AUTHORIZATION_POLICIES.md` |
| Tenant isolation mechanics, `TenantContext`, tenant-switch flow, data residency | `MULTI_TENANCY.md` |
| Session lifecycle, refresh-token rotation reuse detection, device fingerprinting, risk scoring | `SESSION_SECURITY.md` |
| MFA enrolment (TOTP, recovery codes, passkey as factor), adaptive step-up | `MFA.md` |
| Organization model, lifecycle, teams, invitations, membership history | `ORGANIZATIONS.md` |
| Audit platform, taxonomy, retention, GDPR rights, tamper-evidence | `AUDIT_AND_COMPLIANCE.md` |
| DR for identity: credential backup, session-store resilience, key rotation, breach runbook | `DISASTER_RECOVERY.md` |
| OWASP A01–A10 mapping, password policy, rate limits, secrets boundary | `SECURITY_HARDENING.md` |
| Notification providers, template registry, identity-event triggers, localization | `NOTIFICATIONS.md` |
| VerificationProvider interface, VerificationRequest/Result flow, M2 scope | `VERIFICATION.md` |
| REST API reference for every `/api/v1/*` identity endpoint | `API_REFERENCE.md` |
