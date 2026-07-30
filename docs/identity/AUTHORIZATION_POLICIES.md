# Eks-Food IAM — Authorization Policies

> **Audience:** Identity engineers, security reviewers, feature engineers writing new `authorize()` calls. Read alongside `ARCHITECTURE.md` (§5 Authorization Model), `MULTI_TENANCY.md` (the scope invariant), and `API_REFERENCE.md` (the `required permission` column).
>
> **Status:** M2 target architecture. The M1 RBAC foundation (`src/packages/security/rbac.ts`) ships a typed `PERMISSIONS` registry and `authorize(principal, permission)` helper. M2 layers ABAC policies, policy inheritance, conditional permissions, and explainable denials on top.

---

## 1. Design Principles

1. **Deny by default.** No permission ⇒ no access. No policy ⇒ no access. Every `false` decision carries a stable machine-readable reason.
2. **Single source of truth.** The `Permission` registry in `@eks/authorization` is the canonical list of permission codes. The M1 `PERMISSIONS` map in `src/packages/security/rbac.ts` is regenerated from this registry at build time so the two cannot drift.
3. **Explainable denials.** Every `403 Forbidden` returns RFC 7807 `problem+json` with `code=AUTHZ_*` and `details.rule` describing which layer denied and why. The same `reason` is written to the audit log.
4. **Composability, not inheritance.** A role is a named bundle of permissions. Policies attach conditions to (role, permission) pairs. There is no role inheritance in the data model — instead, a higher role (e.g. `ADMIN`) is defined as a superset of the lower role (`MEMBER`) by simply listing all the lower role's permissions plus more.
5. **Tenant-bound.** Every permission grant is scoped to a tenant. `SUPER_ADMIN` and `SUPPORT` are the only global roles; they are granted via the global `Membership` table (`organizationId=null`).
6. **Least privilege.** New roles start with the minimum permission set. Adding a permission to a role requires a security review and is audited as `ROLE_PERMISSION_ADDED`.

---

## 2. Role Catalogue

### 2.1 Global roles
These are platform-wide roles assigned via `Membership` rows where `organizationId IS NULL`. They span every tenant.

| Role | Slug | Granted to | Key permissions |
|---|---|---|---|
| Super Admin | `super_admin` | Eks-Food founders + on-call security leads | Every permission, including `auth.impersonate`, `org.delete`, `policy.write`, `user.role.grant` for any role. |
| Support | `support` | Customer-support agents | `user.read`, `booking.read`, `payment.read`, `session.revoke`, `mfa.reset` (with second approver), `audit.read`. Cannot write business data or grant roles. |

Both global roles require MFA (enforced by `EKS_AUTH_MFA_REQUIRED_ROLES`). Both have all sessions tagged with `riskScoreBaseline=50` so any anomaly immediately crosses the 70 step-up threshold.

### 2.2 Organization roles
Five canonical roles per organization, mirroring the kitchen/restaurant org hierarchy:

| Role | Slug | Typical holder | Hierarchy level |
|---|---|---|---|
| Owner | `owner` | The person who created the org or was transferred ownership | 1 (highest) |
| Admin | `admin` | Org administrator (operations lead) | 2 |
| Manager | `manager` | Region / branch manager | 3 |
| Member | `member` | Cook, customer, rider — any active participant | 4 |
| Viewer | `viewer` | Read-only accountant, observer | 5 (lowest) |

Each role's permission set is the union of its own grants plus everything the roles below it grant. The level column is a documentation aid; the data model is a flat `Role.permissionCodes` array (see `RoleAggregate` in `src/packages/domain/contexts/identity/aggregates.ts`).

