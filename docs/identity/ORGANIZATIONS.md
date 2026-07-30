# Eks-Food IAM — Organizations

> **Audience:** Identity engineers, ops engineers provisioning tenants, support engineers handling ownership transfers. Read alongside `MULTI_TENANCY.md` (tenant isolation), `AUTHORIZATION_POLICIES.md` (org/team roles), and `API_REFERENCE.md` (organizations/memberships/invitations endpoints).
>
> **Status:** M2 target architecture. The M1 domain skeleton (`src/packages/domain/contexts/organization/aggregates.ts`) declares `OrganizationAggregate`, `TenantAggregate`, and `MembershipAggregate` with the lifecycle methods used here. M2 publishes `@eks/organizations` with the Prisma-backed implementations and the `OrganizationType` registry.

---

## 1. Organization Model

An `Organization` is both the **billing entity** and the **tenant isolation boundary**. Every other model that carries `organizationId` is isolated to that org.

```prisma
model Organization {
  id                    String   @id @default(cuid())
  parentOrganizationId  String?  // for franchise hierarchies
  slug                  String   @unique  // URL-friendly, e.g. "eks-food-ghana"
  name                  String
  // Type is DATA, not code — see §2.
  type                  String   @default("restaurant")
  // Lifecycle
  status                String   @default("PROVISIONING")
  // PROVISIONING | PENDING_VERIFICATION | ACTIVE | SUSPENDED | TERMINATED
  statusReason          String?
  statusChangedAt       DateTime?
  verifiedAt            DateTime?
  // Locale + currency defaults
  country               String   @default("GH")
  baseCurrency          String   @default("GHS")
  defaultLocale         String   @default("en")
  timezone              String   @default("Africa/Accra")
  dataResidencyRegion   String   @default("gh-east-1")
  // Owner (one user who can transfer ownership, delete the org)
  ownerId               String
  // Address
  addressJson           String   @default("{}")
  // Plan + entitlements
  plan                  String   @default("eks.starter")
  entitlementsJson      String   @default("[]")
  // Audit
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  parent                Organization? @relation("OrgHierarchy", fields: [parentOrganizationId], references: [id])
  children              Organization[] @relation("OrgHierarchy")
  owner                 User          @relation("OrgOwner", fields: [ownerId], references: [id])
  users                 User[]        @relation("OrgMembers")
  memberships           Membership[]
  teams                 Team[]
  invitations           Invitation[]
  tenantConfiguration   TenantConfiguration?
  featureFlags          FeatureFlagAssignment[]
  auditLogs             AuditLog[]
  sessions              Session[]
  // …business relations (Booking, Payment, etc.)
}
```

### 1.1 TenantConfiguration
Per-org configuration overrides (branding, locale, currency, feature flags, password policy, session policy). See `MULTI_TENANCY.md` §6 for the full schema.

### 1.2 Organization hierarchy
An organization may have a `parentOrganizationId` (for franchise / multi-branch structures). The hierarchy is one level deep in M2 (a parent and its direct children); multi-level hierarchies are M3. The hierarchy affects:
- **Billing** — a child org inherits the parent's plan by default but can upgrade independently.
- **Reporting** — a parent's `ADMIN` can read aggregated metrics across children (via `org.read.children` permission).
- **Tenant isolation** — children are still isolated from each other and from the parent at the data layer. The hierarchy is a reporting/billing concept, not a data-sharing concept.

---

## 2. OrganizationType Registry — Data, Not Code

The `type` field on `Organization` is a string drawn from a **registry**, not a TypeScript enum. The registry is stored in the database (seeded by migration) and read at runtime by `@eks/organizations`. Adding a new type is a data migration, not a code change.

The seed migration ships these canonical types:

| Code | Display name | Typical use |
|---|---|---|
| `household` | Household | A family using Eks-Food for in-home cooking bookings. |
| `restaurant` | Restaurant | A restaurant operating on the platform. |
| `vendor` | Vendor / Stall | A market-stall vendor. |
| `supplier` | Supplier | A food supplier selling to restaurants / cooks. |
| `catering` | Catering Company | An event-catering business. |
| `franchise` | Franchise | A multi-branch franchise (parent of restaurant children). |
| `inspection_agency` | Inspection Agency | A food-safety inspection body (uses the safety context). |
| `logistics` | Logistics Provider | A delivery / cold-chain operator. |
| `enterprise` | Enterprise | A large enterprise running internal food services. |

