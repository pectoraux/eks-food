# Eks-Food IAM — REST API Reference

> **Audience:** Frontend engineers, mobile engineers, third-party integrators. Read alongside `docs/API_CONVENTIONS.md` (the platform-wide conventions: versioning, envelope, RFC 7807 errors, pagination, idempotency, rate limits) and the sibling docs in this folder.
>
> **Status:** M2 target architecture. All endpoints are under `/api/v1/*` and follow the M1 platform conventions (`apiHandler` wrapper, Zod validation, `success`/`created`/`paginated` response envelope, RFC 7807 `problem+json` errors via `toProblemJson`). The M1 foundation routes (`/api/v1/health`, `/api/v1/metrics`, `/api/v1/events`, `/api/v1/features`, `/api/v1/workers`, `/api/v1/packages`) are documented in `docs/API_CONVENTIONS.md` and are not repeated here.

---

## 0. Conventions

### 0.1 Base URL
- Production: `https://api.eks.food`
- Staging: `https://api.staging.eks.food`
- All identity endpoints are under `/api/v1/*`.

### 0.2 Authentication
All endpoints except `auth/register`, `auth/login`, `auth/magic-link`, `auth/magic-link/verify`, `auth/webauthn/login`, `auth/refresh`, `auth/reset-password/*`, `auth/verify-email`, `auth/resend-verification` require:
- A valid `__Host-eks.session` cookie (signed, HttpOnly, Secure, SameSite=Lax).
- For state-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`): an `X-CSRF-Token` header matching the `__Host-eks.csrf` cookie value.

Endpoints marked "Refreshable" also accept a fresh `__Host-eks.refresh` cookie to mint a new access token (returns a rotated `__Host-eks.session` + `__Host-eks.refresh`).

### 0.3 Standard response envelope
Success responses use the M1 `ApiResponse<T>` envelope (`src/packages/api/response.ts`):
```json
{ "data": <T>, "meta": { "requestId": "…" } }
```
Paginated responses add `meta.pagination` or `meta.cursor`.

### 0.4 Errors — RFC 7807 problem+json
All errors return `Content-Type: application/problem+json` and a body shape defined in `src/packages/errors/problem.ts`:
```json
{
  "type":      "https://docs.eks-food/errors/auth_invalid_credentials",
  "title":     "Auth Invalid Credentials",
  "status":    401,
  "detail":    "Email or password is incorrect.",
  "code":      "AUTH_INVALID_CREDENTIALS",
  "instance":  "/api/v1/auth/login",
  "traceId":   "abc123…",
  "timestamp": "2025-01-15T10:23:00Z",
  "details":   { /* optional, code-specific */ }
}
```

The IAM-specific error codes are in `ARCHITECTURE.md` §8.7. The platform-wide codes are in `docs/API_CONVENTIONS.md`.

### 0.5 Rate limiting
Every endpoint carries a rate limit (see `SECURITY_HARDENING.md` §5). Exceeding the limit returns `429` with `Retry-After` (seconds) and `code=RATE_LIMITED`.

### 0.6 Idempotency
`POST` endpoints accept an `Idempotency-Key` header (any string). If the same key is reused within 24 hours, the original response is returned (see `src/packages/api/idempotency.ts`).

### 0.7 Tenant scope column
Every endpoint below has a "Tenant scope" column with one of:
- **Caller's active tenant** — the request is scoped to the caller's `TenantContext` (set from the session's active membership). The handler does not accept an `organizationId` parameter.
- **Any tenant (SUPPORT/SUPER_ADMIN only)** — the caller may pass `?organizationId=` to target a different tenant. Cross-tenant access is audited as `AUTHZ_CROSS_TENANT_READ`.
- **Global** — the resource is not tenant-scoped (e.g. `Role`, `Permission` registry). Caller must have a global role.
- **N/A** — unauthenticated endpoint (registration, login, password reset).

---

## 1. Auth Endpoints

### 1.1 `POST /api/v1/auth/register` — Email/password registration

| | |
|---|---|
| **Auth required** | No (rate-limited per IP). |
| **Tenant scope** | N/A (defaults to caller's home org, or invitation org if `inviteToken` provided). |
| **Permission** | N/A. |
| **Idempotent** | Yes (24h, by `Idempotency-Key`). |

**Request body:**
```json
{
  "email": "amara@example.com",
  "password": "Tr0ub4dour&3-magnolia",
  "displayName": "Amara Mensah",
  "username": "amara",
  "inviteToken": "optional-invitation-token",
  "locale": "en",
  "timezone": "Africa/Accra"
}
```

**Response `201 Created`:**
```json
{
  "data": {
    "user": {
      "id": "user_abc123",
      "email": "amara@example.com",
      "displayName": "Amara Mensah",
      "status": "PENDING_ACTIVATION"
    },
    "verificationRequired": true
  }
}
```

**Errors:** `VALIDATION_FAILED` (422, weak password / bad email), `CONFLICT` (409, email already registered), `RATE_LIMITED` (429).

**Cookies set:** None (registration does not create a session — the user must verify email and log in).

---

### 1.2 `POST /api/v1/auth/login` — Login (with MFA challenge if enrolled)

| | |
|---|---|
| **Auth required** | No (rate-limited 20/min per IP). |
| **Tenant scope** | N/A. |
| **Permission** | N/A. |

**Request body:**
```json
{ "email": "amara@example.com", "password": "Tr0ub4dour&3-magnolia" }
```

**Response `200 OK` (no MFA enrolled, low risk):**
```json
{
  "data": {
    "user": {
      "id": "user_abc123",
      "email": "amara@example.com",
      "displayName": "Amara Mensah",
      "roles": ["manager"],
      "organizationId": "org_ghana"
    },
    "session": {
      "id": "sess_xyz",
      "expiresAt": "2025-01-15T14:45:00Z",
      "riskScore": 12,
      "riskFactors": []
    }
  }
}
```

**Response `401 AUTH_MFA_REQUIRED` (MFA enrolled):**
```json
{
  "type": "https://docs.eks-food/errors/auth_mfa_required",
  "title": "MFA Required",
  "status": 401,
  "detail": "Multi-factor authentication is required.",
  "code": "AUTH_MFA_REQUIRED",
  "instance": "/api/v1/auth/login",
  "traceId": "abc123…",
  "details": {
    "mfaChallengeId": "mfa_challenge_xyz",
    "allowedFactors": ["totp", "webauthn", "recovery_code"]
  }
}
```

**Errors:** `AUTH_INVALID_CREDENTIALS` (401), `AUTH_ACCOUNT_LOCKED` (423, `details.retryAfterSec`), `AUTH_DEVICE_UNTRUSTED` (401, risk ≥ 90), `AUTH_MFA_REQUIRED` (401), `AUTH_ACCOUNT_NOT_ACTIVATED` (401).

**Cookies set (on `200`):** `__Host-eks.session`, `__Host-eks.refresh`, `__Host-eks.csrf`.

---

### 1.3 `POST /api/v1/auth/logout` — Logout (revoke current session)

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A (any authenticated user). |

**Request body:** empty.

**Response `204 No Content`.**

**Cookies set:** All three cookies set with `Max-Age=0` (expire immediately).

---

### 1.4 `POST /api/v1/auth/refresh` — Refresh access token

| | |
|---|---|
| **Auth required** | `__Host-eks.refresh` cookie (no `session`). |
| **Tenant scope** | Caller's active tenant (encoded in the refresh token). |
| **Permission** | N/A. |
| **Rate-limited** | 60/min per IP. |

**Request body:** empty. The `X-CSRF-Token` header is **required**.

**Response `200 OK`:**
```json
{
  "data": {
    "session": {
      "id": "sess_xyz",
      "expiresAt": "2025-01-15T15:00:00Z",
      "riskScore": 18,
      "riskFactors": ["untrusted_device"]
    }
  }
}
```

**Errors:** `AUTH_INVALID_CREDENTIALS` (401, missing/invalid refresh cookie), `AUTH_SESSION_EXPIRED` (401), `AUTH_SESSION_REVOKED` (401, reuse detected → family revoked), `AUTH_DEVICE_UNTRUSTED` (401, risk ≥ 90).

**Cookies set:** Rotated `__Host-eks.session`, `__Host-eks.refresh`, `__Host-eks.csrf`.

---

### 1.5 `POST /api/v1/auth/magic-link` — Request magic-link login

| | |
|---|---|
| **Auth required** | No (rate-limited 5/min per email). |
| **Tenant scope** | N/A. |

**Request body:** `{ "email": "amara@example.com" }`

**Response `202 Accepted`:** (always — no information leak about whether the email exists)
```json
{ "data": { "sent": true } }
```

**Errors:** `RATE_LIMITED` (429), `VALIDATION_FAILED` (422, bad email).

---

### 1.6 `POST /api/v1/auth/magic-link/verify` — Verify magic-link token

| | |
|---|---|
| **Auth required** | No (rate-limited 10/min per IP). |
| **Tenant scope** | N/A. |

**Request body:** `{ "token": "…" }`

**Response `200 OK`:** Same shape as `auth/login` `200`.

**Errors:** `AUTH_INVALID_CREDENTIALS` (401, token missing/expired/used).

---

### 1.7 `POST /api/v1/auth/verify-email` — Verify email token

| | |
|---|---|
| **Auth required** | No. |
| **Tenant scope** | N/A. |

**Request body:** `{ "token": "…" }`

**Response `200 OK`:**
```json
{ "data": { "user": { "id": "user_abc123", "status": "ACTIVE" } } }
```

**Errors:** `AUTH_INVALID_CREDENTIALS` (401, token missing/expired/used).

---

### 1.8 `POST /api/v1/auth/resend-verification` — Resend verification email

| | |
|---|---|
| **Auth required** | No (rate-limited 3/hour per email). |
| **Tenant scope** | N/A. |

**Request body:** `{ "email": "amara@example.com" }`

**Response `202 Accepted`:** `{ "data": { "sent": true } }` (always).

---

### 1.9 `POST /api/v1/auth/reset-password/request` — Request password reset

| | |
|---|---|
| **Auth required** | No (rate-limited 3/hour per email). |
| **Tenant scope** | N/A. |

**Request body:** `{ "email": "amara@example.com" }`

**Response `202 Accepted`:** `{ "data": { "sent": true } }` (always — no information leak).

---

### 1.10 `POST /api/v1/auth/reset-password/confirm` — Reset password with token

| | |
|---|---|
| **Auth required** | No (rate-limited 5/hour per IP). |
| **Tenant scope** | N/A. |

**Request body:**
```json
{ "token": "…", "newPassword": "Tr0ub4dour&3-magnolia-new" }
```

**Response `204 No Content`.** All sessions for the user are revoked.

**Errors:** `AUTH_INVALID_CREDENTIALS` (401, token missing/expired), `VALIDATION_FAILED` (422, weak password).

---

### 1.11 `POST /api/v1/auth/change-password` — Change password (authenticated)

| | |
|---|---|
| **Auth required** | Yes + step-up MFA within the last 5 minutes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Request body:**
```json
{ "currentPassword": "Tr0ub4dour&3-magnolia", "newPassword": "Tr0ub4dour&3-magnolia-v2" }
```

**Response `204 No Content`.** All other sessions (not the current one) are revoked.

**Errors:** `AUTH_INVALID_CREDENTIALS` (401, wrong current password), `AUTH_MFA_REQUIRED` (401, step-up freshness expired), `BUSINESS_RULE` (422, `rule=password_reused`), `VALIDATION_FAILED` (422, weak new password).

---

### 1.12 `POST /api/v1/auth/webauthn/register` — Begin passkey enrolment

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Request body:** empty.

**Response `200 OK`:**
```json
{
  "data": {
    "options": {
      "rp": { "id": "eks.food", "name": "Eks-Food" },
      "user": { "id": "user_abc123", "name": "amara@example.com", "displayName": "Amara Mensah" },
      "challenge": "<base64url>",
      "pubKeyCredParams": [{ "alg": -7, "type": "public-key" }, { "alg": -257, "type": "public-key" }],
      "authenticatorSelection": { "userVerification": "preferred", "residentKey": "preferred" },
      "excludeCredentials": []
    }
  }
}
```

---

### 1.13 `POST /api/v1/auth/webauthn/register/verify` — Complete passkey enrolment

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |

**Request body:**
```json
{
  "credentialId": "<base64url>",
  "publicKey": "<base64url>",
  "attestationObject": "<base64url>",
  "clientDataJSON": "<base64url>",
  "signCount": 0,
  "transports": ["internal"],
  "name": "Amara's iPhone"
}
```

**Response `201 Created`:**
```json
{ "data": { "credentialId": "<base64url>", "name": "Amara's iPhone" } }
```

---

### 1.14 `POST /api/v1/auth/webauthn/login` — Begin passkey login

| | |
|---|---|
| **Auth required** | No. |
| **Tenant scope** | N/A. |

**Request body:** `{ "email": "amara@example.com" }` (optional — omit for discoverable credentials).

**Response `200 OK`:**
```json
{
  "data": {
    "assertionId": "assert_xyz",
    "options": {
      "challenge": "<base64url>",
      "rpId": "eks.food",
      "allowCredentials": [{ "type": "public-key", "id": "<base64url>" }],
      "userVerification": "preferred"
    }
  }
}
```

---

### 1.15 `POST /api/v1/auth/webauthn/login/verify` — Complete passkey login

| | |
|---|---|
| **Auth required** | No. |
| **Tenant scope** | N/A. |

**Request body:**
```json
{
  "assertionId": "assert_xyz",
  "credentialId": "<base64url>",
  "authenticatorData": "<base64url>",
  "signature": "<base64url>",
  "clientDataJSON": "<base64url>"
}
```

**Response `200 OK`:** Same shape as `auth/login` `200` (with `method: "webauthn"`).

**Errors:** `AUTH_DEVICE_UNTRUSTED` (401, sign-count regression — clone suspected).

---

### 1.16 `POST /api/v1/auth/switch-tenant` — Switch active tenant

| | |
|---|---|
| **Auth required** | Yes + step-up MFA if risk ≥ 70. |
| **Tenant scope** | Caller's active tenant → target tenant. |
| **Permission** | Active membership in the target org. |

**Request body:** `{ "organizationId": "org_ada" }`

**Response `200 OK`:**
```json
{ "data": { "organization": { "id": "org_ada", "name": "Ada Kitchens", "role": "member" } } }
```

**Errors:** `FORBIDDEN` (403, no active membership in target org), `BUSINESS_RULE` (422, target org not ACTIVE), `AUTH_MFA_REQUIRED` (401, risk ≥ 70).

---

## 2. Users Endpoints

### 2.1 `GET /api/v1/users/me` — Current user

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Response `200 OK`:**
```json
{
  "data": {
    "user": {
      "id": "user_abc123",
      "email": "amara@example.com",
      "displayName": "Amara Mensah",
      "username": "amara",
      "locale": "en",
      "timezone": "Africa/Accra",
      "avatarUrl": null,
      "status": "ACTIVE",
      "organizationId": "org_ghana",
      "activeRole": "manager",
      "mfaEnrolled": true,
      "verifiedAt": "2025-01-10T11:30:00Z",
      "createdAt": "2025-01-10T09:00:00Z"
    }
  }
}
```

---

### 2.2 `PATCH /api/v1/users/me` — Update current user

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Request body (any subset of fields):**
```json
{
  "displayName": "Amara K. Mensah",
  "phone": "+233244555666",
  "locale": "en",
  "timezone": "Africa/Accra",
  "avatarUrl": "https://images.eks.food/avatars/amara.png"
}
```

**Response `200 OK`:** Updated user (same shape as `users/me`).

**Errors:** `VALIDATION_FAILED` (422, bad phone format / unsupported locale).

---

### 2.3 `DELETE /api/v1/users/me` — Delete current user (right to erasure)

| | |
|---|---|
| **Auth required** | Yes + step-up MFA within the last 5 minutes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Request body:**
```json
{ "reason": "no_longer_needed", "confirm": "DELETE" }
```

**Response `202 Accepted`:**
```json
{ "data": { "scheduledForDeletionAt": "2025-01-29T10:23:00Z", "cooldownDays": 14 } }
```

The deletion is queued with a 14-day cool-down. The user can cancel via `POST /api/v1/users/me/delete/cancel` within the cool-down window.

---

### 2.4 `POST /api/v1/users/me/export` — Request data export

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Request body:** empty.

**Response `202 Accepted`:**
```json
{ "data": { "exportId": "export_xyz", "estimatedCompletionAt": "2025-01-15T14:00:00Z" } }
```

The export is emailed to the user within 30 days (GDPR deadline). The download link is valid for 7 days.

---

### 2.5 `GET /api/v1/users` — List users (admin)

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant, or any tenant (SUPPORT/SUPER_ADMIN with `?organizationId=`). |
| **Permission** | `user.read`. |

**Query params:** `?status=ACTIVE&roleSlug=manager&q=amara&limit=50&cursor=…`

**Response `200 OK`:**
```json
{
  "data": [
    { "id": "user_abc123", "email": "amara@example.com", "displayName": "Amara Mensah", "status": "ACTIVE", "roles": ["manager"], "createdAt": "2025-01-10T09:00:00Z" }
  ],
  "meta": { "cursor": { "limit": 50, "nextCursor": "eyJpZCI6…", "hasMore": true } }
}
```

---

### 2.6 `GET /api/v1/users/{id}` — Get user (admin)

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant, or any tenant (SUPPORT/SUPER_ADMIN). |
| **Permission** | `user.read`. |

**Response `200 OK`:** Same shape as `users/me`, plus `memberships`, `lastLoginAt`, `mfaEnrolled`, `verificationStatus`.

---

## 3. Organizations Endpoints

### 3.1 `POST /api/v1/organizations` — Create organization

| | |
|---|---|
| **Auth required** | Yes (becomes the owner). |
| **Tenant scope** | N/A (creates a new tenant). |
| **Permission** | N/A. |

**Request body:**
```json
{
  "name": "Eks-Food Ghana",
  "slug": "eks-food-ghana",
  "type": "restaurant",
  "country": "GH",
  "baseCurrency": "GHS",
  "defaultLocale": "en",
  "timezone": "Africa/Accra",
  "plan": "eks.starter"
}
```

**Response `201 Created`:**
```json
{
  "data": {
    "organization": { "id": "org_ghana", "name": "Eks-Food Ghana", "slug": "eks-food-ghana", "status": "PENDING_VERIFICATION" },
    "membership": { "id": "mem_xyz", "roleSlug": "owner", "status": "ACTIVE" }
  }
}
```

---

### 3.2 `GET /api/v1/organizations/{id}` — Get organization

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant (or any tenant with `user.read.any`). |
| **Permission** | `org.read`. |

**Response `200 OK`:** Full organization object including `tenantConfiguration`, `entitlements`, `featureFlags`.

---

### 3.3 `PATCH /api/v1/organizations/{id}` — Update organization

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `org.config.write` (admin/owner). |

**Request body (any subset):**
```json
{
  "displayName": "Eks-Food Ghana Ltd",
  "defaultLocale": "en",
  "timezone": "Africa/Accra"
}
```

**Response `200 OK`:** Updated organization.

---

### 3.4 `DELETE /api/v1/organizations/{id}` — Terminate organization

| | |
|---|---|
| **Auth required** | Yes + step-up MFA within 5 min. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `org.delete` (owner or SUPER_ADMIN). |

**Request body:** `{ "confirm": "<org slug>" }`

**Response `202 Accepted`:**
```json
{ "data": { "terminationScheduledAt": "2025-02-14T00:00:00Z", "retentionDays": 30 } }
```

The org enters TERMINATED status; data is hard-deleted after 30 days.

---

### 3.5 `GET /api/v1/organizations/types` — List organization types

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Global. |
| **Permission** | N/A. |

**Response `200 OK`:**
```json
{
  "data": [
    { "code": "household", "displayName": "Household", "requiresVerification": false },
    { "code": "restaurant", "displayName": "Restaurant", "requiresVerification": true },
    { "code": "vendor", "displayName": "Vendor / Stall", "requiresVerification": true },
    { "code": "supplier", "displayName": "Supplier", "requiresVerification": true },
    { "code": "catering", "displayName": "Catering Company", "requiresVerification": true },
    { "code": "franchise", "displayName": "Franchise", "requiresVerification": true },
    { "code": "inspection_agency", "displayName": "Inspection Agency", "requiresVerification": true },
    { "code": "logistics", "displayName": "Logistics Provider", "requiresVerification": true },
    { "code": "enterprise", "displayName": "Enterprise", "requiresVerification": true }
  ]
}
```

---

### 3.6 `POST /api/v1/organizations/{id}/transfer-ownership` — Transfer ownership

| | |
|---|---|
| **Auth required** | Yes + step-up MFA within 5 min. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `org.transfer_ownership` (current owner or SUPER_ADMIN). |

**Request body:** `{ "newOwnerId": "user_def456" }`

**Response `200 OK`:** Updated organization with new `ownerId`. Both users' sessions are revoked.

---

## 4. Memberships Endpoints

### 4.1 `GET /api/v1/memberships` — List memberships

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant, or any tenant (SUPPORT/SUPER_ADMIN). |
| **Permission** | `org.read` (own tenant) or `user.read.any` (cross-tenant). |

**Query params:** `?userId=…&roleSlug=…&status=ACTIVE&teamId=…&limit=50&cursor=…`

**Response `200 OK`:** Paginated list of `{ id, userId, organizationId, roleSlug, teamId, status, invitedAt, activatedAt }`.

---

### 4.2 `POST /api/v1/memberships` — Add membership directly (admin)

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `org.member.role.change` (admin/owner). |

**Request body:**
```json
{ "userId": "user_def456", "roleSlug": "manager", "teamId": "team_el_cooks" }
```

**Response `201 Created`:**
```json
{ "data": { "id": "mem_xyz", "userId": "user_def456", "organizationId": "org_ghana", "roleSlug": "manager", "status": "ACTIVE", "activatedAt": "2025-01-15T10:23:00Z" } }
```

**Errors:** `FORBIDDEN` (403, granter's permissions don't superset the new role's), `BUSINESS_RULE` (422, target user not ACTIVE).

---

### 4.3 `DELETE /api/v1/memberships/{id}` — Revoke membership

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `org.member.remove` (manager/admin/owner) or self (user revokes their own). |

**Response `204 No Content`.** The user's sessions in this org are revoked.

---

### 4.4 `PATCH /api/v1/memberships/{id}` — Change role

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `org.member.role.change` (admin/owner). |

**Request body:** `{ "roleSlug": "admin" }`

**Response `200 OK`:** Updated membership. The user's sessions are revoked (force re-auth with new roles).

**Errors:** `FORBIDDEN` (403, granter's permissions don't superset the new role's).

---

### 4.5 `GET /api/v1/memberships/{id}/history` — Membership audit history

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `audit.read` (manager/admin/owner). |

**Response `200 OK`:**
```json
{
  "data": [
    { "at": "2025-01-10T09:00:00Z", "action": "MEMBERSHIP_INVITED", "actor": "user_kofi", "detail": "Invited as manager" },
    { "at": "2025-01-10T11:30:00Z", "action": "MEMBERSHIP_ACCEPTED", "actor": "user_amara", "detail": "Accepted invitation" }
  ]
}
```

---

## 5. Invitations Endpoints

### 5.1 `POST /api/v1/invitations` — Create invitation

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `org.member.invite` (manager/admin/owner). |

**Request body:**
```json
{
  "email": "kwame@example.com",
  "roleSlug": "member",
  "teamId": "team_el_cooks",
  "expiresInHours": 168
}
```

**Response `201 Created`:**
```json
{ "data": { "id": "inv_xyz", "email": "kwame@example.com", "roleSlug": "member", "status": "PENDING", "expiresAt": "2025-01-22T10:23:00Z" } }
```

**Errors:** `FORBIDDEN` (403, inviter's permissions don't superset `roleSlug`), `VALIDATION_FAILED` (422, bad email / `expiresInHours` > 720).

---

### 5.2 `POST /api/v1/invitations/bulk` — Bulk invitations

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `org.member.invite` (manager/admin/owner). |
| **Rate-limited** | 5/hour per user. |

**Request body:**
```json
{
  "invitations": [
    { "email": "kwame@example.com", "roleSlug": "member", "teamId": "team_el_cooks" },
    { "email": "tunde@example.com", "roleSlug": "member" }
  ]
}
```

**Response `201 Created`:**
```json
{ "data": { "batchId": "batch_xyz", "count": 2, "invitations": [ { "id": "inv_1", … }, { "id": "inv_2", … } ] } }
```

---

### 5.3 `GET /api/v1/invitations` — List invitations

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `org.read` (manager/admin/owner). |

**Query params:** `?status=PENDING&batchId=…&limit=50&cursor=…`

**Response `200 OK`:** Paginated list.

---

### 5.4 `GET /api/v1/invitations/resolve` — Resolve invitation by token (unauthenticated)

| | |
|---|---|
| **Auth required** | No. |
| **Tenant scope** | N/A. |

**Query params:** `?token=…`

**Response `200 OK`:**
```json
{
  "data": {
    "invitation": { "id": "inv_xyz", "organization": { "id": "org_ghana", "name": "Eks-Food Ghana" }, "roleSlug": "member", "expiresAt": "2025-01-22T10:23:00Z" },
    "recipientStatus": "existing_user" | "new_user"
  }
}
```

**Errors:** `INVITATION_EXPIRED` (410), `INVITATION_REVOKED` (410).

---

### 5.5 `POST /api/v1/invitations/{id}/accept` — Accept invitation

| | |
|---|---|
| **Auth required** | Yes (as the invited user — must match `invitedUserId` or registered email). |
| **Tenant scope** | N/A. |
| **Permission** | N/A. |

**Response `200 OK`:**
```json
{ "data": { "membership": { "id": "mem_xyz", "organizationId": "org_ghana", "roleSlug": "member", "status": "ACTIVE" } } }
```

**Errors:** `INVITATION_EXPIRED` (410), `INVITATION_REVOKED` (410), `FORBIDDEN` (403, authenticated user does not match invited email).

---

### 5.6 `DELETE /api/v1/invitations/{id}` — Revoke invitation

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | `org.member.invite` (manager/admin/owner). |

**Response `204 No Content`.**

---

## 6. Roles & Permissions Endpoints

### 6.1 `GET /api/v1/roles` — List roles

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Global + caller's active tenant. |
| **Permission** | `role.read`. |

**Response `200 OK`:**
```json
{
  "data": [
    { "id": "role_global_super_admin", "slug": "super_admin", "displayName": "Super Admin", "scope": "global", "system": true, "permissionCodes": ["*"] },
    { "id": "role_global_support",     "slug": "support",     "displayName": "Support",     "scope": "global", "system": true, "permissionCodes": ["user.read", "booking.read", "session.revoke", "audit.read"] },
    { "id": "role_ghana_owner",        "slug": "owner",       "displayName": "Owner",       "scope": "organization", "organizationId": "org_ghana", "system": true, "permissionCodes": ["booking.read", "booking.assign", "org.delete", "org.transfer_ownership", …] },
    { "id": "role_ghana_manager",      "slug": "manager",     "displayName": "Manager",     "scope": "organization", "organizationId": "org_ghana", "system": true, "permissionCodes": ["booking.read", "booking.assign", "cook.manage", …] },
    { "id": "role_ghana_team_lead",    "slug": "team_lead",   "displayName": "Team Lead",   "scope": "team", "organizationId": "org_ghana", "teamId": "team_el_cooks", "system": false, "permissionCodes": ["booking.assign"] }
  ]
}
```

---

### 6.2 `GET /api/v1/permissions` — List permissions

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Global. |
| **Permission** | `role.read`. |

**Response `200 OK`:** Full permission registry (see `AUTHORIZATION_POLICIES.md` §3).

---

### 6.3 `GET /api/v1/roles/{id}/permissions` — Get role's permissions

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant (for org-scoped roles) or global. |
| **Permission** | `role.read`. |

**Response `200 OK`:**
```json
{ "data": { "role": { "id": "role_ghana_manager", "slug": "manager" }, "permissions": [ { "code": "booking.read", "description": "View bookings" }, … ] } }
```

---

## 7. Sessions Endpoints

### 7.1 `GET /api/v1/sessions` — List current user's sessions

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "sess_xyz",
      "current": true,
      "device": { "id": "dev_1", "name": "Amara's MacBook", "platform": "macOS", "browser": "Chrome", "trusted": true },
      "ipCountry": "Ghana",
      "ipRegion": "Greater Accra",
      "lastSeenAt": "2025-01-15T14:30:00Z",
      "issuedAt": "2025-01-15T14:30:00Z",
      "riskScore": 12,
      "method": "password"
    }
  ]
}
```