| Permission (sample) | viewer | member | manager | admin | owner |
|---|:---:|:---:|:---:|:---:|:---:|
| `booking.read` (own) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `booking.read` (any in org) | ✗ | ✗ | ✓ | ✓ | ✓ |
| `booking.create` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `booking.assign` | ✗ | ✗ | ✓ | ✓ | ✓ |
| `booking.cancel` | ✗ | ✓ | ✓ | ✓ | ✓ |
| `cook.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `cook.manage` | ✗ | ✗ | ✓ | ✓ | ✓ |
| `payment.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `payment.refund` | ✗ | ✗ | ✗ | ✓ | ✓ |
| `payment.payout` | ✗ | ✗ | ✓ | ✓ | ✓ |
| `org.member.invite` | ✗ | ✗ | ✓ | ✓ | ✓ |
| `org.member.remove` | ✗ | ✗ | ✓ | ✓ | ✓ |
| `org.member.role.change` | ✗ | ✗ | ✗ | ✓ | ✓ |
| `org.config.write` | ✗ | ✗ | ✗ | ✓ | ✓ |
| `org.transfer_ownership` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `org.delete` | ✗ | ✗ | ✗ | ✗ | ✓ |
| `audit.read` (org) | ✗ | ✗ | ✓ | ✓ | ✓ |
| `audit.export` | ✗ | ✗ | ✗ | ✓ | ✓ |

### 2.3 Team roles
A `Team` is a sub-grouping inside an organization (e.g. "East Legon Cooks", "Inspection Team Accra"). Memberships exist at both org and team level. Team roles grant permissions **within the team's scope only** — they narrow, never broaden.

| Role | Slug | Notes |
|---|---|---|
| Team Lead | `team_lead` | Can assign bookings within the team, manage team rosters. Cannot invite new org members. |
| Team Member | `team_member` | Default team role. Inherits org `member` permissions but scoped to team resources. |

A user with `manager` at the org level **and** `team_lead` on Team X has both: org-wide permissions as manager, plus team-scoped team-lead permissions. The effective permission set is the **union**, then ABAC policies (§4) restrict the result.

---

## 3. Permission Registry

The registry lives in `@eks/authorization/permissions.ts` (M2). It is the canonical list; the M1 `PERMISSIONS` map in `src/packages/security/rbac.ts` is generated from it. Permissions follow the `{domain}.{action}` convention:

| Domain | Permissions |
|---|---|
| `auth` | `auth.login`, `auth.refresh`, `auth.logout`, `auth.impersonate` |
| `user` | `user.read`, `user.read.any` (cross-tenant), `user.update`, `user.delete`, `user.role.grant`, `user.role.revoke` |
| `org` | `org.create`, `org.read`, `org.update`, `org.delete`, `org.transfer_ownership`, `org.config.write`, `org.member.invite`, `org.member.remove`, `org.member.role.change`, `org.team.create`, `org.team.delete` |
| `booking` | `booking.read`, `booking.create`, `booking.assign`, `booking.cancel`, `booking.complete`, `booking.escalate` |
| `cook` | `cook.read`, `cook.manage`, `cook.cert.verify` |
| `payment` | `payment.initiate`, `payment.read`, `payment.refund`, `payment.payout` |
| `inspection` | `inspection.manage`, `inspection.read` |
| `analytics` | `analytics.read`, `analytics.export` |
| `mfa` | `mfa.enroll`, `mfa.disable`, `mfa.reset` (admin) |
| `session` | `session.read`, `session.revoke`, `session.revoke.any` |
| `audit` | `audit.read`, `audit.export` |
| `policy` | `policy.read`, `policy.write` |
| `role` | `role.read`, `role.write` |
| `feature_flag` | `feature_flag.read`, `feature_flag.write` |
| `ai` | `ai.assistant` (granted to all roles in M1) |

Every entry carries a `description`, `deprecated` flag, and `minimumRole` hint (documentation only — the actual role↔permission mapping is data, not code). The registry is exported as a `ReadonlyRecord<PermissionCode, PermissionDescriptor>` so TypeScript exhaustiveness checking catches missing cases.

---

## 4. ABAC Policy Model

