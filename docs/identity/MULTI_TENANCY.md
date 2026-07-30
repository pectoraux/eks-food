# Eks-Food IAM — Multi-Tenancy

> **Audience:** Platform engineers, security reviewers, database administrators. Read alongside `ARCHITECTURE.md` (§6 Multi-Tenancy Isolation Strategy), `AUTHORIZATION_POLICIES.md` (§4–§5 ABAC scope rule), and `API_REFERENCE.md` (the `tenant scope` column).
>
> **Status:** M2 target architecture. The M1 foundation ships `organizationId` on every business Prisma model (see `prisma/schema.prisma`). The M1 `RequestContext` (`src/packages/observability/context.ts`) already carries `organizationId` via `AsyncLocalStorage`. M2 builds the explicit `TenantContext`, the `TenantScopedRepository` base class, the tenant-switch flow, and the data-residency hooks on top.

---

## 1. Tenancy Model

Eks-Food is a multi-tenant platform. A **tenant** is an Organization. Every user, booking, payment, audit row, and (almost) every identity row belongs to exactly one tenant, identified by `organizationId`.

The few **global** models (no `organizationId`):
- `Organization` itself.
- `Role`, `Permission`, `Policy` where `scope="global"` (system-defined roles and policies).
- `FeatureFlag` where `organizationId IS NULL` (platform-wide flag defaults).

Everything else is tenant-scoped, including all IAM models:

| Model | Tenant-scoped | Notes |
|---|:---:|---|
| `User` | ✓ | `organizationId` is the user's "home" tenant. (A user may also be a member of other tenants via `Membership`.) |
| `Identity` | ✓ | Inherits `organizationId` from `User`. |
| `Session` | ✓ | `organizationId` is the tenant the session is currently scoped to (can change via tenant switch). |
| `Device` | ✓ | Devices are per-tenant (a user using two orgs has two Device rows for the same physical device). |
| `Membership` | ✓ | `organizationId` is the org the membership is in; `userId` may be from a different home org. |
| `Team` | ✓ | Teams live inside an org. |
| `Invitation` | ✓ | Per-org. |
| `MFAConfiguration` | ✓ | Per-user, hence per-tenant. |
| `RecoveryCode` | ✓ | Per-user, per-tenant. |
| `AuditLog` | ✓ | `organizationId` is the tenant whose data the action affected. `actorUserId` may be a SUPER_ADMIN/SUPPORT (whose home tenant is null). |
| `LoginHistory` | ✓ | Per-user, per-tenant. |
| `UserPreference` | ✓ | Per-user, per-tenant. |
| `TenantConfiguration` | ✓ | Per-org configuration overrides. |
| `FeatureFlagAssignment` | ✓ | Per-org flag overrides. |

---

## 2. The Isolation Key — `organizationId`

Every tenant-scoped Prisma model carries:

```prisma
model SomeTenantScopedEntity {
  id              String   @id @default(cuid())
  organizationId  String
  // …entity fields…
  organization    Organization @relation(fields: [organizationId], references: [id])
  @@index([organizationId])
  // + compound indexes that lead with organizationId for hot paths:
  // @@index([organizationId, status, createdAt])
}
```

**Conventions enforced by lint rule:**
1. The column is always named `organizationId` (never `orgId`, `tenantId`, `tenant`).
2. The column is the **first** column in every composite index used by hot queries, so the database can prune to the tenant partition (or RLS policy, M3) without scanning.
3. The column is `NOT NULL` (except on the explicit global models).
4. The column is never exposed in API responses unless the caller is `SUPER_ADMIN`/`SUPPORT` (it's implied by the request's tenant scope).

---

## 3. Repository-Level Enforcement

Every repository in `@eks/identity`, `@eks/organizations`, and the IAM-facing parts of `@eks/auth` extends a `TenantScopedRepository<T>` base class. Its contract:

```ts
abstract class TenantScopedRepository<T extends { organizationId: string }> {
  /** Reads the active tenant from the TenantContext (AsyncLocalStorage). */
  protected get orgId(): string {
    const ctx = tenantContext();
    if (!ctx?.organizationId) {
      // Missing context — return a sentinel that yields zero rows.
      // NEVER fall back to a default tenant — that would be a bug.
      return "__NO_TENANT__";
    }
    return ctx.organizationId;
  }

  /** Every query is scoped. */
  async findById(id: string): Promise<T | null> {
    return prisma.someEntity.findFirst({
      where: { id, organizationId: this.orgId },
    });
  }

  async list(filter: Filter, page: Page): Promise<PagedResult<T>> {
    return prisma.someEntity.findMany({
      where: { ...filter, organizationId: this.orgId },
      ...pageToPrisma(page),
    });
  }

  async save(entity: T): Promise<Result<void, DomainError>> {
    // Defensive: refuse to save a row whose organizationId ≠ active tenant.
    if (entity.organizationId !== this.orgId) {
      return err(new UnauthorizedError(
        "Cannot save entity belonging to a different tenant"));
    }
    await prisma.someEntity.upsert({ where: { id: entity.id }, … });
    return ok(undefined);
  }
}
```

**The crucial invariant:** a repository call without a `TenantContext` returns an empty result (or fails the save). It never returns another tenant's data. The sentinel `"__NO_TENANT__"` is a string that will never match a real `organizationId` (which is always a cuid), so Prisma returns zero rows. This is the "missing orgId returns empty, never another tenant's data" guarantee.

### 3.1 Cross-tenant queries — explicitly disallowed
There is no `findByIdIgnoringTenant(id)` method on any repository. If a cross-tenant read is genuinely required (e.g. SUPPORT viewing a user in another tenant), it goes through a separate `GlobalRepository` that:
- Requires `principal.roles ∋ SUPER_ADMIN | SUPPORT`.
- Calls `authorize(principal, "user.read.any", { tenantId: targetTenantId })` — the `.any` suffix is the convention for cross-tenant permissions.
- Logs every call to the audit log with `action=AUTHZ_CROSS_TENANT_READ`.

This makes cross-tenant access explicit, audited, and rare.

### 3.2 Lazy loading — same enforcement
Prisma's relation lazy-loaders (`user.memberships`, `booking.cook`, etc.) are wrapped so the relation query also injects `organizationId: this.orgId` into the `where`. A naive `prisma.user.findUnique({ where: { id }, include: { memberships: true } })` is forbidden by lint rule `@eks/no-include-without-tenant-scope` — every `include` must be a function call that adds the scope.

---

## 4. `TenantContext` via `AsyncLocalStorage`

The `TenantContext` is propagated through the request lifecycle using the same `AsyncLocalStorage` mechanism the M1 `@eks/observability/context.ts` uses for `RequestContext`:

```ts
// @eks/organizations/tenant-context.ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  readonly organizationId: string;
  readonly userId: string;
  readonly membershipId: string;     // which Membership this session is using
  readonly roleSlug: string;         // active role within this tenant
  readonly teamIds: readonly string[];
  readonly switchedAt: ISODateString;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function tenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function withTenantContext<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T>;
export function withTenantContext<T>(ctx: TenantContext, fn: () => T): T;
export function withTenantContext<T>(ctx: TenantContext, fn: () => T | Promise<T>): T | Promise<T> {
  return storage.run(ctx, fn);
}
```

**Why AsyncLocalStorage?** Repository code deep in the call stack needs the tenant ID without threading it through every function signature. ALS makes it ambient — but unlike thread-locals in other languages, it is **automatically scoped** to the request's async chain. A `fetch()` from inside a worker does not inherit the request's `TenantContext`; the worker must establish its own.

### 4.1 Middleware sets the context
`@eks/auth/middleware` runs before every route handler:

```
1. Resolve session from cookie.
2. Load User + active Membership (the membership whose id is encoded in the
   session's encrypted payload; defaults to the user's home membership).
3. Verify the Membership is ACTIVE and the User is ACTIVE.
4. Build TenantContext { organizationId, userId, membershipId, roleSlug,
                         teamIds, switchedAt }.
5. withTenantContext(ctx, () => handler(req)).
```