---

### 7.2 `DELETE /api/v1/sessions/{id}` — Revoke a session

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A (own session) or `session.revoke.any` (SUPPORT/SUPER_ADMIN). |

**Response `204 No Content`.**

---

### 7.3 `POST /api/v1/sessions/revoke-all` — Revoke all sessions

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Response `204 No Content`.** All sessions (including the current one) are revoked; the SPA must re-authenticate.

---

### 7.4 `POST /api/v1/sessions/devices/{id}/trust` — Mark device trusted

| | |
|---|---|
| **Auth required** | Yes + step-up MFA. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Response `200 OK`:** `{ "data": { "device": { "id": "dev_1", "trusted": true, "trustedUntil": "2025-04-15T14:30:00Z" } } }`

---

## 8. MFA Endpoints

### 8.1 `POST /api/v1/mfa/enroll-totp` — Begin TOTP enrolment

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |
| **Rate-limited** | 3/hour per user. |

**Request body:** empty.

**Response `200 OK`:**
```json
{
  "data": {
    "secret": "JBSWY3DPEHPK3PXP",
    "otpauthUrl": "otpauth://totp/Eks-Food:amara@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Eks-Food&algorithm=SHA1&digits=6&period=30",
    "qrDataUrl": "data:image/png;base64,…"
  }
}
```