A `Policy` row attaches conditions to a (principal role, permission) pair:

```prisma
model Policy {
  id              String   @id @default(cuid())
  organizationId  String?  // null = global policy
  // Which role + permission this policy restricts
  roleSlug        String   // e.g. "manager"
  permissionCode  String   // e.g. "booking.assign"
  // Condition expression — a small DSL evaluated by PolicyEvaluator
  // (see §5 for the grammar)
  condition       String
  // Effect: RESTRICT means "narrow the permission"; DENY means "block entirely"
  // (ALLOW is implicit when no policy fires; explicit ALLOW is M3)
  effect          String   @default("RESTRICT")
  // Audit
  createdAt       DateTime @default(now())
  createdBy       String?
  updatedAt       DateTime @updatedAt
  @@index([organizationId, roleSlug, permissionCode])
}
```

### 4.1 Condition grammar
The condition is a JSON object the `PolicyEvaluator` interprets. Supported rules:

| Rule | Meaning | Example |
|---|---|---|
| `ownership` | `resource.ownerId == actor.id` | Cooks can read their own bookings. |
| `hierarchy` | `resource.regionId in actor.managedRegionIds` | East-Legon manager can assign East-Legon bookings. |
| `scope` | `resource.organizationId == actor.activeTenantId` | Always-on default (enforced by `TenantContext`, this rule is redundant but explicit). |
| `team` | `resource.teamId in actor.teamIds` OR `resource.teamId IS NULL` | Team leads manage their team's bookings. |
| `time` | `now.time_of_day in [09:00, 17:00]` AND `now.weekday in [Mon..Fri]` | Refunds only during business hours. |
| `feature_flag` | `FeatureFlagService.isEnabled(flag, actor)` | Refunds only when `payment.refunds_enabled` is on. |
| `amount_lt` | `resource.amount < 5000` (GHS) | Managers can refund up to 5000 GHS; admins unlimited. |
| `status_in` | `resource.status in ["PENDING_MATCH", "ASSIGNED"]` | Booking can be reassigned only if in these states. |
| `resource_attr_eq` | `resource.<attr> == <value>` | Generic attribute equality. |
| `and` / `or` / `not` | Boolean composition | Combine the above. |

### 4.2 Effect semantics
- `RESTRICT` (default): the permission is granted only if the condition evaluates to `true`. If the condition is `false`, the decision is `deny("abac_<rule>_failed")`.
- `DENY`: the permission is blocked regardless of other rules. Used for hard blocks (e.g. "no one may delete an org with active bookings" — the policy `effect=DENY, condition={ status_in: ["ACTIVE"] }`).

`ALLOW` effects are not in M2 — every allow is implicit (no denying policy fired). Adding `ALLOW` (with explicit precedence over `RESTRICT`) is M3 to support break-glass scenarios.

---

## 5. Policy Evaluation Algorithm

`AuthorizationService.evaluate(request)` runs this pipeline:

```
INPUT: AuthorizationRequest { actorId, action, scope: { resource, resourceId, tenantId } }
OUTPUT: AuthorizationDecision

  1. Resolve Principal
     ─────────────────
     principal = principalBuilder.build(actorId, scope.tenantId)
       └─ loads Memberships (org + team + global)
       └─ loads Roles + Permissions for each membership
       └─ if no memberships → return deny("no_memberships")

  2. Permission grant check
     ──────────────────────
     if action not in principal.effectivePermissions:
       return deny("permission_not_granted", { permission: action })

  3. Tenant scope check
     ──────────────────
     if scope.tenantId is set and scope.tenantId != principal.activeTenantId:
       └─ exception: SUPER_ADMIN and SUPPORT may cross tenants
       return deny("abac_scope_mismatch", {
                resource_tenant: scope.tenantId,
                actor_tenant:    principal.activeTenantId })

  4. Load applicable policies
     ────────────────────────
     policies = policyRepo.findApplicable({
       organizationId: principal.activeTenantId,
       roleSlug:       principal.matchingRoleFor(action),
       permissionCode: action
     })
     └─ returns global policies + org-level policies (NOT team-level —
        team policies are merged into the role-resolution step)

  5. Evaluate each policy
     ────────────────────
     for policy in policies (ordered: global → org → team, deny-first):
       conditionResult = policyEvaluator.evaluate(policy.condition, {
         actor:    principal,
         resource: loadResource(scope.resource, scope.resourceId),
         now:      clock.now()
       })

       if policy.effect == "DENY":
         if conditionResult == true:
           return deny("abac_deny_rule", { rule: policy.id })
       else: # RESTRICT
         if conditionResult == false:
           return deny("abac_" + conditionResult.failedRule + "_failed",
                       { rule: policy.id, detail: conditionResult.detail })

  6. All checks pass → allow
     ──────────────────────
     return authorized=true, matchedPermissions=[action]
```