```prisma
model OrganizationType {
  id          String   @id @default(cuid())
  code        String   @unique  // "restaurant", "catering", etc.
  displayName String
  description String
  // Default entitlements applied to new orgs of this type
  defaultEntitlementsJson String @default("[]")
  // Default plan
  defaultPlan String   @default("eks.starter")
  // Feature flags auto-enabled for this type
  defaultFeatureFlagsJson String @default("[]")
  // Whether new orgs of this type require verification before activation
  requiresVerification Boolean @default(true)
  // Audit
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  active      Boolean  @default(true)
}
```

When a new `Organization` is created, the API:
1. Reads the `OrganizationType` row by `code`.
2. Applies `defaultEntitlementsJson` to the org's `entitlementsJson`.
3. Sets `plan = defaultPlan`.
4. Creates `FeatureFlagAssignment` rows for each flag in `defaultFeatureFlagsJson`.
5. Sets `status = PENDING_VERIFICATION` if `requiresVerification=true`, else `ACTIVE`.

The registry is mutable: ops can add a new type (e.g. `cloud_kitchen`) without a code deploy. The TypeScript types in `@eks/organizations` use `string` for the type code, with the canonical list exported as a readonly array for documentation.

---

## 3. Organization Lifecycle

```
   POST /api/v1/organizations
   (authenticated user creates a new org)
            │
            ▼
   ┌─────────────────┐
   │  PROVISIONING   │  ← Organization row inserted; TenantConfiguration defaults
   └────────┬────────┘     applied; owner membership created; not yet usable.
            │
            │ ① Email verification of owner
            │ ② If type.requiresVerification: queue VerificationRequest
            │    (business-license verification — see VERIFICATION.md)
            │
            ▼
   ┌──────────────────────┐
   │ PENDING_VERIFICATION │  ← Email verified; waiting on verification provider.
   └────────┬─────────────┘
            │
            │ ① VerificationResult.status=verified (manual review by SUPPORT
            │   for higher-tier types; automatic for low-tier)
            │ ② org.status = ACTIVE, verifiedAt = now
            │ ③ stage organization.activated.v1
            │ ④ audit(ORG_ACTIVATED)
            │ ⑤ @eks/notifications → welcome email to owner
            │
            ▼
   ┌─────────────────┐
   │     ACTIVE      │  ←↩ Normal operation. Members can authenticate, book, pay.
   └────────┬────────┘
            │  ↓ SUSPENDED triggers:
            │    • Non-payment (M3 billing integration)
            │    • Compliance violation (SUPPORT action)
            │    • Owner-initiated pause (rare; "we're renovating")
            │    • Security incident (breach response)
            │
            ▼
   ┌─────────────────┐
   │   SUSPENDED     │  ← Active sessions revoked; new logins blocked;
   └────────┬────────┘     reads still work (audit, own data); writes blocked.
            │                OrgStatusGuard rejects state-changing requests.
            │  ↑ REACTIVATE: SUPPORT clears the suspension; sessions remain
            │    revoked (users must re-authenticate); status=ACTIVE.
            │
            │  ↓ TERMINATE triggers:
            │    • Owner-initiated deletion (with 30-day grace period)
            │    • Force-majeure legal order
            │    • Long-term non-payment (M3)
            │
            ▼
   ┌─────────────────┐
   │   TERMINATED    │  ← All memberships REVOKED; 30-day retention for
   └────────┬────────┘     legal/compliance; then hard-delete job scrubs data.
            │
            │  After 30-day retention:
            │  ① Soft-delete PII (replace email/name with hash)
            │  ② Audit log retained (per AuditLog retention policy)
            │  ③ Organization row marked DELETED (soft)
            │  ④ Backup snapshots older than 30 days are scrubbed
            │
            ▼
   ┌─────────────────┐
   │    DELETED      │  ← Tombstone; no live data; audit-only.
   └─────────────────┘
```

### 3.1 Status transitions
Allowed transitions:

| From | To | Trigger | Required permission |
|---|---|---|---|
| PROVISIONING | PENDING_VERIFICATION | Owner email verified | (system) |
| PENDING_VERIFICATION | ACTIVE | Verification passed | `org.activate` (SUPPORT or auto) |
| PENDING_VERIFICATION | TERMINATED | Verification failed (after appeal window) | `org.terminate` (SUPPORT) |
| ACTIVE | SUSPENDED | (see above) | `org.suspend` (SUPPORT/SUPER_ADMIN) |
| SUSPENDED | ACTIVE | Suspension cleared | `org.reactivate` (SUPPORT/SUPER_ADMIN) |
| ACTIVE / SUSPENDED | TERMINATED | Owner-initiated or forced | `org.terminate` (owner or SUPPORT) |
| TERMINATED | DELETED | 30-day retention elapsed | (system) |

