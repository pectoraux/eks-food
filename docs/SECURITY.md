# Eks-Food — Security

> **Audience:** Every engineer, the security team, and external researchers reading our disclosure policy. Read alongside `API_CONVENTIONS.md` (HTTP security), `PAYMENTS.md` (PCI scope), and `OPERATIONS_RUNBOOK.md` (incident response).
>
> **Status:** Milestone 1 ships a session foundation (header-based demo principal resolution) for end-to-end RBAC verification. **Authentication is deferred to Milestone 2** (NextAuth + signed JWT). All controls described here either ship in M1 or are explicitly marked `(M2)` / `(M3)`.

---

## 1. Threat Model Summary

Eks-Food is a multi-tenant, multi-region, AI-native platform that handles:
- **Personally identifiable information (PII)** — customer names, addresses, phone numbers, dietary preferences.
- **Payment references** — Payswap customer IDs, payment intent IDs, transfer IDs. **No card data, no mobile-money PINs.**
- **Business intelligence** — demand signals, earnings, payout history.
- **AI prompts and responses** — potentially containing user-supplied PII.

The assets we protect, in priority order:
1. **Payment integrity** — no unauthorised money movement, no double-charges, no missing payouts.
2. **Tenant isolation** — no cross-tenant data leakage.
3. **PII confidentiality** — customer and cook personal data.
4. **Availability** — the platform stays up for cooks and customers who depend on it.
5. **Audit integrity** — the audit trail is tamper-evident and complete.

The adversaries we consider:
- **External attackers** — credential stuffing, injection, supply-chain.
- **Malicious insiders** — a tenant admin attempting to read another tenant's data.
- **Compromised dependencies** — a rogue npm package.
- **Misconfigured AI** — prompt injection leaking data across tenants.

---

## 2. OWASP Top 10 (2021) — Mapping to Eks-Food Controls

| OWASP Risk | Eks-Food Control | Status |
|---|---|---|
| **A01 — Broken Access Control** | RBAC permission matrix in `@eks/auth` (`PERMISSIONS` map, single source of truth). Every route handler calls `authorize(principal, perm)`. Tenant isolation enforced by repository base class injecting `organizationId` into every query. (M2) Postgres row-level security as defence-in-depth. | M1 (RBAC + tenant filter); M2 (RLS) |
| **A02 — Cryptographic Failures** | TLS 1.3 everywhere (Caddy enforces). JWT signed with HS256 (M2) with quarterly-rotated secret. Payswap webhook signatures verified with HMAC-SHA256 in constant time. PII encrypted at rest via Postgres TDE (M3) and at S3 SSE-K2 for backups. Passwords (M2) hashed with Argon2id. | M1 (TLS, webhook sig); M2 (JWT, passwords); M3 (TDE) |
| **A03 — Injection** | No raw SQL — Prisma parameterises every query. No `eval` or `Function()` in codebase. No `dangerouslySetInnerHTML` in React without sanitisation. AI prompts are sandboxed; tool calls are explicitly whitelisted. Zod validates every inbound payload at the route boundary. | M1 |
| **A04 — Insecure Design** | Hexagonal layering prevents logic escaping its bounded context. `Result<T,E>` forces explicit error handling. Outbox pattern prevents dual-write inconsistencies. Threat modelling per bounded context (M2). | M1 |
| **A05 — Security Misconfiguration** | Security headers set by Caddy + Next.js middleware (§3). `EKS_ENVIRONMENT=production` flips strict mode (JWT required, demo-principal disabled). No default credentials. `X-Powered-By` stripped. Error responses leak no internals (problem+json, no stack traces). | M1 |
| **A06 — Vulnerable & Outdated Components** | `bun install --frozen-lockfile` in CI. Dependabot/Renovate opens PRs weekly. `bun audit` runs in CI; new high-severity CVEs block merge. SBOM generated per release (M2). | M1 (lockfile, audit); M2 (SBOM) |
| **A07 — Identification & Auth Failures** | (M2) NextAuth session with secure, HttpOnly, SameSite=Lax cookies. Session rotation on privilege change. Account lockout after 5 failed attempts. MFA for admin roles. M1 uses demo-principal headers — explicitly disabled when `EKS_AUTH_MODE=jwt`. | M1 (demo, sandbox only); M2 (full) |
| **A08 — Software & Data Integrity Failures** | Bun lockfile committed and verified. Container images signed with cosign (M2). Outbox events schema-validated on consumption. Webhook signatures verified. CI/CD pipeline runs on immutable, signed runners. | M1 (lockfile, webhook, schema); M2 (cosign) |
| **A09 — Security Logging & Monitoring Failures** | `@eks/audit` writes an append-only `AuditLog` row for every state-changing action. Logs are structured JSON with `requestId`/`correlationId`. SIEM ingests via OTel collector. Alerts on suspicious patterns (§6). Audit log retention `EKS_AUDIT_LOG_RETENTION_DAYS` (default 365). | M1 |
| **A10 — Server-Side Request Forgery** | No outbound HTTP from user-controlled URLs. AI assistant tool calls hit a fixed allowlist of internal endpoints. Image uploads (M3) go through a size+type-validated proxy, not direct fetch. Payswap base URL is env-configured, not user-configurable. | M1 |