---

### 8.2 `POST /api/v1/mfa/enroll-totp/verify` — Complete TOTP enrolment

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant. |

**Request body:** `{ "code": "123456" }`

**Response `200 OK`:**
```json
{
  "data": {
    "mfaEnrolled": true,
    "recoveryCodes": ["ABCD-EFGH-IJKL-MNOP", "QRST-UVWX-YZAB-CDEF", …]
  }
}
```

**Errors:** `MFA_ALREADY_ENROLLED` (409), `AUTH_MFA_INVALID_CODE` (401).

---

### 8.3 `POST /api/v1/mfa/verify` — Verify MFA (login step-up)

| | |
|---|---|
| **Auth required** | `mfaChallengeId` (from `auth/login` `401` or from a step-up demand). |
| **Tenant scope** | N/A. |
| **Rate-limited** | 10/min per session. |

**Request body:**
```json
{
  "mfaChallengeId": "mfa_challenge_xyz",
  "factor": "totp" | "webauthn" | "recovery_code" | "email" | "sms",
  "code": "123456"
}
```

(For `webauthn`, the body includes `credentialId`, `authenticatorData`, `signature`, `clientDataJSON` instead of `code`.)

**Response `200 OK`:** Same shape as `auth/login` `200` (session created).

**Errors:** `AUTH_MFA_INVALID_CODE` (401), `AUTH_MFA_REQUIRED` (401, challenge expired — 5 min TTL).