### 5.1 Resource loading
Step 5 requires loading the resource (the booking, the cook, the user). To avoid an N+1 problem, the `PolicyEvaluator` accepts a `ResourceLoader` that lazily fetches the resource **once** per evaluation and caches it on the request scope. If the resource does not exist (the caller passed a bad ID), the evaluator returns `deny("resource_not_found")` — never `allow`.

### 5.2 Explainable denial reasons
Every `deny` carries a `reason` string that is:

- **Stable** (the same code in every language).
- **Machine-parseable** (the prefix `abac_` identifies the layer).
- **Detailed** (the `details` object includes the rule ID and a human-readable `detail`).

The full catalogue:

| Reason code | Layer | Meaning |
|---|---|---|
| `no_memberships` | Principal | The actor has no Memberships in any tenant. |
| `permission_not_granted` | RBAC | The actor's roles do not include this permission. |
| `abac_scope_mismatch` | ABAC | Resource tenant ≠ actor tenant. |
| `abac_ownership_failed` | ABAC | `resource.ownerId != actor.id`. |
| `abac_hierarchy_failed` | ABAC | Resource region not in actor's managed regions. |
| `abac_team_failed` | ABAC | Resource team not in actor's teams. |
| `abac_time_failed` | ABAC | Outside the allowed time window. |
| `abac_feature_flag_failed` | ABAC | Required feature flag is off. |
| `abac_amount_lt_failed` | ABAC | Amount exceeds the policy ceiling. |
| `abac_status_in_failed` | ABAC | Resource status not in allowed set. |
| `abac_resource_attr_eq_failed` | ABAC | Generic attribute mismatch. |
| `abac_deny_rule` | ABAC | A `DENY`-effect policy matched. |
| `resource_not_found` | Loader | The resource does not exist (or is in another tenant). |
| `csrf_token_mismatch` | CSRF | Cross-site request rejected. |
| `session_expired` | Session | Session TTL elapsed. |
| `session_revoked` | Session | Session was admin-revoked. |

The reason is written to `AuditLog` (action=`AUTHZ_DENIED`) and surfaced in the RFC 7807 response as `details.reason`. The `problem+json` `detail` field is human-readable ("You may only reassign bookings in regions you manage").

---

## 6. Policy Inheritance

Policies are evaluated in order: **global → organization → team**. A `deny` at any level blocks; a `RESTRICT` at any level adds a condition that must hold. There is no override: a team policy cannot relax an org policy.

```
Global policies (organizationId IS NULL)
   │
   ▼ applies to every tenant
Organization policies (organizationId = X)
   │
   ▼ applies to every team in X
Team policies (teamId = T)
   │
   ▼ final effective permission set
```

**Example.** Global policy: `booking.assign` requires `hierarchy` (any manager can assign bookings in their managed regions). Org-level policy (Eks-Food Ghana): `booking.assign` additionally requires `status_in: ["PENDING_MATCH", "ASSIGNED"]` (cannot reassign a CONFIRMED booking without escalation). Team-level policy (East Legon Cooks team): `booking.assign` additionally requires `feature_flag: "east_legon_reassignment_pilot"` (the team is piloting a reassignment workflow).