Every repository call inside `handler` (and inside any service it invokes, any outbox stage, any audit write) reads `tenantContext()` and is automatically scoped.

### 4.2 Workers set their own context
Outbox relay workers re-establish the `TenantContext` from the event envelope's `organizationId` before invoking subscribers. So a `booking.confirmed.v1` event staged in tenant A, when relayed, runs its subscribers (notifications, audit) inside `withTenantContext({ organizationId: A, … })`. The M1 `EventMetadata` already carries `organizationId` (see `src/packages/events/types.ts`) for exactly this purpose.

---

## 5. Why Cross-Tenant Access Is Impossible by Construction

Three layers, each independent — breaching any one is insufficient.

### Layer 1 — Schema
Every tenant-scoped row has `organizationId`. There is no nullable `organizationId` shortcut that would let a row "float" between tenants. A row inserted without `organizationId` is rejected by the `NOT NULL` constraint.

### Layer 2 — Repository
Every query injects `where: { organizationId: this.orgId }`. `this.orgId` is either the active tenant from `TenantContext` or the sentinel `"__NO_TENANT__"` (which yields zero rows). There is **no** code path in `@eks/identity` / `@eks/organizations` that issues a Prisma query without this `where` clause.

### Layer 3 — Authorization
Even if Layers 1 and 2 somehow failed, the ABAC scope rule (§5 of `AUTHORIZATION_POLICIES.md`) rejects any request where `scope.tenantId != principal.activeTenantId` unless the actor is `SUPER_ADMIN` or `SUPPORT` (and those calls are audited as `AUTHZ_CROSS_TENANT_READ`).

### Layer 4 — (M3) PostgreSQL Row-Level Security
As defence in depth, M3 will add RLS policies:

```sql
CREATE POLICY tenant_isolation ON bookings
  USING (organization_id = current_setting('app.tenant_id', true)::text);
```

The application sets `SET app.tenant_id = ?` at the start of each transaction (from the `TenantContext`). A query that forgets the `where` clause then returns zero rows because the database itself rejects the cross-tenant row. RLS is M3; Layers 1–3 ship in M2.

### Failure-mode analysis

| Bug scenario | Layer 1 | Layer 2 | Layer 3 | Result |
|---|---|---|---|---|
| Repository forgets `where: { organizationId }` | ✓ holds | ✗ fails | ✓ holds (scope check denies) | 403, audited |
| Authorization scope check bypassed | ✓ holds | ✓ holds | ✗ fails | empty result (no tenant context) |
| `TenantContext` not set (worker bug) | ✓ holds | ✗ fails (sentinel) | ✓ holds (no principal) | empty result, audit fails |
| Direct DB access (bypassing Prisma) | ✗ fails | ✗ fails | ✗ fails | M3 RLS catches it |

---

## 6. Tenant Configuration

Each tenant has a `TenantConfiguration` row (and a hierarchy of overrides) that controls:

```prisma
model TenantConfiguration {
  id              String   @id @default(cuid())
  organizationId  String   @unique
  // Branding
  displayName     String
  logoUrl         String?
  primaryColor    String   @default("#E07A1F") // Eks-Food amber
  // Localization
  defaultLocale   String   @default("en")
  supportedLocales String  @default("en,fr") // pipe-separated
  timezone        String   @default("Africa/Accra")
  // Currency / units
  defaultCurrency String   @default("GHS")
  // Data residency (see §9)
  dataResidencyRegion String @default("gh-east-1")
  // Feature overrides (also see FeatureFlagAssignment for per-flag control)
  enforcedMfa     Boolean  @default(false)
  passwordPolicy  String   @default("{}") // JSON override of global policy
  sessionPolicy   String   @default("{}") // JSON override of session TTLs
  // Audit
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  updatedBy       String?
}
```

`@eks/config` reads tenant overrides at request time via a short-TTL cache (10 s) so a configuration change is visible within 10 seconds without a restart. The global default comes from the env-var-backed `AppConfigSchema`; the tenant override merges on top.