Every transition stages a domain event (`organization.suspended.v1`, `organization.reactivated.v1`, `organization.terminated.v1`, `organization.activated.v1`) and writes an `AuditLog` row with `action=ORG_*` and the previous/new status in `metadata`.

---

## 4. Ownership Transfer

Each organization has exactly one `ownerId`. The owner is the user with the `owner` role in the org and the only user who can:
- Transfer ownership.
- Delete the organization.
- Change the org's `dataResidencyRegion`.

Ownership transfer flow:

```
Current owner (auth'd, requires fresh step-up MFA)
   │
   ▼
POST /api/v1/organizations/{id}/transfer-ownership
  { newOwnerId }
   │
   ▼
① Authorize: principal must be the current owner (or SUPER_ADMIN).
② Verify step-up MFA freshness (within 5 min).
③ Verify newOwner is an ACTIVE member of the org.
④ Verify newOwner has accepted MFA (if the org's TenantConfiguration
   enforces MFA for owners — default true).
⑤ BEGIN TX
    UPDATE Organization SET ownerId = newOwnerId
    UPDATE Membership SET roleSlug = "admin"
      WHERE userId = oldOwnerId AND organizationId = org
    UPDATE Membership SET roleSlug = "owner"
      WHERE userId = newOwnerId AND organizationId = org
    stage organization.ownership.transferred.v1 {
      fromUserId, toUserId, organizationId }
    audit(ORG_OWNERSHIP_TRANSFERRED, actor=oldOwnerId,
          entityId=org, metadata: { newOwnerId })
  COMMIT
⑥ Revoke all sessions for both users (force re-auth with new roles).
⑦ @eks/notifications → email both users:
   - To old owner: "You transferred ownership of Eks-Food Ghana to Amara."
   - To new owner: "You are now the owner of Eks-Food Ghana."
```

The step-up-MFA requirement and the dual email are the defences against a malicious owner (or a compromised owner session) silently transferring ownership.

---

## 5. Teams

A `Team` is a sub-grouping inside an organization. Teams inherit the org's policies and can add their own (see `AUTHORIZATION_POLICIES.md` §6 on policy inheritance). Typical uses:
- "East Legon Cooks" — region-scoped team for booking assignment.
- "Inspection Team Accra" — inspectors who share a roster.
- "Ada Kitchens — Hot Line" — a kitchen brigade within a restaurant org.

```prisma
model Team {
  id              String   @id @default(cuid())
  organizationId  String
  name            String
  slug            String   // unique within the org
  description     String?
  // Team lead (one user, has team_lead role via Membership)
  leadId          String
  // Team-level config (inherits org defaults; can override per-team
  // features like the booking auto-assign strategy)
  configJson      String   @default("{}")
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, slug])
  @@index([organizationId, active])
}
```

Team membership is recorded on the `Membership` row (the `teamId` column). A user has at most one Membership per (org, team) pair. The role on that Membership is one of `team_lead` or `team_member`.

### 5.1 Team lifecycle
- Created by an org `ADMIN` or `OWNER` (permission `org.team.create`).
- The creator must designate a `leadId` (an existing org member).
- A team can be deactivated (`active=false`) — its memberships remain but are not consulted for permission evaluation.
- Deleting a team (`DELETE /api/v1/teams/{id}`) revokes all its memberships and is audited as `TEAM_DELETED`.

### 5.2 Policy effect
A team-lead's permissions on team resources are scoped by the ABAC `team` rule:
- `resource.teamId == actor.teamId` (or `resource.teamId IS NULL` for org-wide resources).
This is how an East-Legon team lead can manage East-Legon bookings but not Kumasi bookings.

---

## 6. Invitations

The `Invitation` model governs how new members join an org. It supports email-based invitations, bulk invitations, role pre-assignment, expiration, and revocation.

```prisma
model Invitation {
  id              String   @id @default(cuid())
  organizationId  String
  // Recipient
  email           String   // case-insensitive
  invitedUserId   String?  // set if the email matches an existing user
  // Role pre-assignment
  roleSlug        String   // "member" by default; can be "manager", etc.
  teamId          String?  // optional team pre-assignment
  // Token
  tokenHash       String   @unique  // SHA-256 of the invitation token
  // Lifecycle
  status          String   @default("PENDING")
  // PENDING | ACCEPTED | REVOKED | EXPIRED
  invitedBy       String   // userId of the inviter
  invitedAt       DateTime @default(now())
  expiresAt       DateTime  // invitedAt + 7d by default
  acceptedAt      DateTime?
  acceptedByUserId String? // may differ from invitedUserId if email mismatch
  revokedAt       DateTime?
  revokedBy       String?
  // Bulk-invitation batch (null for single invitations)
  batchId         String?
  // Audit
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([organizationId, status])
  @@index([email, status])
  @@index([batchId])
}
```