The effective condition is the AND of all three. A manager in the East Legon Cooks team can reassign a booking iff:
- the booking is in a region they manage,
- the booking is in PENDING_MATCH or ASSIGNED state,
- the `east_legon_reassignment_pilot` flag is on for their tenant.

---

## 7. Conditional Permissions

Beyond static policies, the `AuthorizationService` honours runtime conditions encoded directly on the `Role` (not the `Policy`):

```prisma
model Role {
  // …
  // Optional JSON: condition that must hold for the role to be active.
  // Example: { "feature_flag": "ai.assistant_v2" } on a role that
  // grants ai.assistant_v2.* permissions — the role is only "active"
  // when the flag is on.
  activationCondition String? @default(null)
}
```

If a role's `activationCondition` evaluates to `false`, the role is excluded from the principal's effective permission set entirely. This is the mechanism used for pilot roles (e.g. a `pilot_inspector` role only active when `inspection.pilot` is on).

---

## 8. Worked Example — Amara reassigns a booking in East Legon

**Setup.** Amara Mensah is a cook-manager at Eks-Food Ghana (`organizationId=org_ghana`). She manages the East Legon region (`managedRegionIds=["region_east_legon"]`). She is also a `team_lead` on the "East Legon Cooks" team (`teamIds=["team_el_cooks"]`). She is at her desk in Accra on a Tuesday at 14:30 GMT, authenticated with a password + TOTP MFA (risk score 12).

A customer calls: "I want a different cook for booking `EKS-6GKD02`." Amara opens the booking and clicks "Reassign".

**Request:**
```
POST /api/v1/bookings/EKS-6GKD02/reassign
Cookie: __Host-eks.session=…
X-CSRF-Token: …
{ "reason": "customer_request", "newCookId": null }
```

**Authorization pipeline:**

```
Step 1 — Resolve Principal
  Memberships loaded for actorId=user_amara, tenantId=org_ghana:
    • Membership { tenantId: org_ghana, roleSlug: "manager", status: ACTIVE }
    • Membership { tenantId: org_ghana, teamId: team_el_cooks, roleSlug: "team_lead" }
  Principal {
    userId:           user_amara
    activeTenantId:   org_ghana
    managedRegionIds: ["region_east_legon"]
    teamIds:          ["team_el_cooks"]
    effectivePermissions: [booking.read, booking.create, booking.assign,
                           booking.cancel, cook.read, cook.manage,
                           payment.read, payment.payout, org.member.invite,
                           …]
  }
  → no_memberships? NO. Continue.

Step 2 — Permission grant check
  action = "booking.assign"
  "booking.assign" in principal.effectivePermissions? YES.
  → permission_not_granted? NO. Continue.

Step 3 — Tenant scope check
  scope.tenantId = org_ghana (from the booking lookup)
  principal.activeTenantId = org_ghana
  → abac_scope_mismatch? NO. Continue.

Step 4 — Load applicable policies
  Lookup for (org_ghana, "manager", "booking.assign"):
    1. GLOBAL Policy {
         id: policy_global_booking_assign_hierarchy
         organizationId: null
         roleSlug: "manager"
         permissionCode: "booking.assign"
         condition: { hierarchy: true }
         effect: RESTRICT
       }
    2. ORG Policy {
         id: policy_ghana_booking_assign_status
         organizationId: org_ghana
         roleSlug: "manager"
         permissionCode: "booking.assign"
         condition: { status_in: ["PENDING_MATCH", "ASSIGNED"] }
         effect: RESTRICT
       }
    3. TEAM Policy {
         id: policy_el_cooks_booking_assign_pilot
         organizationId: org_ghana
         teamId: team_el_cooks
         roleSlug: "team_lead"
         permissionCode: "booking.assign"
         condition: { feature_flag: "east_legon_reassignment_pilot" }
         effect: RESTRICT
       }

Step 5 — Evaluate each policy

  Policy 1 — GLOBAL hierarchy
    condition: { hierarchy: true }
    resource loaded: Booking { id: EKS-6GKD02, region: "East Legon",
                               regionId: region_east_legon, … }
    actor.managedRegionIds includes resource.regionId?
      ["region_east_legon"] includes "region_east_legon" → TRUE.
    Result: PASS.

  Policy 2 — ORG status_in
    condition: { status_in: ["PENDING_MATCH", "ASSIGNED"] }
    resource.status = "ASSIGNED"
    "ASSIGNED" in ["PENDING_MATCH", "ASSIGNED"] → TRUE.
    Result: PASS.

  Policy 3 — TEAM feature_flag
    condition: { feature_flag: "east_legon_reassignment_pilot" }
    FeatureFlagService.isEnabled("east_legon_reassignment_pilot",
                                 principal)?
      → tenant org_ghana has FeatureFlagAssignment {
          key: "east_legon_reassignment_pilot", enabled: true }
      → TRUE.
    Result: PASS.

Step 6 — All checks pass
  Return authorized=true, matchedPermissions=["booking.assign"].
```

