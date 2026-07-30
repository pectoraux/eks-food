# Eks-Food Customer Platform — Household Model Guide

> **Audience:** Platform engineers, full-stack engineers, product managers, privacy reviewers. Read alongside `PLATFORM_ARCHITECTURE.md`, `PRIVACY_PERMISSIONS_GUIDE.md`, and the M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` (canonical `Household` definition).
>
> **Status:** Milestone 8 (Customer Platform). This document specifies the target household model: `Household` (extended), `HouseholdMember`, and `HouseholdRelationship` Prisma models. It supersedes the M6 minimal `Household` (name + address JSON + status) and the M6 `CustomerProfile.householdId` scalar with a full many-to-many membership model.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- Model **six real-world household types** without forcing them into a single shape: `FAMILY`, `ROOMMATES`, `APARTMENT`, `OFFICE`, `SHARED_KITCHEN`, `INSTITUTION`.
- Support **multiple household memberships per customer**. A customer may belong to their family home (ADMIN), their shared apartment (ROOMMATE), and their office kitchen (GUEST) simultaneously, each with its own role, permissions, and preference context.
- Support **five member roles** with distinct permission envelopes: `ADMIN`, `GUARDIAN`, `DEPENDENT`, `GUEST`, `CAREGIVER`.
- Maintain **auditable relationship history** — every relationship (`SPOUSE`, `PARENT`, `CHILD`, `ROOMMATE`, `COLLEAGUE`, `CAREGIVER_FOR`, `GUARDIAN_OF`) carries `validFrom`/`validTo` so historical graphs can be reconstructed as-of any past date.
- **Household-to-organization links** for institutional households (office kitchen, school cafeteria, hospital ward) so the M2 `Organization` RBAC can apply alongside household RBAC.
- **Bidirectional graph projection** — every membership and relationship is mirrored as an M6 `GraphNode`/`GraphEdge` so the M6 `GraphEngine.traverse` can compute "all households reachable from customer X within 2 hops" for contact tracing and household-level recommendations.

### 1.2 Non-Goals

- Friend-of-friend social graph (M8 is household-scoped, not social-network-scoped).
- Real-time cohabitation verification (no IoT integration to detect physical presence).
- Multi-household preference reconciliation (M9+ concern — M8 stores per-household preferences; conflict resolution across households is the customer's UI choice).
- Household-level payment methods (those live in M1 `PayswapPayment` tied to the M2 `User`, not the household).

---

## 2. Household Types

The `Household.householdType` discriminator drives default member roles, permission templates, and UI affordances.

| `householdType` | Example | Default admin role | Allows dependents? | Allows guests? | Multi-org? |
|---|---|:---:|:---:|:---:|:---:|
| `FAMILY` | Nuclear or extended family in one residence | `ADMIN` (parent) | yes | yes (grandparent visits, nanny) | no |
| `ROOMMATES` | 2–6 unrelated adults sharing rent | `ADMIN` (rotating or leaseholder) | no | yes (guests for events) | no |
| `APARTMENT` | Single tenant or couple in a self-contained unit | `ADMIN` (sole tenant) | yes | yes | no |
| `OFFICE` | Coworkers sharing an office pantry/kitchen | `ADMIN` (office manager) | no | yes (visitors, contractors) | yes (office may be multi-org) |
| `SHARED_KITCHEN` | Commercial shared-use kitchen (cook collective, ghost kitchen) | `ADMIN` (kitchen operator) | no | yes (transient cooks) | yes |
| `INSTITUTION` | School, hospital, dormitory, care home | `ADMIN` (facility manager) | yes (students, patients) | yes (visitors) | yes |

`INSTITUTION` and `OFFICE` households **must** link to an `Organization` via `Household.organizationId` (which becomes a foreign key to M2 `Organization`, not just the tenant isolation key). For these types, the M2 organization RBAC layers on top of the household RBAC — a facility manager (`manager` role in the org) automatically has `ADMIN` permissions in the institution household.

---

## 3. Data Model

### 3.1 `Household` (M8 extended from M6)

```
model Household {
  id              String   @id @default(cuid())
  organizationId  String                     // M2 tenant isolation key
  name            String                     // display name, e.g. "The Mensah Family"
  householdType   String   @default("FAMILY") // FAMILY|ROOMMATES|APARTMENT|OFFICE|SHARED_KITCHEN|INSTITUTION
  defaultAddressId String?                   // FK → Address (the household's primary delivery address)
  kitchenShared   Boolean  @default(false)   // true if multiple members share cooking responsibility
  // Institutional linkage
  linkedOrganizationId String?               // FK → Organization (required for OFFICE/SHARED_KITCHEN/INSTITUTION)
  // Canonical graph linkage (M6)
  graphNodeId     String?                    // FK → GraphNode (type="household")
  // Lifecycle
  status          String   @default("ACTIVE") // ACTIVE|INACTIVE|DISSOLVED
  dissolvedAt     DateTime?
  dissolvedReason String?                    // MERGED|SPLIT|MOVED_OUT|DISPUTED
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  defaultAddress  Address?          @relation(fields: [defaultAddressId], references: [id])
  linkedOrganization Organization?  @relation(fields: [linkedOrganizationId], references: [id])
  members         HouseholdMember[]
  relationships   HouseholdRelationship[] @relation("HouseholdRelationship_From")
  relationshipsTo HouseholdRelationship[] @relation("HouseholdRelationship_To")

  @@index([organizationId])
  @@index([householdType, status])
  @@index([linkedOrganizationId])
}
```

### 3.2 `HouseholdMember`

```
model HouseholdMember {
  id              String   @id @default(cuid())
  organizationId  String
  householdId     String
  profileId       String                     // FK → CustomerProfile
  role            String   @default("MEMBER") // ADMIN|GUARDIAN|DEPENDENT|GUEST|CAREGIVER
  // Invitation trail
  invitedByMemberId String?                  // FK → HouseholdMember (the inviter)
  invitedAt       DateTime?
  acceptedAt      DateTime?
  // Lifecycle
  status          String   @default("PENDING") // PENDING|ACTIVE|DEPARTED|REMOVED
  joinedAt        DateTime?
  departedAt      DateTime?
  departedReason  String?                    // MOVED_OUT|INVITED_ELSEWHERE|REMOVED_BY_ADMIN|HOUSEHOLD_DISSOLVED
  removalReason   String?
  removedByMemberId String?
  // Re-join trail
  rejoinedFromId  String?                    // prior HouseholdMember.id if this is a re-join
  // Permissions snapshot (denormalized for fast authZ checks)
  permissionsSnapshot String @default("[]")  // JSON array of permission codes granted by this role
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  household       Household       @relation(fields: [householdId], references: [id])
  profile         CustomerProfile @relation(fields: [profileId], references: [id])
  invitedBy       HouseholdMember? @relation("HouseholdMember_InvitedBy", fields: [invitedByMemberId], references: [id])
  removedBy       HouseholdMember? @relation("HouseholdMember_RemovedBy", fields: [removedByMemberId], references: [id])

  @@unique([householdId, profileId, status])  // one active membership per (household, profile)
  @@index([organizationId])
  @@index([householdId, status])
  @@index([profileId, status])
  @@index([role, status])
}
```

### 3.3 `HouseholdRelationship`

A directed relationship between two members of the same household (or across households for `CAREGIVER_FOR` / `GUARDIAN_OF` cases involving cross-household care).

```
model HouseholdRelationship {
  id              String   @id @default(cuid())
  organizationId  String
  fromMemberId    String                     // the subject (e.g. the parent)
  toMemberId      String                     // the object (e.g. the child)
  toHouseholdId   String?                    // for cross-household relationships (e.g. caregiver in another household)
  relationshipType String                    // SPOUSE|PARENT|CHILD|SIBLING|ROOMMATE|COLLEAGUE|CAREGIVER_FOR|GUARDIAN_OF|DEPENDENT_OF
  // Temporal validity (M6 canonical Relationship pattern)
  validFrom       DateTime   @default(now())
  validTo         DateTime?                  // NULL = currently active
  endedReason     String?                    // DIVORCED|EMANCIPATED|MOVED_OUT|DECEASED|REVOKED
  // Graph linkage
  graphEdgeId     String?                    // FK → GraphEdge (type="family"|"roommate"|"caregiver")
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  fromMember      HouseholdMember @relation("HouseholdRelationship_From", fields: [fromMemberId], references: [id])
  toMember        HouseholdMember @relation("HouseholdRelationship_To", fields: [toMemberId], references: [id])
  toHousehold     Household?      @relation("HouseholdRelationship_ToHousehold", fields: [toHouseholdId], references: [id])

  @@unique([fromMemberId, toMemberId, relationshipType, validFrom])
  @@index([organizationId])
  @@index([fromMemberId, validTo])
  @@index([toMemberId, validTo])
  @@index([relationshipType, validTo])
}
```

---

## 4. Member Roles & Permissions

The five member roles form a permission envelope. Roles are household-scoped — being `ADMIN` in Household A grants nothing in Household B. The envelope is denormalized into `HouseholdMember.permissionsSnapshot` for O(1) authZ checks.

### 4.1 Role Catalogue

| Role | Slug | Typical holder | Can invite? | Can remove? | Can manage prefs of others? | Can dissolve household? |
|---|---|---|:---:|:---:|:---:|:---:|
| Admin | `ADMIN` | Family parent, leaseholder, office manager | yes (any role) | yes (any non-admin) | yes (all members) | yes (with co-admin or org approval) |
| Guardian | `GUARDIAN` | Parent of a dependent, legal guardian, adult child of elderly parent | yes (dependents, caregivers, guests) | yes (dependents they manage, caregivers they invited) | yes (their dependents only) | no |
| Dependent | `DEPENDENT` | Minor child, elderly parent under guardianship, person under legal guardianship | no | no | no | no |
| Guest | `GUEST` | Visitor, temp subletter, party guest | no | no | no | no |
| Caregiver | `CAREGIVER` | Nanny, home nurse, private chef | no | no | no (but can record meals served to dependents) | no |

### 4.2 Permission Matrix (per-role)

The `permissionsSnapshot` JSON array contains permission codes from the M8 `HOUSEHOLD_PERMISSIONS` registry. Codes follow the `household.{domain}.{action}` convention.

| Permission code | ADMIN | GUARDIAN | DEPENDENT | GUEST | CAREGIVER |
|---|:---:|:---:|:---:|:---:|:---:|
| `household.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `household.update` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `household.dissolve` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `household.member.invite` | ✓ | ✓ (limited) | ✗ | ✗ | ✗ |
| `household.member.remove` | ✓ | ✓ (limited) | ✗ | ✗ | ✗ |
| `household.member.role.change` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `household.preferences.read.self` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `household.preferences.read.others` | ✓ | ✓ (dependents) | ✗ | ✗ | ✗ |
| `household.preferences.write.self` | ✓ | ✓ | ✓ (gated by child-safety) | ✗ | ✗ |
| `household.preferences.write.others` | ✓ | ✓ (dependents) | ✗ | ✗ | ✗ |
| `household.meal_plan.read` | ✓ | ✓ | ✓ | ✗ | ✓ (read-only) |
| `household.meal_plan.write` | ✓ | ✓ | ✓ (gated) | ✗ | ✓ (limited to meals they prepare) |
| `household.pantry.read` | ✓ | ✓ | ✓ | ✗ | ✓ |
| `household.pantry.write` | ✓ | ✓ | ✓ (gated) | ✗ | ✓ (consumption only) |
| `household.shopping_list.read` | ✓ | ✓ | ✓ | ✗ | ✓ |
| `household.shopping_list.write` | ✓ | ✓ | ✓ (gated) | ✗ | ✓ |
| `household.review.write` | ✓ | ✓ | ✓ (gated, no public reviews under 13) | ✗ | ✗ |
| `household.review.moderate` | ✓ (org admin only) | ✗ | ✗ | ✗ | ✗ |
| `household.audit.read` | ✓ | ✓ (their dependents' audit) | ✓ (own audit) | ✗ | ✗ |
| `household.privacy.export` | ✓ | ✓ (dependents) | ✓ (self, if age ≥ 16) | ✗ | ✗ |

The `permissionsSnapshot` is recomputed on every role change, organization policy change, or feature flag flip. Stale snapshots are detected by a daily reconciliation job (`HouseholdPermissionSnapshotReconciler`) that compares the snapshot to the live computed set and writes an audit entry if drift is found.

### 4.3 Child-Safety Gating

`DEPENDENT` rows where the linked `CustomerProfile.isMinor = true` (derived from `dateOfBirth`) receive a reduced permission set regardless of role. Specifically:

- `household.review.write` is removed (no public reviews from minors).
- `household.preferences.write.self` requires guardian co-sign (the API writes the preference with `metadata.cosignedBy = guardianMemberId`).
- `household.privacy.export` requires guardian request.
- `household.meal_plan.write` is allowed for planning only (no shopping list write — see `PRIVACY_PERMISSIONS_GUIDE.md` §4).

The `HouseholdPermissionResolver` (`@eks/customer/permissions.ts`) enforces this at runtime; the `permissionsSnapshot` includes the gating flag so the UI can show appropriate affordances.

---

## 5. Multiple Household Memberships

A `CustomerProfile` may have multiple **active** `HouseholdMember` rows — one per household. The `CustomerProfile.householdId` (M6) remains as the **primary household** (used for default context in the UI, default delivery address resolution, and default preference resolution). Secondary memberships are listed via `GET /api/v1/customer/profiles/:id/memberships`.

Membership context is selected via the `x-eks-household` request header (M8 convention). All household-scoped API calls require this header; the `HouseholdPermissionResolver` checks the caller's `HouseholdMember` row in that household before any operation.

### 5.1 Cross-Household Relationships

The `HouseholdRelationship.toHouseholdId` column (nullable) enables relationships that span households. The canonical use case is a caregiver (`CAREGIVER` role in Household A, the cared-for person's household) who is themselves a member of Household B (their own family home). The `CAREGIVER_FOR` relationship from Household A's member to Household A's dependent lives entirely within Household A; the caregiver's Household B membership is independent.

Cross-household relationships are restricted to `CAREGIVER_FOR` and `GUARDIAN_OF` types. `SPOUSE`, `PARENT`, `CHILD`, `SIBLING` must be within the same household (the API rejects cross-household variants with `CUSTOMER_RELATIONSHIP_INVALID_CROSS_HOUSEHOLD`).

### 5.2 Multi-Org Institutional Households

For `OFFICE`, `SHARED_KITCHEN`, and `INSTITUTION` household types, members may come from different `organizationId` tenants (e.g. a shared commercial kitchen used by cooks from three different restaurant orgs). The `HouseholdMember.organizationId` matches the household's `organizationId` (the host org), while `CustomerProfile.organizationId` retains the member's home org. The M2 tenant isolation invariant (M2 `MULTI_TENANCY.md` §2) is preserved: queries that lead with `HouseholdMember.organizationId` never leak across the host-org boundary.

---

## 6. Relationship History (Auditable)

Every `HouseholdRelationship` row is **append-only**: changes to a relationship (divorce, emancipation, move-out) do not mutate the existing row — they set `validTo` and a new row with the new state is created if applicable. This pattern mirrors the M6 canonical `Relationship` model and the M7 `EntityVersion` snapshot pattern.

### 6.1 Relationship Types

| `relationshipType` | Direction | Example | Ends on |
|---|---|---|---|
| `SPOUSE` | symmetric (recorded once: fromMember = spouse A, toMember = spouse B) | married/partnered couple | divorce, death |
| `PARENT` | fromMember is parent of toMember | parent → child | emancipation, death |
| `CHILD` | fromMember is child of toMember (inverse of PARENT, recorded for query convenience) | child → parent | emancipation, death |
| `SIBLING` | symmetric | brother/sister | death (lifelong by default) |
| `ROOMMATE` | symmetric | co-tenant | move-out |
| `COLLEAGUE` | symmetric | office kitchen co-user | employment end |
| `CAREGIVER_FOR` | fromMember is caregiver of toMember | nanny → child | employment end |
| `GUARDIAN_OF` | fromMember is legal guardian of toMember | guardian → dependent | emancipation, court order |
| `DEPENDENT_OF` | inverse of GUARDIAN_OF | dependent → guardian | emancipation, court order |

### 6.2 History Reconstruction

The `HouseholdService.getRelationshipHistory(memberId)` query returns the chronological sequence of relationship states for a member:

```sql
SELECT id, fromMemberId, toMemberId, relationshipType, validFrom, validTo, endedReason, createdBy, createdAt
FROM HouseholdRelationship
WHERE (fromMemberId = :memberId OR toMemberId = :memberId)
  AND organizationId = :orgId
ORDER BY validFrom DESC, createdAt DESC;
```

This is the query the M8 `PrivacyService.export` calls when producing a customer's GDPR data export (see `PRIVACY_PERMISSIONS_GUIDE.md` §6).

### 6.3 Graph Projection

On every relationship create/end, the `HouseholdService` emits a `HouseholdRelationship.Created` or `.Ended` domain event. The M1 `@eks/workers` consumer projects the change to the M6 `GraphEdge` table:

- **Create**: `GraphEdge.type = "family" | "roommate" | "caregiver"`, `fromId = fromMember.graphNodeId`, `toId = toMember.graphNodeId`, `validFrom = relationship.validFrom`, `validTo = NULL`.
- **End**: `GraphEdge.validTo = NOW()` (no hard delete — temporal graph queries can reconstruct past state).

This enables queries like "find all households containing a sibling of customer X" via the M6 `GraphEngine.traverse(startNode, depth, edgeTypes)`.

---

## 7. Household Lifecycle

### 7.1 Creation → Invitation → Acceptance

```
1. POST /api/v1/customer/households
   ├─ Creates Household row (status=ACTIVE)
   ├─ Creates HouseholdMember row for the creator (role=ADMIN, status=ACTIVE, joinedAt=now)
   ├─ Creates GraphNode (type="household")
   ├─ Emits Household.Created + HouseholdMember.Joined events
   └─ Writes CUSTOMER_HOUSEHOLD_CREATED audit action

2. POST /api/v1/customer/households/:id/members
   ├─ Creates HouseholdMember row (status=PENDING, invitedAt=now, invitedByMemberId=caller)
   ├─ Sends M2 VerificationRequest (email/SMS via M5 NotificationConnector)
   ├─ Emits HouseholdMember.Invited event
   └─ Writes CUSTOMER_HOUSEHOLD_MEMBER_INVITED audit action

3. POST /api/v1/customer/households/:id/members/:memberId/accept
   ├─ Updates HouseholdMember.status=ACTIVE, acceptedAt=now, joinedAt=now
   ├─ Recomputes permissionsSnapshot
   ├─ Emits HouseholdMember.Joined event
   └─ Writes CUSTOMER_HOUSEHOLD_MEMBER_JOINED audit action
```

### 7.2 Role Changes

```
PATCH /api/v1/customer/households/:id/members/:memberId
  body: { role: "GUARDIAN" }

  ├─ Caller must have household.member.role.change permission (ADMIN)
  ├─ Cannot demote the last ADMIN (CUSTOMER_HOUSEHOLD_LAST_ADMIN error)
  ├─ Cannot promote a DEPENDENT to ADMIN if isMinor=true (CUSTOMER_CHILD_SAFETY_VIOLATION)
  ├─ Updates HouseholdMember.role, increments version
  ├─ Recomputes permissionsSnapshot
  ├─ Emits HouseholdMember.RoleChanged event
  └─ Writes CUSTOMER_HOUSEHOLD_MEMBER_ROLE_CHANGED audit action (with oldRole, newRole)
```

### 7.3 Departure / Removal

```
DELETE /api/v1/customer/households/:id/members/:memberId
  body: { reason: "MOVED_OUT" | "REMOVED_BY_ADMIN" | "INVITED_ELSEWHERE" | ... }

  ├─ Caller must have household.member.remove permission OR be the member themselves (self-departure)
  ├─ If self-departure: departedReason="MOVED_OUT", status=DEPARTED, departedAt=now
  ├─ If admin removal: departedReason="REMOVED_BY_ADMIN", status=REMOVED, removalReason, removedByMemberId=caller
  ├─ Ends all active HouseholdRelationship rows involving this member (validTo=now)
  ├─ Ends all GraphEdges involving this member's graphNodeId
  ├─ If member was ADMIN and other admins remain: no further action
  ├─ If member was the last ADMIN: household requires dissolution or admin transfer (CUSTOMER_HOUSEHOLD_LAST_ADMIN error)
  ├─ Emits HouseholdMember.Departed or .Removed event
  └─ Writes CUSTOMER_HOUSEHOLD_MEMBER_DEPARTED or _REMOVED audit action
```

The `HouseholdMember` row is never hard-deleted. Departed/removed members remain queryable for audit and history purposes but lose all permissions (their `permissionsSnapshot` is set to `[]`).

### 7.4 Household Dissolution

```
DELETE /api/v1/customer/households/:id
  body: { reason: "MERGED" | "SPLIT" | "MOVED_OUT" | "DISPUTED" }

  ├─ Caller must have household.dissolve permission (ADMIN, with co-admin or org approval for INSTITUTION type)
  ├─ For INSTITUTION households: requires linked Organization.owner approval
  ├─ Ends all active HouseholdMember rows (status=DEPARTED, departedReason="HOUSEHOLD_DISSOLVED")
  ├─ Ends all active HouseholdRelationship rows (validTo=now, endedReason="HOUSEHOLD_DISSOLVED")
  ├─ Ends all GraphEdges from the household's graphNodeId
  ├─ Sets Household.status=DISSOLVED, dissolvedAt=now, dissolvedReason
  ├─ Soft-deletes all Pantry, ShoppingList, MealPlan rows (deletedAt=now, retained for audit window)
  ├─ CustomerProfile.householdId references are cleared (NULL); members with no other household become "unaffiliated"
  ├─ Emits Household.Dissolved event
  └─ Writes CUSTOMER_HOUSEHOLD_DISSOLVED audit action
```

Dissolution is reversible within 30 days via `POST /api/v1/customer/households/:id/restore` (admin-only, requires org approval). After 30 days, the soft-deleted rows are hard-purged by the daily `HouseholdPurgeJob` (M1 cron).

---

## 8. Household-to-Organization Links

For `OFFICE`, `SHARED_KITCHEN`, and `INSTITUTION` household types, `Household.linkedOrganizationId` must be set. The link:

- Grants the linked org's `owner` and `admin` roles implicit `ADMIN` permission in the household (computed at `permissionsSnapshot` build time).
- Allows org-level audit queries (an org admin can list all households linked to their org via `GET /api/v1/customer/households?linkedOrganizationId=:orgId`).
- Subjects the household to the org's data retention policy (M2 `TenantConfiguration.customerDataRetentionDays`).
- Makes the household eligible for org-level reporting (operational dashboards — see `OPERATIONAL_RUNBOOKS.md` §3).

For `FAMILY`, `ROOMMATES`, `APARTMENT` household types, `linkedOrganizationId` is `NULL` — these are pure-customer households. The household's `organizationId` still identifies the tenant (Eks-Food operating region) for isolation purposes.

---

## 9. Permission Resolution Algorithm

The `HouseholdPermissionResolver.resolve(memberId, permission)` algorithm (in `@eks/customer/permissions.ts`):

```
1. Load HouseholdMember row (with .household, .profile).
2. If status != ACTIVE → return { allowed: false, reason: "MEMBER_NOT_ACTIVE" }.
3. Check the member's permissionsSnapshot array for the requested permission code.
   a. If present → return { allowed: true, reason: "ROLE_GRANTED" }.
   b. If absent → continue to step 4.
4. Check child-safety gating:
   a. If profile.isMinor=true AND permission is in CHILD_BLOCKED_PERMISSIONS set → return { allowed: false, reason: "CHILD_SAFETY_BLOCK" }.
5. Check linked organization RBAC (if household.linkedOrganizationId is set):
   a. Load the user's Membership in the linked org.
   b. If role is owner or admin → check if permission is in ORG_ADMIN_IMPLICIT_PERMISSIONS set.
   c. If yes → return { allowed: true, reason: "ORG_ADMIN_IMPLICIT" }.
6. Check feature flags:
   a. Load active FeatureFlagAssignment rows for the org.
   b. If a flag explicitly grants the permission → return { allowed: true, reason: "FEATURE_FLAG_GRANT" }.
   c. If a flag explicitly denies the permission → return { allowed: false, reason: "FEATURE_FLAG_DENY" }.
7. Return { allowed: false, reason: "NOT_GRANTED" }.
```

The resolver returns an explainable denial (matching the M2 `AUTHORIZATION_POLICIES.md` §1.3 design principle). The `reason` field flows through to the RFC 7807 `problem+json` `details.rule` field on `403 Forbidden` responses.

---

## 10. API Examples

### 10.1 Create a family household with two members

```http
POST /api/v1/customer/households
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
Idempotency-Key: hh-mensah-001

{
  "name": "The Mensah Family",
  "householdType": "FAMILY",
  "defaultAddressId": "addr-east-legon-01",
  "kitchenShared": true
}
```

Response `201 Created`:
```json
{
  "id": "hh-mensah-01",
  "name": "The Mensah Family",
  "householdType": "FAMILY",
  "status": "ACTIVE",
  "members": [
    { "id": "hm-kwame", "profileId": "prof-kwame", "role": "ADMIN", "status": "ACTIVE" }
  ]
}
```

### 10.2 Invite a dependent (child)

```http
POST /api/v1/customer/households/hh-mensah-01/members
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01

{
  "profileId": "prof-ama",
  "role": "DEPENDENT",
  "dateOfBirth": "2015-04-12"
}
```

Response `201 Created` (member `status=PENDING`, child-safety gating applied):
```json
{
  "id": "hm-ama",
  "profileId": "prof-ama",
  "role": "DEPENDENT",
  "status": "PENDING",
  "permissionsSnapshot": [
    "household.read",
    "household.preferences.read.self",
    "household.preferences.write.self",  // gated: requires guardian co-sign
    "household.meal_plan.read",
    "household.pantry.read",
    "household.shopping_list.read"
    // note: no review.write, no privacy.export, no member.invite
  ],
  "childSafetyGated": true
}
```

### 10.3 Record a parent-child relationship

```http
POST /api/v1/customer/households/hh-mensah-01/relationships
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01

{
  "fromMemberId": "hm-kwame",
  "toMemberId": "hm-ama",
  "relationshipType": "PARENT"
}
```

Response `201 Created`:
```json
{
  "id": "rel-kwame-ama-01",
  "fromMemberId": "hm-kwame",
  "toMemberId": "hm-ama",
  "relationshipType": "PARENT",
  "validFrom": "2025-01-15T10:30:00Z",
  "validTo": null,
  "graphEdgeId": "ge-family-001"
}
```

---

## 11. Cross-References

- `PLATFORM_ARCHITECTURE.md` §3.2 — household bounded context overview.
- `PRIVACY_PERMISSIONS_GUIDE.md` §3 — full permission matrix with child-safety gating.
- `PRIVACY_PERMISSIONS_GUIDE.md` §4 — child privacy protections in detail.
- `PREFERENCE_INTELLIGENCE_GUIDE.md` §5 — household-level preference resolution.
- `MEAL_PLANNING_GUIDE.md` §4 — household meal plans vs. member meal plans.
- `PANTRY_MANAGEMENT_GUIDE.md` §3 — pantry-per-household vs. pantry-per-member.
- M2 `docs/identity/MULTI_TENANCY.md` — `organizationId` isolation invariant.
- M2 `docs/identity/AUTHORIZATION_POLICIES.md` — RBAC+ABAC layers M8 household permissions extend.
- M2 `docs/identity/ORGANIZATIONS.md` — `Organization`, `Membership`, `Team` definitions for institutional households.
- M2 `docs/identity/VERIFICATION.md` — `VerificationRequest` flow used for member invitations.
- M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` §3 — canonical `Household` model M8 extends.
- M6 `docs/food-domain/ENTITY_RELATIONSHIPS.md` — `member_of` graph edge type.
- M6 `docs/food-domain/GRAPH_ARCHITECTURE.md` — `GraphEngine.traverse` for household relationship queries.