---

### 8.4 `POST /api/v1/mfa/disable` — Disable MFA

| | |
|---|---|
| **Auth required** | Yes + step-up MFA within 5 min. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Request body:** `{ "confirm": "DISABLE" }`

**Response `204 No Content`.** MFA is disabled after a 24-hour cooldown (the TOTP secret is scrubbed at that point).

---

### 8.5 `GET /api/v1/mfa/recovery-codes` — List recovery code metadata

| | |
|---|---|
| **Auth required** | Yes + step-up MFA within 5 min. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Response `200 OK`:**
```json
{ "data": { "total": 10, "used": 3, "remaining": 7, "lastRegeneratedAt": "2025-01-10T11:30:00Z" } }
```

(The plaintext codes are NOT returned — they were shown once at generation time.)

---

### 8.6 `POST /api/v1/mfa/recovery-codes/regenerate` — Regenerate recovery codes

| | |
|---|---|
| **Auth required** | Yes + step-up MFA within 5 min. |
| **Tenant scope** | Caller's active tenant. |
| **Permission** | N/A. |

**Request body:** empty.

**Response `200 OK`:**
```json
{ "data": { "recoveryCodes": ["ABCD-EFGH-IJKL-MNOP", …] } }
```

The old codes are invalidated. The new codes are shown once.