**Response:**
```
200 OK
{ data: { booking: { code: "EKS-6GKD02", status: "PENDING_MATCH",
                     cookId: null, reassignedAt: "2025-01-15T14:31:00Z" } } }
```

The handler also writes `AuditLog { action: BOOKING_REASSIGNED, actor: user_amara, entityId: EKS-6GKD02, organizationId: org_ghana, metadata: { reason: "customer_request" } }` and stages `booking.reassigned.v1` to the outbox.

### 8.1 Counter-example — Amara tries to reassign a Kumasi booking

Same actor, same request, but the booking is in Kumasi (`regionId: region_kumasi`).

```
Step 5 — Evaluate policies
  Policy 1 — GLOBAL hierarchy
    actor.managedRegionIds = ["region_east_legon"]
    resource.regionId = "region_kumasi"
    ["region_east_legon"] includes "region_kumasi" → FALSE.
    Result: FAIL, failedRule="hierarchy", detail="resource region 'region_kumasi'
            not in actor managed regions ['region_east_legon']".

Return deny("abac_hierarchy_failed", {
  rule:   "policy_global_booking_assign_hierarchy",
  detail: "resource region 'region_kumasi' not in actor managed regions ['region_east_legon']"
})
```

**Response:**
```
403 Forbidden
Content-Type: application/problem+json
{
  "type":      "https://docs.eks-food/errors/authz_abac_denied",
  "title":     "Authorization denied",
  "status":    403,
  "detail":    "You may only reassign bookings in regions you manage.",
  "code":      "AUTHZ_ABAC_DENIED",
  "instance":  "/api/v1/bookings/EKS-6GKD02/reassign",
  "traceId":   "abc123…",
  "details": {
    "reason": "abac_hierarchy_failed",
    "rule":   "policy_global_booking_assign_hierarchy",
    "detail": "resource region 'region_kumasi' not in actor managed regions ['region_east_legon']"
  }
}
```

The same denial is written to `AuditLog { action: AUTHZ_DENIED, actor: user_amara, organizationId: org_ghana, metadata: { permission: "booking.assign", reason: "abac_hierarchy_failed", rule: "policy_global_booking_assign_hierarchy", resourceId: "EKS-6GKD02" } }`. The `authz.decision{permission,decision="deny"}` counter increments.

### 8.2 Counter-example — Amara tries to reassign a CONFIRMED booking

The booking is in East Legon but `status: "CONFIRMED"`. Policy 1 passes (region matches); Policy 2 fails.