### 6.1 Invitation lifecycle

```
Inviter (auth'd, role ADMIN/OWNER, permission org.member.invite)
   │
   ▼
POST /api/v1/invitations
  { email, roleSlug?, teamId?, expiresInHours? }
   │
   ▼
① Authorize inviter has permission.
② If roleSlug is above the inviter's own role → 403
   (a MANAGER cannot invite an ADMIN).
③ Verify target email format (Zod).
④ Generate invitation token = randomBytes(32).
⑤ Hash token (SHA-256), insert Invitation row (status=PENDING,
   expiresAt = now + 7d or custom).
⑥ Queue invitation email via @eks/notifications:
   Subject: "You're invited to join Eks-Food Ghana"
   Body: link https://eks.food/invite?token=…
⑦ audit(ORG_INVITATION_SENT)

[Recipient clicks link]
   │
   ▼
GET /api/v1/invitations/resolve?token=…
   │
   ▼
① Hash token, look up Invitation.
② If not found → 410 INVITATION_REVOKED (don't reveal existence).
③ If status=EXPIRED (now > expiresAt) → 410 INVITATION_EXPIRED.
④ If status=REVOKED → 410 INVITATION_REVOKED.
⑤ If status=ACCEPTED → 410 INVITATION_REVOKED (treat as consumed).
⑥ If invitedUserId is set (existing user):
   - if the recipient is logged in as that user → can accept directly.
   - else → must log in as that user first.
⑦ If invitedUserId is null (new user):
   - recipient must register a new account using the same email.
   - registration flow carries the invitation token.

[Recipient accepts]
   │
   ▼
POST /api/v1/invitations/{id}/accept
  (auth'd as invitedUserId or just-registered user)
   │
   ▼
① Verify the authenticated user matches invitedUserId (or email).
② BEGIN TX
    UPDATE Invitation SET status=ACCEPTED, acceptedAt=now,
                            acceptedByUserId=authenticated user
    INSERT Membership {
      organizationId, userId: authenticated user,
      roleSlug: invitation.roleSlug, teamId: invitation.teamId,
      status: ACTIVE, invitedAt: now, activatedAt: now
    }
    UPDATE User.roleIds = append(roleId)
    stage organization.member.added.v1 { userId, roleId }
    audit(MEMBERSHIP_ACCEPTED)
  COMMIT
③ Queue welcome email to recipient.
④ Notify inviter: "Amara accepted your invitation to Eks-Food Ghana."
```

### 6.2 Expiration
A daily worker scans for `Invitation` rows with `status=PENDING` and `expiresAt < now`, transitions them to `EXPIRED`, and stages `organization.invitation.expired.v1`. The default TTL is 7 days; `expiresInHours` can extend it to 30 days max (longer requires SUPPORT intervention).

### 6.3 Revocation
The inviter (or any org `ADMIN`/`OWNER`) can revoke a pending invitation:

```
DELETE /api/v1/invitations/{id}
① Authorize: principal is ADMIN/OWNER in the org.
② BEGIN TX
    UPDATE Invitation SET status=REVOKED, revokedAt=now, revokedBy=principal
    audit(ORG_INVITATION_REVOKED)
  COMMIT
```

If the recipient later tries to use the token, they get `410 INVITATION_REVOKED`.

### 6.4 Bulk invitations
For onboarding an entire kitchen brigade at once, `POST /api/v1/invitations/bulk` accepts an array of up to 50 `{ email, roleSlug, teamId }` entries. It:
1. Validates every entry (Zod array schema).
2. Inserts all `Invitation` rows in one transaction with a shared `batchId`.
3. Queues all invitation emails via `@eks/notifications` (rate-limited per provider).
4. Returns a `batchId` the inviter can use to track status (`GET /api/v1/invitations/batches/{batchId}`).

Bulk invitations are audited as one `ORG_INVITATION_BULK_SENT` row with the count and `batchId`, plus one `ORG_INVITATION_SENT` per recipient.

---

## 7. Membership History

Every Membership lifecycle transition is recorded immutably. The `AuditLog` rows for `MEMBERSHIP_*` actions are the source of truth for "who joined when, who changed their role, who removed them".