---

## 9. Audit Endpoints

### 9.1 `GET /api/v1/audit` — Query audit log

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant, or any tenant (SUPPORT/SUPER_ADMIN). |
| **Permission** | `audit.read` (manager/admin/owner) or `audit.read.any` (cross-tenant). |
| **Rate-limited** | 60/min per user. |

**Query params:** `?action=AUTH_*&actorUserId=…&entityType=…&entityId=…&from=2025-01-01&to=2025-01-31&limit=100&cursor=…`

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "audit_xyz",
      "action": "AUTH_LOGIN",
      "actorUserId": "user_abc123",
      "entityType": "Session",
      "entityId": "sess_xyz",
      "metadata": { "method": "password", "riskScore": 12 },
      "ipAddress": "abc123…",
      "createdAt": "2025-01-15T14:30:00Z"
    }
  ],
  "meta": { "cursor": { "limit": 100, "nextCursor": "…", "hasMore": true } }
}
```

---

### 9.2 `POST /api/v1/audit/export` — Export audit log

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant, or any tenant (SUPPORT/SUPER_ADMIN). |
| **Permission** | `audit.export` (admin/owner) or `audit.read.any` (cross-tenant). |
| **Rate-limited** | 3/hour per user. |

**Request body:**
```json
{
  "action": "AUTH_*",
  "from": "2025-01-01",
  "to": "2025-01-31",
  "format": "csv" | "json" | "pdf"
}
```

**Response `202 Accepted`:**
```json
{ "data": { "exportId": "audit_export_xyz", "estimatedCompletionAt": "2025-01-15T15:00:00Z" } }
```

The export is emailed to the caller with a 7-day-valid download link.

---

## 10. WebAuthn Endpoints

(WebAuthn registration/login endpoints are documented in §1.12–§1.15 above.)

---

## 11. Admin Endpoints (SUPPORT / SUPER_ADMIN only)

### 11.1 `POST /api/v1/admin/users/{id}/impersonate` — Impersonate user

| | |
|---|---|
| **Auth required** | Yes + step-up MFA within 5 min. |
| **Tenant scope** | N/A (creates a session in the target user's home tenant). |
| **Permission** | `auth.impersonate` (SUPER_ADMIN; SUPPORT for non-privileged targets with second-approver SUPER_ADMIN). |
| **Rate-limited** | 10/hour per SUPPORT user. |

**Request body:** `{ "reason": "customer_support_ticket_12345" }`

**Response `200 OK`:** New session cookies for the impersonated user. The UI displays the impersonation banner.

---

### 11.2 `POST /api/v1/admin/users/{id}/sessions/revoke-all` — Revoke all sessions (admin)

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant, or any tenant (SUPPORT/SUPER_ADMIN). |
| **Permission** | `session.revoke.any`. |

**Response `204 No Content`.** Every active session for the target user is revoked.

---

### 11.3 `POST /api/v1/admin/users/{id}/mfa-reset` — Admin-initiated MFA reset

| | |
|---|---|
| **Auth required** | Yes + step-up MFA within 5 min + second-approver SUPER_ADMIN. |
| **Tenant scope** | Caller's active tenant, or any tenant (SUPPORT/SUPER_ADMIN). |
| **Permission** | `mfa.reset` (SUPPORT) + approver SUPER_ADMIN. |

**Request body:** `{ "reason": "user lost device", "approverUserId": "user_super_1" }`

**Response `202 Accepted`:**
```json
{ "data": { "resetPending": true, "resetLinkSentTo": "amara@example.com", "expiresAt": "2025-01-16T10:23:00Z" } }
```

The recovery link is emailed to the user's verified email; the user has 24 hours to click it and re-set up MFA.

---

### 11.4 `POST /api/v1/admin/users/{id}/unlock` — Unlock account (admin)

| | |
|---|---|
| **Auth required** | Yes. |
| **Tenant scope** | Caller's active tenant, or any tenant (SUPPORT/SUPER_ADMIN). |
| **Permission** | `user.update` (SUPPORT/SUPER_ADMIN). |

**Response `204 No Content`.** The `Identity.failedAttempts` counter is reset; `lockedUntil` is cleared.

---

## 12. Error Code Quick Reference

| Code | HTTP | Meaning |
|---|:---:|---|
| `VALIDATION_FAILED` | 422 | Zod validation failed; `details.fields` lists path/message. |
| `UNAUTHORIZED` | 401 | No session / expired session. |
| `AUTH_INVALID_CREDENTIALS` | 401 | Wrong password / expired token / unknown user (same code on purpose). |
| `AUTH_ACCOUNT_LOCKED` | 423 | Progressive lockout engaged; `details.retryAfterSec`. |
| `AUTH_ACCOUNT_NOT_ACTIVATED` | 401 | Email not verified. |
| `AUTH_MFA_REQUIRED` | 401 | MFA step-up demanded; `details.mfaChallengeId`. |
| `AUTH_MFA_INVALID_CODE` | 401 | Wrong TOTP / OTP / recovery code. |
| `AUTH_SESSION_EXPIRED` | 401 | Refresh-token TTL elapsed. |
| `AUTH_SESSION_REVOKED` | 401 | Refresh-token reuse detected / admin revoke. |
| `AUTH_DEVICE_UNTRUSTED` | 401 | Risk score ≥ 90. |
| `FORBIDDEN` | 403 | RBAC layer denied. |
| `AUTHZ_PERMISSION_DENIED` | 403 | Permission not granted. |
| `AUTHZ_ABAC_DENIED` | 403 | ABAC condition failed; `details.reason` + `details.rule`. |
| `AUTHZ_SCOPE_MISMATCH` | 403 | Resource tenant ≠ actor tenant. |
| `NOT_FOUND` | 404 | Resource does not exist. |
| `CONFLICT` | 409 | Email already registered / duplicate. |
| `MFA_ALREADY_ENROLLED` | 409 | User tried to enrol TOTP twice. |
| `BUSINESS_RULE` | 422 | E.g. `password_reused`, `org_not_active`. |
| `INVITATION_EXPIRED` | 410 | Invitation TTL elapsed. |
| `INVITATION_REVOKED` | 410 | Invitation was revoked or already accepted. |
| `RATE_LIMITED` | 429 | Rate limit exceeded; `Retry-After` header. |
| `INTERNAL` | 500 | Unexpected error; traceId for support. |

---

## 13. Cross-References

| Topic | Document |
|---|---|
| Platform-wide API conventions (envelope, pagination, idempotency) | `docs/API_CONVENTIONS.md` |
| Authentication flows behind each endpoint | `AUTHENTICATION_FLOWS.md` |
| Authorization policies behind each `Permission` | `AUTHORIZATION_POLICIES.md` |
| Tenant scope mechanics | `MULTI_TENANCY.md` |
| MFA flows behind each MFA endpoint | `MFA.md` |
| Audit log entries behind each `action` | `AUDIT_AND_COMPLIANCE.md` |
| Security headers, rate limits, CSRF | `SECURITY_HARDENING.md` |