### 6.1 Localization
Templates in `@eks/notifications` carry a `locale` column (see `src/packages/domain/contexts/notifications/aggregates.ts`). When composing a notification, the `NotificationComposer` looks up the user's preferred locale (`UserPreference.locale`, falling back to `TenantConfiguration.defaultLocale`, falling back to `en`) and renders the matching template. See `NOTIFICATIONS.md` §5.

### 6.2 Per-tenant feature flags
The M1 `FeatureFlagService` evaluates flags per-actor. M2 adds the `FeatureFlagAssignment` Prisma model:

```prisma
model FeatureFlagAssignment {
  id              String   @id @default(cuid())
  organizationId  String
  flagKey         String   // e.g. "auth.passkey"
  enabled         Boolean  @default(false)
  rolloutPercent  Int      @default(0)   // 0..100 — gradual rollout
  config          String   @default("{}") // JSON
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([organizationId, flagKey])
}
```

A flag is `enabled` for a tenant if either the global default (M1 `FeatureFlag`) is `enabled` OR the `FeatureFlagAssignment` is `enabled`. The `rolloutPercent` allows a partial rollout — the `FeatureFlagService` hashes the `userId` into a 0–99 bucket and includes the user if their bucket is below the threshold. This is how `auth.passkey` is piloted on Eks-Food Ghana before being enabled platform-wide.

---

## 7. Shared Services That Span Tenants

A small set of services are intentionally **shared** across tenants — they live outside the `TenantScopedRepository` pattern:

| Service | Why shared | How accessed |
|---|---|---|
| Authentication (`@eks/auth`) | Login must resolve the User across all tenants (by email). | `UserRepository.findByEmail` is a `GlobalRepository` method; requires `AUTH_LOGIN` action. The User's `organizationId` becomes the active tenant after login. |
| Notifications dispatch | The notification provider (SMTP, Twilio) is platform-wide; per-tenant SMTP is M3. | `NotificationProvider` is a singleton; the `Notification` row carries `tenantId` for audit but the SMTP connection is shared. |
| Verification (M2 interface only) | Government-ID verification is per-user but uses a shared provider account. | See `VERIFICATION.md`. |
| Audit log ingestion | The audit table is partitioned by tenant (for query performance) but the writer is shared. | The `AuditLog` row's `organizationId` is set from `TenantContext` (or from the event envelope in worker-driven writes). |
| Outbox relay | A single relay worker drains the outbox for all tenants. | The relay preserves the `organizationId` from the outbox row into the event envelope; subscribers re-establish `TenantContext`. |
| Rate limiting | Rate-limit counters are keyed on `(ip, path)` or `(userId, path)` — not tenant. | A user hammering `/api/v1/auth/login` is rate-limited regardless of tenant. |

The shared services never expose tenant data to each other: a notification composed in tenant A carries tenant A's branding/locale, never tenant B's. The shared dispatch infrastructure (SMTP connection) is implementation detail, not data.

---

## 8. Tenant-Switch Flow

A user may belong to multiple organizations (e.g. Amara is a `manager` at Eks-Food Ghana **and** a `member` at a catering franchise "Ada Kitchens"). The platform supports switching the active tenant without re-authenticating:

```
Browser                @eks/auth                Prisma
   │                       │                        │
   │  GET /api/v1/users/me/memberships                                                              │
   │  (returns all ACTIVE memberships for the authenticated user)                                     │
   ├──────────────────────▶│                        │
   │                       │  Principal built from current session                                   │
   │                       │  Membership.list({ userId, status: ACTIVE })                           │
   │                       ├───────────────────────▶│
   │                       │◀───────────────────────┤
   │  200 OK               │                        │
   │  { data: [                                                                            │
   │    { orgId: "org_ghana", name: "Eks-Food Ghana", role: "manager", active: true },   │
   │    { orgId: "org_ada",   name: "Ada Kitchens",  role: "member",  active: false }    │
   │  ] }                                                                                  │
   │◀──────────────────────┤                        │
   │                       │                        │
   │  POST /api/v1/auth/switch-tenant                                                                │
   │  { organizationId: "org_ada" }                                                                  │
   ├──────────────────────▶│                        │
   │                       │  ① Verify membership exists & ACTIVE                                    │
   │                       ├───────────────────────▶│
   │                       │  ② Verify target org is ACTIVE (not SUSPENDED/TERMINATED)                │
   │                       │  ③ BEGIN TX                                                            │
   │                       │    UPDATE Session                                                       │
   │                       │      activeMembershipId = newMembership.id                              │
   │                       │      activeOrganizationId = "org_ada"                                   │
   │                       │      riskScore = recompute (switching tenant is risk-aware)              │
   │                       │    stage outbox: identity.session.tenant_switched.v1                     │
   │                       │      { userId, fromOrg: "org_ghana", toOrg: "org_ada" }                  │
   │                       │    audit(AUTH_TENANT_SWITCHED)                                          │
   │                       │  COMMIT                                                                 │
   │                       │  ④ Issue new cookies (rotated access token; same refresh family)         │
   │  200 OK               │                        │
   │  Set-Cookie: __Host-eks.session=…                                                              │
   │  { data: { organization: { id: "org_ada", name: "Ada Kitchens", role: "member" } } }            │
   │◀──────────────────────┤                        │
```

After the switch:
- The `TenantContext` for subsequent requests in this session carries `organizationId: "org_ada"`.
- All repository calls scope to `org_ada`.
- The user's permissions are recomputed from the `org_ada` membership (Amara is a `member` there, not a `manager` — her `booking.assign` permission is gone).
- The audit log records every action under `organizationId: "org_ada"` for the duration of the switched session.

**Risk-aware switching.** Switching to a tenant where the user has not been active in 30 days bumps the risk score by 20; switching to a tenant in a different country bumps it by 30. If the resulting risk crosses 70, step-up MFA is demanded before the switch completes.

**Switch back.** The same endpoint switches back. The original tenant's membership is still ACTIVE. The original `refreshFamilyId` is preserved (no re-authentication needed).

---

## 9. Data Residency Considerations (Multi-Country)

Eks-Food operates in Ghana (primary), Nigeria, and Côte d'Ivoire (planned). Each country has its own data-protection regime:

| Country | Regulation | Key requirement |
|---|---|---|
| Ghana | Data Protection Act, 2012 (Act 843) | Personal data must not leave Ghana without consent. |
| Nigeria | NDPR (Nigeria Data Protection Regulation, 2019) | Cross-border transfer requires adequate protection in the destination. |
| Côte d'Ivoire | Loi n°2013-450 | Personal data must be stored in Côte d'Ivoire or a country with equivalent protection. |

### 9.1 Tenant pinning
Each `TenantConfiguration` carries `dataResidencyRegion` (default `gh-east-1` for Ghana). The M2 schema stores the field; M3 will enforce it at the database level by routing writes to the appropriate regional cluster. In M2, the field is consulted by:

- **Backup jobs** — a tenant pinned to `gh-east-1` is backed up only to the Ghana backup bucket, never to the cross-region replication bucket.
- **Export jobs** — `audit.export` for a Ghana-pinned tenant writes the export to a Ghana-region S3 bucket.
- **Notification dispatch** — for tenants pinned to a region, the email/SMS provider is chosen from the tenant's region (a Ghana-pinned tenant uses the Ghana SMTP relay; a Nigeria-pinned tenant uses the Nigeria relay). This avoids personal data transiting a third country's SMTP infrastructure.