```
Policy 2 — ORG status_in
  resource.status = "CONFIRMED"
  "CONFIRMED" in ["PENDING_MATCH", "ASSIGNED"] → FALSE.
  Result: FAIL, failedRule="status_in".

Return deny("abac_status_in_failed", {
  rule:   "policy_ghana_booking_assign_status",
  detail: "booking status 'CONFIRMED' not in allowed set ['PENDING_MATCH','ASSIGNED']"
})
```

The system also exposes an **escalation path**: a manager can call `POST /api/v1/bookings/{code}/escalate` (permission `booking.escalate`, granted to `admin` and `owner` only) which overrides the status check via a separate, more-audited path.

---

## 9. Role Assignment Lifecycle

Granting and revoking roles is itself a privileged, audited action. The flow:

```
Admin (ADMIN role) opens the membership panel
   │
   ▼
POST /api/v1/memberships
  { userId, roleSlug, teamId? }
   │
   ▼
@eks/authorization.authorize(principal, "org.member.role.change",
                             { resource: "Membership", tenantId: … })
   │
   ▼ Principal must be ADMIN or OWNER (or SUPPORT for read-only)
   ▼ New role's permissions must be a subset of granter's permissions
   ▼ (a MANAGER cannot grant ADMIN — only ADMIN/OWNER can)
   │
   ▼
BEGIN TX
  INSERT Membership { userId, organizationId, roleSlug, status: ACTIVE,
                      invitedAt: now, activatedAt: now }
  UPDATE User.roleIds = append(roleId)
  stage outbox: identity.user.role.granted.v1 { userId, roleId, grantedBy }
  audit (ROLE_GRANTED, actor=principal.userId, entityId=userId,
         metadata: { role: roleSlug, org: organizationId })
COMMIT
   │
   ▼
@eks/notifications → email the user: "You were granted the Manager role at Eks-Food Ghana"
```

**Subset rule.** A granter cannot grant a role whose permission set is not a subset of their own. This prevents a `MANAGER` from granting `ADMIN` to themselves or a colleague. `SUPER_ADMIN` is the only role that can grant any role, including `SUPER_ADMIN`.

**Revocation.** `DELETE /api/v1/memberships/{id}` sets `Membership.status=REVOKED`, removes the role from `User.roleIds`, revokes all the user's sessions (so the role loss takes effect immediately), and stages `identity.user.role.revoked.v1`.

---

## 10. Impersonation

`SUPER_ADMIN` and `SUPPORT` (with second-approver SUPER_ADMIN approval for high-risk targets) can impersonate a user via `POST /api/v1/admin/users/{id}/impersonate`. This:

1. Creates a new Session with `method=impersonation`, `impersonatorUserId=principal.id`, `userId=target.id`.
2. Stages `identity.session.impersonation_started.v1` to the outbox.
3. Writes `AuditLog { action: AUTH_IMPERSONATION_STARTED, actor: principal.id, entityId: target.id }` — **every** subsequent action by the impersonating session is audited with both `actorUserId` (the target) and `impersonatorUserId` (the super-admin), so the audit trail is unambiguous.
4. The impersonating session carries a visible banner in the UI ("You are impersonating Amara Mensah. [End session]").
5. Sessions of `method=impersonation` cannot themselves impersonate — `auth.impersonate` permission is revoked on the impersonating session's effective principal.

Impersonation is for support and debugging only; it is rate-limited to 10 active impersonations per `SUPPORT` user per hour.

---

## 11. Cross-References

| Topic | Document |
|---|---|
| Tenant scope mechanics, `TenantContext` ALS, cross-tenant impossible by construction | `MULTI_TENANCY.md` |
| Session model, refresh-token rotation, risk scoring (drives step-up) | `SESSION_SECURITY.md` |
| Audit log entries for `AUTHZ_DENIED`, `ROLE_GRANTED`, `AUTH_IMPERSONATION_STARTED` | `AUDIT_AND_COMPLIANCE.md` |
| REST API endpoints for memberships, roles, invitations | `API_REFERENCE.md` |