---

## 3. Security Headers

Set by Caddy (edge) and reinforced by Next.js middleware. Every response carries:

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Force HTTPS for 2 years; HSTS preload list eligible |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-sniffing XSS |
| `X-Frame-Options` | `DENY` | Prevent clickjacking (we don't allow framing) |
| `Content-Security-Policy` | (see §3.1) | Restrict resource origins |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Don't leak full URL in Referer to third parties |
| `Permissions-Policy` | `geolocation=(self), camera=(), microphone=(), payment=(self)` | Allow only the browser features we use |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolate browsing context |
| `Cross-Origin-Resource-Policy` | `same-origin` | Restrict resource loading |
| `Cache-Control` | `no-store` on authenticated; `public, max-age=300` on static | Prevent caching of PII |
| `X-Powered-By` | (stripped) | Don't advertise stack |

### 3.1 Content-Security-Policy

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://images.eks.food;
font-src 'self' https://fonts.eks.food;
connect-src 'self' https://api.eks.food https://api.payswap.com wss://realtime.eks.food;
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests;
report-uri https://csp-reports.eks.food;
```

- `'unsafe-inline'` for scripts/styles is required by Next.js's inline runtime; we mitigate with strict `connect-src` and `default-src 'self'`. (M2: move to nonce-based CSP with Next.js 16 nonces.)
- `frame-ancestors 'none'` enforces `X-Frame-Options: DENY` in modern browsers.
- `report-uri` collects violations for monitoring.

### 3.2 CORS

See `API_CONVENTIONS.md` §12. Allowed origins are tenant-branded subdomains (`*.eks.food`). Credentials are allowed for the cookie-based session (M2). Preflight cached 10 minutes.

---

## 4. Input Validation

### 4.1 The rule

Every inbound payload — request body, query string, path param, header value — is validated by a **Zod schema** at the route boundary. Unknown fields are rejected (`z.object({...}).strict()`). No business logic runs on unvalidated input.

```ts
const CreateBookingSchema = z.object({
  serviceCode: z.string().min(1).max(64),
  bookingType: z.enum(["IMMEDIATE", "SCHEDULED", "RECURRING", "EVENT", "CORPORATE", "SUBSCRIPTION"]),
  scheduledFor: z.string().datetime(),
  durationMins: z.number().int().min(30).max(600),
  partySize: z.number().int().min(1).max(200),
  addressLine1: z.string().min(3).max(200),
  city: z.string().min(1).max(100),
  region: z.string().min(1).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  notes: z.string().max(2000).optional(),
  cuisines: z.array(z.string().min(1).max(64)).max(20).optional(),
  languages: z.array(z.string().min(2).max(8)).max(10).optional(),
  autoAssign: z.boolean().default(true),
  customerName: z.string().min(1).max(200).optional(),
  customerEmail: z.string().email().optional(),
}).strict();
```

### 4.2 Length & size limits

- Every string field has an explicit `max()`. Unbounded strings are a DoS vector.
- Request body size capped at 1 MB at the Caddy layer (`request_body { max_size 1MB }`). Larger payloads (file uploads, M3) use a separate presigned-URL flow.
- URL length capped at 8 KB.
- Number fields use `z.number().finite()` to reject `NaN`/`Infinity`.
- Date fields use `z.string().datetime()` (ISO 8601 UTC).

### 4.3 AI prompt validation

AI assistant prompts are validated:
- Max prompt length 4000 chars.
- No raw SQL, no shell-like syntax (defence in depth; the AI itself won't execute these, but logs should be clean).
- Tenant context injected server-side; the user cannot override it.

---

## 5. Rate Limiting

See `API_CONVENTIONS.md` §9 for the full spec. Security-relevant points:

- **Per-IP anonymous limit** (60 req/hour) prevents credential-stuffing and enumeration.
- **Per-principal authenticated limit** scales by role; AI assistant has the strictest limit to control LLM cost abuse.
- **Per-tenant aggregate limit** (M2) prevents one tenant's compromised credential from starving the platform.
- **Login endpoint** (M2) has a stricter limit (5 attempts / 5 minutes / IP+username) and account lockout after 5 failures.
- **Payswap webhook endpoint** is exempt from rate limiting (verified by HMAC signature, not by request rate).

Rate-limit counters are in Redis; a Redis outage degrades to "allow all" with an alert — we prefer availability over blocking during a Redis failure. (M2: add a local in-memory fallback limiter.)

---

## 6. Secrets Management

### 6.1 What's a secret

- Database password (`DATABASE_URL` password component)
- `EKS_JWT_SECRET`
- `EKS_PAYSWAP_API_KEY`, `EKS_PAYSWAP_WEBHOOK_SECRET`
- Redis password (in `EKS_REDIS_URL`)
- Third-party API keys (SMS, email, AI provider)
- TLS private keys

### 6.2 Where secrets live

| Environment | Storage |
|---|---|
| Sandbox | `.env.local` (gitignored) |
| Staging | AWS Secrets Manager, injected at boot via init sidecar |
| Production | AWS Secrets Manager with KMS-encrypted secrets, injected at boot; rotate quarterly |

### 6.3 What we never do

- **NEVER** commit a secret to git. `.env*` is gitignored; pre-commit hook scans for high-entropy strings.
- **NEVER** log a secret. The structured logger redacts known secret fields (`Authorization`, `Set-Cookie`, `password`, `secret`, `*Key`, `*Token`).
- **NEVER** put a secret in a URL (URLs land in access logs). Use headers.
- **NEVER** bake a secret into a Docker image. Images are scanned in CI for secrets (Trivy).
- **NEVER** share a secret in Slack, email, or a PR description. Use the secrets manager's access-grant feature.

### 6.4 Rotation

- `EKS_JWT_SECRET` — quarterly. The auth service supports a 24h grace window where both the current and previous secret are accepted, so rotation is zero-downtime.
- `EKS_PAYSWAP_API_KEY` — quarterly, or immediately if a team member with access leaves.
- `EKS_PAYSWAP_WEBHOOK_SECRET` — quarterly, coordinated with Payswap (both sides must rotate together).
- Database password — every 6 months, or on staff turnover.

### 6.5 Leak response

If a secret is suspected leaked:

1. **Rotate immediately.** Don't wait for confirmation; the cost of rotation is low, the cost of a leaked secret is high.
2. **Audit access logs** for the affected window. Identify any unauthorised use.
3. **Revoke active sessions** if `EKS_JWT_SECRET` was leaked (every user must re-authenticate).
4. **Notify security@** and open a Sev-1 incident (see `OPERATIONS_RUNBOOK.md` §9).
5. **Post-mortem** within 5 business days.

---

## 7. Audit Trail

### 7.1 What we audit

Every state-changing action writes an `AuditLog` row:

| Field | Example |
|---|---|
| `organizationId` | `cm9k8j2...` |
| `actorUserId` | `cm9k8j2...` (null for demo/system) |
| `action` | `BOOKING_CREATED`, `PAYMENT_CONFIRMED`, `FLAG_TOGGLED`, `ADMIN_CONFIG_UPDATED` |
| `entityType` | `Booking`, `PayswapPayment`, `FeatureFlag` |
| `entityId` | `cm9k8j2...` or `EKS-6GKD02` |
| `metadata` | JSON: `{ code, quotedPrice, fromStatus, toStatus, ... }` |
| `ipAddress` | The request's IP |
| `createdAt` | Timestamp |

### 7.2 Audit rules

- **Append-only.** No `UPDATE` or `DELETE` on `AuditLog`. Enforced at the Prisma layer (no `update`/`delete` methods exposed on `AuditRepository`) and (M3) at Postgres via `REVOKE UPDATE, DELETE`.
- **PII redaction.** `EKS_AUDIT_PII_REDACT=true` (default) scrubs known-PII fields from `metadata` before persistence. The redactor is configurable per `action` type.
- **Tamper-evidence (M3).** Each audit row carries an `prevHash` and `hash` forming a hash chain. A background job detects tampering hourly.
- **Retention.** `EKS_AUDIT_LOG_RETENTION_DAYS=365` (default). Rows older than this are exported to S3 cold storage (WORM bucket) and deleted from Postgres. The cold-storage copy is retained 7 years for regulatory compliance.

### 7.3 What we don't audit

- Read operations (GET requests) — too noisy. We log them as standard access logs with `requestId`/`correlationId`, not as audit rows.
- Internal events (worker start/stop) — operational, not audit.

### 7.4 Audit queries

Admins can query the audit trail via `/api/v1/admin/audit?entityType=Booking&entityId=...&from=...&to=...`. Results are paginated (cursor). Access is logged — querying the audit log is itself audited.

---

## 8. Session Foundation (M1) → Authentication (M2)

### 8.1 M1 — Demo-principal resolution

M1 ships `@eks/auth`'s `resolvePrincipal(headers)` which derives a `Principal` from `x-eks-user`, `x-eks-org`, `x-eks-name`, and `x-eks-roles` headers. This is **sandbox-only** and is disabled when `EKS_AUTH_MODE=jwt`.

The demo principal flow lets us:
- Exercise the full RBAC surface end-to-end without a session service.
- Test every role (`CUSTOMER`, `COOK`, `MANAGER`, `INSPECTOR`, `ADMIN`, `SUPER_ADMIN`) by changing headers.
- Verify the audit trail records the actor correctly.

**Security posture:** M1 demo mode is acceptable only because the sandbox is not internet-exposed. The moment `EKS_ENVIRONMENT=staging` or `production`, `EKS_AUTH_MODE` MUST be `jwt`; otherwise the server refuses to boot.

### 8.2 M2 — NextAuth + signed JWT

- NextAuth.js with the credentials provider (email + Argon2id-hashed password) and (M3) OAuth providers (Google, Apple).
- Session is a signed JWT in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. JWT body: `{ sub, org, roles, iat, exp, jti }`.
- Access token TTL: `EKS_JWT_TTL_SECONDS` (default 1 hour). Refresh token: 30 days, rotated on each use.
- `authorize(principal, perm)` consumes the JWT-derived `Principal`, identical to M1's API.
- MFA (TOTP) required for `ADMIN` and `SUPER_ADMIN` roles.
- Account lockout after 5 failed login attempts; unlock by an admin or after a 15-minute cooldown.

### 8.3 M3 — Hardening

- Postgres row-level security policies on every tenant-scoped table (`USING (organization_id = current_setting('app.current_org')::text)`).
- Hardware security module (HSM) or AWS KMS for JWT signing (asymmetric, RS256).
- WebAuthn (passkeys) for passwordless auth.
- Step-up authentication for high-risk actions (e.g. disabling MFA, changing payout account).

---

## 9. AI Security

### 9.1 Prompt injection defence

- The AI assistant's system prompt is **not user-editable**. User input goes into a clearly-delimited user-message section.
- Tool calls are an explicit allowlist (see `@eks/ai`'s tool registry). The AI cannot invoke arbitrary endpoints.
- The AI cannot make payment changes, cannot mutate feature flags, cannot read raw PII beyond the principal's own tenant scope.

### 9.2 Tenant isolation in AI

- The grounding context is built server-side from the principal's tenant. The user cannot ask "show me bookings from tenant X" and succeed — the context doesn't include them.
- AI responses are logged with `principal.userId`, `organizationId`, prompt hash, and response hash. Audit trail can reconstruct any AI interaction.

### 9.3 Token budget

- Per-tenant daily token budget (`EKS_AI_DAILY_TOKEN_BUDGET`). Over-budget requests return `429`.
- Per-user cap (M2) to prevent one user from exhausting the tenant's budget.
- The model and temperature are server-configured, not user-controllable.

### 9.4 PII in prompts

- The AI assistant may receive PII (customer name, address) as grounding context. This PII is **not logged** in the prompt text — only a hash is logged. The full prompt is retained in an encrypted, access-controlled store for 30 days for debugging, then purged.

---

## 10. Dependency Security

### 10.1 Lockfile

`bun.lock` is committed. `bun install --frozen-lockfile` in CI refuses to install if the lockfile doesn't match `package.json`. No transitive dependency can sneak in without an explicit `package.json` change.

### 10.2 Audit

`bun audit` runs in CI on every PR and nightly on `main`. New high-severity CVEs block merge; critical CVEs page the on-call.

### 10.3 Allowlist (M2)

A subset of high-risk packages (e.g. `z-ai-web-dev-sdk`, `next-auth`, `@prisma/client`) is on an explicit allowlist. Bumping a allowlisted package requires staff-engineer approval.

### 10.4 SBOM (M2)

Each release publishes a CycloneDX SBOM to `docs/sbom/<version>.json`. Customers under regulatory scrutiny can request it.

---

## 11. Incident Response

See `OPERATIONS_RUNBOOK.md` for the full procedure. Security-specific addenda:

### 11.1 Suspected PII leak

- Sev-1. Page security@ and duty manager immediately.
- Identify the scope: which tenants, which users, which fields.
- Rotate credentials that may have been exposed.
- Notify affected users within 72 hours (GDPR / NDPA requirement).
- Preserve logs and audit trail for forensic analysis.
- Post-mortem within 5 business days; regulatory notification if threshold met.

### 11.2 Suspected payment fraud

- Sev-1. Page security@ and the payments on-call.
- Pause the affected payment flows via `FeatureFlag` (`payments.initiate=false`).
- Coordinate with Payswap's fraud team; share the `payswapId`s involved.
- Identify the actor (audit trail) and suspend their account.
- Reconcile all payments in the affected window; issue refunds for confirmed fraud.

### 11.3 Suspected insider threat

- Engage HR + legal; do not confront the individual alone.
- Pull their audit trail; identify any anomalous access.
- Revoke their credentials; rotate any secrets they had access to.
- Preserve evidence; involve law enforcement only if legal advises.

---

## 12. Responsible Disclosure Policy

### 12.1 Scope

We welcome responsible disclosure of security vulnerabilities in:
- The `eks.food` web application and API.
- Our mobile apps (M3).
- Our infrastructure (misconfigurations exposing data).
- Third-party integrations where Eks-Food is the leaking party.

Out of scope:
- Vulnerabilities in third-party services not operated by Eks-Food (report to them directly).
- Social engineering of Eks-Food staff.
- Physical attacks on our offices.
- Denial-of-service attacks (we know we can be DoS'd; tell us the method, don't demonstrate it).

### 12.2 Reporting

Email `security@eks.food` with:
- A description of the vulnerability.
- Steps to reproduce (PoC if possible).
- The impact you've observed.
- Your contact info (for follow-up and credit).

We acknowledge within 48 hours. We aim to triage within 5 business days and to remediate or mitigate within 30 days for high-severity issues.

### 12.3 Safe harbour

We will not pursue legal action against researchers who:
- Make a good-faith effort to avoid privacy violations, data destruction, and service interruption.
- Do not access data beyond what's necessary to demonstrate the vulnerability.
- Give us reasonable time to remediate before public disclosure.
- Do not demand payment as a condition of disclosure (we don't run a bug bounty program yet; we do say thank you publicly and privately).

### 12.4 Disclosure

We credit researchers in our quarterly security update (with permission). We coordinate disclosure: we publish a write-up after remediation, and we ask the researcher to withhold public disclosure until 90 days after their report or until remediation is shipped, whichever is sooner.

### 12.5 Contact

- Security reports: `security@eks.food` (PGP key at `https://eks.food/.well-known/security.txt`)
- General security questions: `#eks-security` Slack
- Press inquiries: `press@eks.food`

---

## 13. Security Review Checklist (for PRs)

Reviewers confirm for every PR touching security-sensitive code:

- [ ] No secret in code, env example, or test fixture.
- [ ] No PII in logs, audit `metadata`, or error responses.
- [ ] Every new endpoint has an RBAC permission check.
- [ ] Every new DB query is tenant-scoped (`organizationId` filter).
- [ ] Every new inbound payload has a Zod schema with explicit `max()` on strings.
- [ ] Every new outbound HTTP call uses an allowlisted host.
- [ ] Every new AI tool call is in the allowlist.
- [ ] Every new dependency passes `bun audit`.
- [ ] Every new `FeatureFlag` defaults to `off`.
- [ ] Every new audit `action` is in the catalogue (`docs/audit-actions.md`).

For PRs touching `src/lib/payswap.ts`, `src/lib/auth.ts`, `prisma/schema.prisma`, or `infra/`:
- [ ] Two-staff-engineer sign-off required (per `CONTRIBUTING.md` §4.4).
- [ ] Threat model updated if attack surface changed.
- [ ] Security team notified in `#eks-security`.

---

## 14. Compliance Footprint

Eks-Food operates across multiple jurisdictions. The platform is designed to support (not yet certified for):

- **GDPR** (EU) — data subject access requests, right to erasure, data residency per region. (M3: DSAR automation.)
- **NDPA** (Nigeria) — Nigeria Data Protection Act compliance; data localisation for Nigerian tenants.
- **DPA 2012** (Ghana) — Ghana Data Protection Act compliance.
- **PCI DSS** — Eks-Food is **PCI-DSS SAQ-A** scoped because we never touch card data; all card handling is on Payswap's PCI-DSS Level 1 certified infrastructure. See `PAYMENTS.md`.
- **SOC 2** (M3 target) — Type II audit covering security, availability, confidentiality.

This document is the engineering reference, not the compliance attestation. For the latter, contact `compliance@eks.food`.