### 9.2 Cross-region reads
Reads across regions (e.g. a SUPER_ADMIN in Accra viewing a Lagos tenant's data) are:
- Audited as `AUTHZ_CROSS_REGION_READ`.
- Allowed only for `SUPER_ADMIN` / `SUPPORT` with the `user.read.any` permission.
- Routed through a read replica in the destination region (M3 — in M2 all reads hit the primary).

### 9.3 Right to erasure by region
A user in Ghana exercising their right to erasure under Act 843 triggers a deletion across all tenant-scoped tables where the user appears as `userId` or `actorUserId`. The deletion is soft (sets `User.status=DEACTIVATED`, PII replaced with hash of the original email) and the audit log records `AUTH_RIGHT_TO_ERASURE_EXERCISED`. See `AUDIT_AND_COMPLIANCE.md` §4.

---

## 10. Tenant Lifecycle & Isolation Implications

An organization's lifecycle (create → verify → activate → suspend → delete — see `ORGANIZATIONS.md` §3) has direct implications for tenant isolation:

| Transition | Isolation effect |
|---|---|
| `create` | New `Organization` row; no data yet. Default `TenantConfiguration` inserted. |
| `verify` | Owner's email verified; no isolation change. |
| `activate` | Organization is `ACTIVE`; members can authenticate; repository calls scope normally. |
| `suspend` | Organization is `SUSPENDED`. Active sessions are revoked. New logins are blocked (the membership check fails). Repository reads still return data (so the org can be audited while suspended), but writes are rejected by a `OrgStatusGuard` middleware. |
| `terminate` | Organization is `TERMINATED`. All memberships are `REVOKED`. A 30-day retention window holds the data for legal/compliance purposes before a hard-delete job scrubs it. |

The `OrgStatusGuard` (M2) is a thin middleware that runs after `@eks/auth/middleware` and rejects any state-changing request whose active tenant is `SUSPENDED` or `TERMINATED` with `code=BUSINESS_RULE`, `details.rule=org_not_active`. Reads continue to work so the org owner can log in (read-only) and view audit history.

---

## 11. Test Strategy for Tenant Isolation

Tenant isolation is too important for unit tests alone. The M2 test suite includes an **isolation property test**:

```ts
// src/packages/organizations/__tests__/tenant-isolation.spec.ts
describe("tenant isolation", () => {
  beforeEach(async () => {
    // Seed two tenants with overlapping user names + booking codes.
    await seedTenant("org_ghana", { users: ["amara", "kwame"], bookings: ["EKS-AAA", "EKS-BBB"] });
    await seedTenant("org_ada",   { users: ["amara", "tunde"], bookings: ["EKS-AAA", "EKS-CCC"] });
    // Note: "amara" exists in both tenants (same name, different userIds);
    //       "EKS-AAA" exists in both (same code, different ids — codes are
    //       unique within a tenant, not globally).
  });

  it("never returns another tenant's data", async () => {
    for (const repo of allTenantScopedRepos()) {
      await withTenantContext({ organizationId: "org_ghana", userId: … }, async () => {
        const results = await repo.list({}, { limit: 1000, offset: 0 });
        for (const row of results.items) {
          expect(row.organizationId).toBe("org_ghana");
        }
      });
    }
  });

  it("returns empty when no TenantContext is set", async () => {
    // Without withTenantContext, every repo returns empty.
    for (const repo of allTenantScopedRepos()) {
      const results = await repo.list({}, { limit: 1000, offset: 0 });
      expect(results.items).toHaveLength(0);
    }
  });

  it("refuses to save an entity with a mismatched organizationId", async () => {
    await withTenantContext({ organizationId: "org_ghana", userId: … }, async () => {
      const row = makeBooking({ organizationId: "org_ada" });
      const result = await bookingRepo.save(row);
      assertErr(result);
      expect(result.error.code).toBe("UNAUTHORIZED");
    });
  });
});
```

This runs against every `TenantScopedRepository` implementation, including ones added in future milestones — the `allTenantScopedRepos()` helper discovers them via the package barrel.

---

## 12. Cross-References

| Topic | Document |
|---|---|
| Bounded contexts, package map, request flow | `ARCHITECTURE.md` |
| RBAC + ABAC, the scope rule, the Amara worked example | `AUTHORIZATION_POLICIES.md` |
| Organization lifecycle, teams, invitations, memberships | `ORGANIZATIONS.md` |
| Audit log entries for `AUTH_TENANT_SWITCHED`, `AUTHZ_CROSS_TENANT_READ`, `AUTH_RIGHT_TO_ERASURE_EXERCISED` | `AUDIT_AND_COMPLIANCE.md` |
| Data residency & breach response (force-delete across regions) | `DISASTER_RECOVERY.md` |