| Audit action | When | Key metadata |
|---|---|---|
| `MEMBERSHIP_INVITED` | Invitation sent | `invitedEmail`, `roleSlug`, `invitedBy` |
| `MEMBERSHIP_ACCEPTED` | Recipient accepts invitation | `userId`, `roleSlug`, `acceptedBy` |
| `MEMBERSHIP_ADDED_DIRECT` | Admin adds user directly (no invitation) | `userId`, `roleSlug`, `addedBy` |
| `MEMBERSHIP_ROLE_CHANGED` | Role changed | `previousRole`, `newRole`, `changedBy` |
| `MEMBERSHIP_REVOKED` | Membership revoked | `userId`, `revokedBy`, `reason` |
| `MEMBERSHIP_REACTIVATED` | Revoked membership re-activated (rare) | `userId`, `reactivatedBy` |
| `MEMBERSHIP_LEFT` | User self-removes | `userId` |

The `Membership` row itself carries the current state; the `AuditLog` records the history. The `GET /api/v1/memberships/{id}/history` endpoint reconstructs the chronological history from the audit log:

```
200 OK
{ data: [
  { at: "2025-01-10T09:00Z", action: "MEMBERSHIP_INVITED",
    actor: "user_kofi",  detail: "Invited as manager" },
  { at: "2025-01-10T11:30Z", action: "MEMBERSHIP_ACCEPTED",
    actor: "user_amara", detail: "Accepted invitation" },
  { at: "2025-01-20T14:00Z", action: "MEMBERSHIP_ROLE_CHANGED",
    actor: "user_kofi",  detail: "manager → admin" },
  { at: "2025-02-01T08:00Z", action: "MEMBERSHIP_LEFT",
    actor: "user_amara", detail: "Self-removed" }
]}
```

### 7.1 Membership record

```prisma
model Membership {
  id              String   @id @default(cuid())
  organizationId  String
  userId          String
  teamId          String?
  roleSlug        String   // owner | admin | manager | member | viewer | team_lead | team_member
  status          String   @default("INVITED") // INVITED | ACTIVE | REVOKED
  invitedAt       DateTime @default(now())
  activatedAt     DateTime?
  revokedAt       DateTime?
  revokedBy       String?
  revokeReason    String?
  // Audit
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, userId, teamId])  // one membership per (org, user, team)
  @@index([userId, status])
  @@index([organizationId, status])
}
```

A user may have multiple Memberships in the same org (one org-level + N team-level). The org-level Membership's `roleSlug` determines their org-wide permissions; each team-level Membership's `roleSlug` determines their team-scoped permissions.

---

## 8. Organization Provisioning Flow

The end-to-end flow when a new organization is created:

```
Founder (auth'd user)
   │
   ▼
POST /api/v1/organizations
  { name, slug, type: "restaurant", country: "GH", plan: "eks.starter" }
   │
   ▼
① Authorize: any authenticated user can create an org (becomes its owner).
② Validate slug uniqueness.
③ Look up OrganizationType by code.
④ BEGIN TX
    INSERT Organization {
      status: PENDING_VERIFICATION (if type.requiresVerification) or ACTIVE,
      ownerId: principal.userId,
      plan: type.defaultPlan,
      entitlementsJson: type.defaultEntitlementsJson,
      …
    }
    INSERT TenantConfiguration {
      organizationId: …, defaultLocale: "en", defaultCurrency: "GHS", …
    }
    INSERT Membership {
      organizationId: …, userId: principal.userId,
      roleSlug: "owner", status: ACTIVE, activatedAt: now
    }
    INSERT FeatureFlagAssignment rows for type.defaultFeatureFlagsJson
    stage organization.provisioned.v1
    stage organization.member.added.v1 { userId, roleSlug: "owner" }
    audit(ORG_CREATED, actor=principal.userId)
  COMMIT
⑤ If type.requiresVerification: queue VerificationRequest (business license).
⑥ @eks/notifications → welcome email to owner.
⑦ Return 201 { organization, membership }
```

After provisioning:
- The owner can immediately invite members (regardless of org status — invitations are queued and only become usable when the org is `ACTIVE`).
- The owner can configure the org (`TenantConfiguration`, feature flags) but cannot book/pay until `ACTIVE` (the `OrgStatusGuard` rejects state-changing business requests).

---

## 9. Cross-References

| Topic | Document |
|---|---|
| Tenant isolation mechanics, tenant-switch flow, data residency | `MULTI_TENANCY.md` |
| Org roles, team roles, policy inheritance | `AUTHORIZATION_POLICIES.md` |
| Audit log entries for `ORG_*`, `MEMBERSHIP_*` | `AUDIT_AND_COMPLIANCE.md` |
| Organizations / Memberships / Invitations REST API | `API_REFERENCE.md` |
| Verification flow (business-license verification for activation) | `VERIFICATION.md` |
