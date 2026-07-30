# Eks-Food Developer Platform — Permission Model

> **Audience:** Extension authors, security reviewers, and tenant admins who approve extension installs. Read alongside `SECURITY_MODEL.md` (how permissions are enforced), `EXTENSION_AUTHORING.md` (how permissions are declared in the manifest), `SDK_GUIDE.md` (how permissions gate capability calls), and `RUNTIME_ARCHITECTURE.md` (where the permission check lives in the call path).
>
> **Status:** Milestone 3. This document specifies the **capability-based** permission model that gates every `ctx.*` call an extension makes. The model is the single source of truth for "what an extension is allowed to do" — every other document references it; no other document contradicts it.

---

## 1. Why capability-based permissions

Eks-Food's M2 IAM stack is **role-based**: a user has a role (`OWNER`, `ADMIN`, `MANAGER`, `MEMBER`, `VIEWER`), the role carries permissions (`booking.read`, `booking.assign`, etc.), and `authorize(principal, action, resource)` checks the principal's role for the action. This works for **humans** because a human's role is stable and their intent is contextual.

Extensions are different. An extension is **code**, and code's intent is whatever the code does. A "loyalty engine" extension has no inherent role — it has a set of capabilities it exercises (read bookings, write storage, publish events). The right model is **capability-based**: the manifest declares which capabilities the extension exercises; the tenant admin grants those capabilities at install time; the runtime enforces them at every capability call.

The two models compose cleanly:
- **M2 RBAC** answers "may this **user** perform this **action** on this **resource**?" — for example, "may Amara (ADMIN) invoke the loyalty-engine extension?"
- **M3 capability permissions** answer "may this **extension** exercise this **capability** on this **resource**?" — for example, "may the loyalty-engine extension read from `ctx.storage`?"

Every `/api/v1/extensions/*` route is gated by **both** layers: the M2 layer checks the user's role, the M3 layer checks the extension's capabilities.

---

## 2. The capability registry

The platform defines a fixed set of capability permission codes. Each code corresponds to a specific SDK call surface. The list is versioned with the platform; new codes are added in MINOR releases, never removed in MINOR releases (deprecations happen with a one-release notice and removal in MAJOR releases).

### 2.1 The full registry

| Code | Category | Gates | Default risk | Description |
|---|---|---|---|---|
| `invoke.apis` | API | `ctx.apis.register`, `ctx.apis.invoke`, `ctx.apis.fetch`, `ctx.apis.request` | medium | Register HTTP handlers; invoke other extensions; call connectors; outbound HTTP |
| `subscribe.events` | Events | `ctx.events.subscribe`, `ctx.events.replay` | medium | Subscribe to domain events; replay past events |
| `publish.events` | Events | `ctx.events.publish` | medium | Publish integration events to the outbox |
| `access.storage` | Storage | `ctx.storage.get/set/delete/list/tx` | low | Per-installation key/value storage |
| `access.cache` | Cache | `ctx.cache.get/set/delete/getOrSet` | low | Per-installation cache (Redis in prod) |
| `access.secrets` | Secrets | `ctx.secrets.get/getJSON/list` | **high** | Read encrypted secrets (per-name via `requiredSecrets`) |
| `delegate.auth` | Auth | `ctx.auth.asUser`, `ctx.auth.resolvePrincipal` | **high** | Mint short-lived delegated Principals; act as a user |
| `events.replay` | Events | `ctx.events.replay` | medium | Trigger an `EventReplay` (audited, operator-initiated pattern) |
| `read.customers` | Data | `ctx.apis.invoke("ext:customer-api", …)` with read scope | medium | Read customer data via the platform API |
| `read.bookings` | Data | `ctx.apis.invoke("ext:booking-api", …)` with read scope | medium | Read booking data |
| `write.schedules` | Data | `ctx.apis.invoke("ext:scheduling-api", …)` with write scope | **high** | Write to the schedule aggregate |
| `read.schedules` | Data | read scope on scheduling API | medium | Read schedule data |
| `access.procurement` | Data | invoke procurement API | **high** | Access procurement data (sensitive: vendor pricing) |
| `read.analytics` | Data | invoke analytics API | medium | Read analytics dashboards |
| `read.audit` | Data | invoke audit API | **high** | Read audit log entries (sensitive) |
| `manage.workflows` | Workflow | `ctx.apis.registerStep`, `ctx.workflow.create/update/disable` | medium | Create and manage workflow definitions |
| `invoke.workflows` | Workflow | `ctx.workflow.start/cancel/status` | low | Start/cancel/query workflow executions |
| `manage.connectors` | Connector | `ctx.connector.configure/enable/disable` | **high** | Configure connector credentials |
| `invoke.connectors` | Connector | `ctx.apis.fetch("connector:…", …)` | medium | Call a connector's actions (separate from `invoke.apis`) |
| `read.configuration` | Config | `ctx.config.get/getJSON/all` | low | Read the installation's configuration (always allowed) |
| `write.configuration` | Config | (operator action; not exposed to extensions) | n/a | Reserved for future SDK calls |
| `emit.metrics` | Observability | `ctx.metrics.counter/gauge/histogram` | low | Emit Prometheus metrics (always allowed) |
| `emit.logs` | Observability | `ctx.logger.debug/info/warn/error` | low | Write to `ExtensionLog` (always allowed) |
| `emit.traces` | Observability | `ctx.tracer.startSpan` | low | Open child spans (always allowed) |
| `access.features` | Features | `ctx.features.isEnabled/variant` | low | Read per-tenant feature-flag state (always allowed) |

The "always allowed" capabilities (`read.configuration`, `emit.metrics`, `emit.logs`, `emit.traces`, `access.features`) are listed for clarity — they are granted automatically at install time and do not require explicit operator approval. They are still recorded in `ExtensionPermission` for completeness.

### 2.2 Risk levels and review depth

The platform categorises each capability by risk, which drives the install-review UI:

| Risk | UI treatment | Default grant |
|---|---|---|
| low | Standard list item, no extra prompt | Granted automatically if declared |
| medium | Standard list item with description | Requires admin click "Approve" |
| high | Bold red list item with full description; requires typing the permission code to confirm | Requires admin click "Approve" + type-to-confirm |

An extension requesting a `high`-risk capability (e.g. `access.secrets`, `delegate.auth`, `write.schedules`, `access.procurement`, `read.audit`, `manage.connectors`) gets a heightened review flow:

```
⚠ This extension is requesting high-risk capabilities:

  • access.secrets — Read encrypted secrets (per-name via requiredSecrets)
  • delegate.auth — Mint short-lived delegated Principals; act as a user

To approve, type each capability code below:

  access.secrets:    [____________________]
  delegate.auth:     [____________________]
```

The type-to-confirm pattern is borrowed from cloud consoles (AWS IAM, GCP IAM). It defeats "click-through" approvals.

---

## 3. How permissions are declared in the manifest

The manifest's `permissions` array lists the capability codes the extension exercises. The platform validates the array at publish time (Stage 1 of the publishing pipeline) and at install time (Stage 8 of the install flow):

```jsonc
{
  "permissions": [
    "invoke.apis",
    "subscribe.events",
    "publish.events",
    "access.storage",
    "access.cache",
    "access.secrets",     // high risk
    "delegate.auth",      // high risk
    "read.bookings",
    "write.schedules"     // high risk
  ]
}
```

Validation rules:
1. **Every code must be a known capability** (see §2.1). Unknown codes → `UnknownPermissionError` at publish time.
2. **The list must be minimal.** The platform's linter (run by `eks validate --strict`) warns on capabilities that the bundled code does not actually exercise. The warning is not a publish-time failure (the linter cannot perfectly detect capability usage in bundled code), but it is surfaced in the Developer Console for the publisher to address.
3. **The list must be stable across patch releases.** A patch version (1.0.0 → 1.0.1) cannot add or remove capabilities. A minor version (1.0.0 → 1.1.0) can add capabilities (which require re-approval on upgrade) but cannot remove them (removal is reserved for major versions). A major version (1.x → 2.0.0) can change the list freely.
4. **`requiredSecrets`, `requiredAPIs`, `requiredEvents`, and `connectorDependencies` are separate declarations.** They are not capabilities themselves but are gated by capabilities — `access.secrets` is required to read any secret; `invoke.apis` is required to call any API; `subscribe.events` is required to subscribe to any event; `invoke.connectors` is required to call any connector.

### 3.1 The relationship between capabilities and required declarations

```
manifest.permissions = ["access.secrets", "invoke.apis", "invoke.connectors"]
                       │                  │                │
                       │                  │                └── gates ctx.apis.fetch("connector:…", …)
                       │                  └── gates ctx.apis.invoke, ctx.apis.request, ctx.apis.register
                       └── gates ctx.secrets.get

manifest.requiredSecrets = ["STRIPE_SECRET_KEY"]
  └── gates which secret NAMES ctx.secrets.get can read (in addition to access.secrets)

manifest.requiredAPIs = ["booking.read", "booking.create"]
  └── gates which API ACTIONS ctx.apis.invoke can call (in addition to invoke.apis)

manifest.requiredEvents = ["booking.created.v1"]
  └── gates which event TYPES ctx.events.subscribe can register (in addition to subscribe.events)

manifest.connectorDependencies = ["connector:acme-pos"]
  └── gates which connector SLUGS ctx.apis.fetch can call (in addition to invoke.connectors)
```

A capability check has two layers: the **broad** capability (`access.secrets`) and the **narrow** declaration (`requiredSecrets: ["STRIPE_SECRET_KEY"]`). Both must pass. A call to `ctx.secrets.get("UNDECLARED_KEY")` fails the narrow check even if `access.secrets` is granted.

---

## 4. How permissions are reviewed during installation

The install-review flow is documented in `SECURITY_MODEL.md` §3. This section documents the **decision matrix** the tenant admin applies.

### 4.1 The principle of least privilege

The platform defaults to **least privilege**: an extension is granted only the capabilities it declares, and only for the resources it declares. The admin's job is to verify that the declared capabilities are proportional to the extension's stated purpose.

The Developer Console surfaces a "proportionality check" — a heuristic that compares the extension's declared capabilities against the publisher's stated purpose (from the manifest's `description` field). For example:

| Extension | Description | Declared capabilities | Proportionality |
|---|---|---|---|
| Loyalty engine | "Award points for bookings" | `invoke.apis`, `subscribe.events`, `publish.events`, `access.storage`, `access.cache`, `read.bookings` | ✓ proportional |
| Loyalty engine | "Award points for bookings" | + `access.secrets`, `delegate.auth`, `write.schedules` | ⚠ disproportionate — why does a loyalty engine need to write schedules? |
| Acme POS connector | "Sync Acme orders to bookings" | `invoke.apis`, `invoke.connectors`, `subscribe.events`, `publish.events`, `access.storage`, `access.cache`, `access.secrets`, `read.bookings`, `write.schedules` | ✓ proportional (sync needs write) |

The proportionality check is heuristic — it does not block install; it surfaces a warning. The admin makes the final call.

### 4.2 The review surface

```
┌──────────────────────────────────────────────────────────────────────┐
│ Install: loyalty-engine 1.0.0                                         │
│ Publisher: Acme (verified, ACTIVE)                                    │
│                                                                       │
│ Capabilities (8 declared, 2 high-risk):                              │
│   ✓ invoke.apis           — Register HTTP handlers; call APIs          │
│   ✓ subscribe.events      — Subscribe to domain events                 │
│   ✓ publish.events        — Publish integration events                 │
│   ✓ access.storage        — Per-installation key/value storage         │
│   ✓ access.cache          — Per-installation cache                     │
│   ⚠ access.secrets        — Read encrypted secrets (1 secret)          │
│       → STRIPE_SECRET_KEY                                            │
│   ⚠ delegate.auth         — Act as a user (short-lived, scoped)        │
│   ✓ read.bookings         — Read booking data via platform API         │
│                                                                       │
│ Required APIs (3):                                                    │
│   ✓ booking.read           — View bookings                             │
│   ✓ booking.create         — Create bookings                           │
│   ✓ customer.read          — View customer profiles                    │
│                                                                       │
│ Required events (2):                                                  │
│   ✓ booking.created.v1     — emitted when a booking is created         │
│   ✓ booking.cancelled.v1   — emitted when a booking is cancelled       │
│                                                                       │
│ Required secrets (1):                                                 │
│   ⚠ STRIPE_SECRET_KEY     — (you will be prompted to set this)         │
│                                                                       │
│ Allowed domains (1):                                                  │
│   ✓ api.stripe.com                                                    │
│                                                                       │
│ Connector dependencies (1):                                           │
│   ✓ connector:acme-pos     — (installed, ACTIVE)                       │
│                                                                       │
│ Compatibility: eks-platform ^3.0.0 (you are on 3.1.2) ✓              │
│                                                                       │
│ Package: 18_512 bytes, sha256=abc…, signed by pub_acme/key-2025-01 ✓ │
│                                                                       │
│  [ Reject ]                              [ Approve & Install ]         │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.3 What the admin is approving

By clicking "Approve & Install", the admin:
1. Grants the declared capabilities (creates `ExtensionPermission` rows).
2. Grants the declared API actions (creates `ExtensionPermission` rows with `permission = "api:booking.read"`, etc.).
3. Acknowledges the declared event subscriptions (the platform will route those event types to the extension).
4. Acknowledges the declared connector dependencies (the platform will allow the extension to call those connectors).
5. Commits to setting the declared secrets (the install flow prompts for each `requiredSecrets` entry).
6. Acknowledges the declared allowed domains (the egress proxy will allow calls to those domains).

Every grant is recorded in `AuditLog` with `action = EXTENSION_PERMISSION_GRANTED`, `actorUserId`, `permission`, `installationId`.

---

## 5. How permissions are enforced at runtime

Every `ctx.*` call is intercepted by a permission-checking proxy. The proxy is documented in `RUNTIME_ARCHITECTURE.md` §4; this section documents the **decision logic**.

### 5.1 The check pipeline

```
Extension calls ctx.secrets.get("STRIPE_SECRET_KEY")
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│  1. Capability check                                            │
│     Is "access.secrets" in ExtensionPermission for this         │
│     installation?                                               │
│     • If no → throw ForbiddenError("permission_not_granted")    │
└────────────────────────────────────────────────────────────────┘
         │ yes
         ▼
┌────────────────────────────────────────────────────────────────┐
│  2. Resource check                                              │
│     Is "STRIPE_SECRET_KEY" in manifest.requiredSecrets?         │
│     • If no → throw ForbiddenError("secret_not_declared")       │
└────────────────────────────────────────────────────────────────┘
         │ yes
         ▼
┌────────────────────────────────────────────────────────────────┐
│  3. Quota check                                                 │
│     Has the invocation exhausted its secret-read quota?         │
│     • If yes → throw ResourceLimitExceeded("secrets_read")      │
└────────────────────────────────────────────────────────────────┘
         │ no
         ▼
┌────────────────────────────────────────────────────────────────┐
│  4. Audit                                                       │
│     Write AuditLog(EXTENSION_SECRET_READ, installationId,       │
│       secretName, invocationId, actorUserId)                    │
└────────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│  5. Tracer                                                      │
│     Open child span "extension.secrets.get"                     │
└────────────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│  6. Delegate to the platform service                            │
│     Read Secret row from Postgres (scoped by installationId),   │
│     decrypt with the KMS-managed master key, return the value.  │
└────────────────────────────────────────────────────────────────┘
         │
         ▼
   returns string
```

Every check is performed **before** the platform service is called. A denial produces zero side effects — no Postgres read, no KMS decrypt, no audit row. The audit row is written only for **successful** checks (a denial is logged separately as `AuditLog(EXTENSION_PERMISSION_DENIED)`).

> **Audit codes.** The literal `EXTENSION_PERMISSION_GRANTED` and `EXTENSION_PERMISSION_DENIED` strings written to `AuditLog.action` are not free-form — they are the `PERMISSION_GRANTED` and `PERMISSION_DENIED` keys of the `DEVELOPER_AUDIT_ACTIONS` registry in `@eks/developer` (`src/packages/developer/audit-actions.ts`). The runtime's permission-check proxy imports the constants and writes them via the M1 `@eks/observability/audit` non-blocking writer; the literal-string surface area is zero, so a future rename is a single edit and SIEM dashboards that filter on the code remain stable. Note that `PERMISSION_DENIED` is one of the four "negative-outcome" codes in the registry that have **no** corresponding domain event (the others are `CONNECTOR_FAILED`, `MANIFEST_VALIDATION_FAILED`, `SANDBOX_VIOLATION`) — a denial does not mutate an aggregate, so no event is staged to the outbox; the audit log alone records it.

### 5.2 Performance

The check pipeline adds <100µs per capability call (the `ExtensionPermission` rows are cached in the worker's memory for the lifetime of the installation; the audit row is written asynchronously via the M1 `@eks/observability/audit` non-blocking writer). The overhead is negligible compared to the typical capability call (a `ctx.storage.get` is ~2ms; a `ctx.secrets.get` is ~5ms including KMS decrypt).

### 5.3 What happens on denial

A denial throws `ForbiddenError` with:

```json
{
  "type": "https://eks.food/errors/forbidden",
  "title": "Permission not granted",
  "status": 403,
  "detail": "The extension does not have permission to perform this capability.",
  "instance": "/api/v1/extensions/loyalty-engine/route/redeem",
  "details": {
    "permission": "access.secrets",
    "capability": "ctx.secrets.get",
    "method": "get",
    "installationId": "inst_abc",
    "invocationId": "inv_xyz"
  }
}
```

The denial is also written to `ExtensionLog` at `warn` level (so the extension author can debug) and `AuditLog` with `action = EXTENSION_PERMISSION_DENIED` (so the operator can detect anomalies).

---

## 6. Permission groups

For convenience, the platform defines **permission groups** — named bundles of capabilities that cover common extension archetypes. A group is just a manifest shortcut; expanding a group at publish time produces the same `ExtensionPermission` rows as listing the capabilities individually.

| Group | Capabilities | Use case |
|---|---|---|
| `read-only` | `invoke.apis`, `subscribe.events`, `access.storage`, `access.cache`, `read.configuration`, `emit.metrics`, `emit.logs`, `emit.traces`, `access.features` | A read-only dashboard extension |
| `event-driven` | `read-only` + `publish.events` | An extension that reacts to events and emits its own |
| `webhook-receiver` | `read-only` + `invoke.apis` (with webhook route) | An extension that receives webhooks |
| `connector` | `event-driven` + `invoke.connectors` + `access.secrets` | A connector extension |
| `workflow-step` | `read-only` + `invoke.workflows` | An extension that registers workflow steps |
| `full-access` | All capabilities | Reserved for platform-published extensions; tenant-published extensions cannot declare this group |

A manifest declares a group with the `permissions` array entry `"group:<name>"`:

```jsonc
{
  "permissions": ["group:event-driven", "read.bookings"]
}
```

The platform expands the group at publish time and records the expanded capabilities in the `ExtensionVersion.expandedPermissions` field (for transparency). The manifest's `permissions` field retains the group reference (for readability).

---

## 7. Conditional permissions

Some capabilities are **conditional** — they require an additional context check beyond the broad capability grant. The platform supports three kinds of conditions:

### 7.1 Per-resource conditions

The `requiredAPIs` declaration carries an optional `condition` field that scopes the API action to a specific resource or set of resources:

```jsonc
{
  "requiredAPIs": [
    { "action": "booking.read", "condition": { "region": "east-legon" } },
    { "action": "booking.create", "condition": { "customerTier": "premium" } }
  ]
}
```

The platform's `authorize()` flow evaluates the condition against the request's resource (e.g. "is this booking's region `east-legon`?") and denies the call if the condition fails. Conditions are evaluated by the M2 `@eks/authorization` engine (the same engine that evaluates ABAC policies for human users).

### 7.2 Time-bounded conditions

A capability can be granted with a time bound:

```jsonc
{
  "permissions": [
    { "code": "access.procurement", "until": "2025-12-31T23:59:59Z" }
  ]
}
```

The platform rejects capability calls after the `until` timestamp. This is useful for short-lived integrations (e.g. a one-off data migration extension).

### 7.3 Quota-bounded conditions

A capability can be granted with a usage quota:

```jsonc
{
  "permissions": [
    { "code": "delegate.auth", "quota": { "count": 1000, "windowSeconds": 86400 } }
  ]
}
```

The platform rejects capability calls once the quota is exhausted. The quota is reset at the start of each window. Quota-bounded capabilities are tracked in `ExtensionPermission.quotaUsed` and `ExtensionPermission.quotaResetAt`.

---

## 8. The `ExtensionPermission` Prisma model

```prisma
model ExtensionPermission {
  id              String   @id @default(cuid())
  installationId  String
  permission      String                  // capability code (e.g. "access.secrets")
                                       // or action code (e.g. "api:booking.read")
  // ─── Condition ────────────────────────────────────────────────
  condition       Json?                   // { region: "east-legon" } | { customerTier: "premium" }
  until           DateTime?               // for time-bounded grants
  // ─── Quota ────────────────────────────────────────────────────
  quotaCount      Int?                    // for quota-bounded grants
  quotaWindowSeconds Int?
  quotaUsed       Int      @default(0)
  quotaResetAt    DateTime?
  // ─── Audit ────────────────────────────────────────────────────
  grantedBy       String                  // user id of the admin who approved
  grantedAt       DateTime @default(now())
  revokedBy       String?
  revokedAt       DateTime?
  revokeReason    String?
  // ─── Relations + timestamps ───────────────────────────────────
  installation    ExtensionInstallation @relation(fields: [installationId], references: [id])
  updatedAt       DateTime @updatedAt

  @@unique([installationId, permission])
  @@index([installationId])
}
```

A row's existence with `revokedAt IS NULL` is the grant. A row with `revokedAt` set is a historical record (the grant was active from `grantedAt` to `revokedAt`). The runtime checks `revokedAt IS NULL` at every capability call.

### 8.1 Revocation

An admin can revoke a capability at any time:

```bash
eks permissions revoke --installation inst_abc --permission access.secrets --reason "no_longer_needed"
```

The platform:
1. Sets `revokedAt`, `revokedBy`, `revokeReason` on the `ExtensionPermission` row.
2. Writes `AuditLog(EXTENSION_PERMISSION_REVOKED)`.
3. The runtime's permission-check proxy reads `ExtensionPermission` with a 30-second cache; the next capability call (within 30s) sees the revocation and throws `ForbiddenError`.

An admin can also re-grant a revoked capability:

```bash
eks permissions grant --installation inst_abc --permission access.secrets
```

This creates a new `ExtensionPermission` row (the old revoked row is retained for history).

---

## 9. Worked example — a full permission review

### 9.1 The manifest

```jsonc
{
  "slug": "premium-concierge",
  "version": "1.0.0",
  "permissions": [
    "invoke.apis",
    "subscribe.events",
    "publish.events",
    "access.storage",
    "access.cache",
    "access.secrets",
    "delegate.auth",
    "read.bookings",
    "read.customers",
    "write.schedules",
    "read.analytics"
  ],
  "requiredAPIs": [
    { "action": "booking.read",   "condition": { "customerTier": "premium" } },
    { "action": "customer.read",  "condition": { "customerTier": "premium" } },
    { "action": "booking.update", "condition": { "customerTier": "premium" } }
  ],
  "requiredEvents": ["booking.created.v1", "booking.cancelled.v1"],
  "requiredSecrets": ["CONCIERGE_OPENAI_KEY", "CONCIERGE_SLACK_TOKEN"],
  "connectorDependencies": ["connector:acme-pos"],
  "allowedDomains": ["api.openai.com", "hooks.slack.com"]
}
```

### 9.2 The admin's review

The admin sees:

```
⚠ High-risk capabilities (3):
  • access.secrets       — Read encrypted secrets (2 secrets)
      → CONCIERGE_OPENAI_KEY, CONCIERGE_SLACK_TOKEN
  • delegate.auth        — Act as a user (short-lived, scoped)
  • write.schedules      — Write to the schedule aggregate

✓ Standard capabilities (8):
  • invoke.apis, subscribe.events, publish.events, access.storage,
    access.cache, read.bookings, read.customers, read.analytics

✓ Required APIs (3, all conditional on customerTier=premium):
  • booking.read, customer.read, booking.update

✓ Required events (2): booking.created.v1, booking.cancelled.v1

⚠ Required secrets (2): CONCIERGE_OPENAI_KEY, CONCIERGE_SLACK_TOKEN
   (you will be prompted to set both)

✓ Allowed domains (2): api.openai.com, hooks.slack.com

✓ Connector dependencies (1): connector:acme-pos (installed, ACTIVE)

Type each high-risk capability code to confirm:
  access.secrets:    [____________________]
  delegate.auth:     [____________________]
  write.schedules:   [____________________]
```

### 9.3 What gets persisted

On "Approve & Install", the platform creates 11 `ExtensionPermission` rows (one per declared capability), 3 `ExtensionPermission` rows for the API actions (with `condition` set), 2 `Secret` rows (encrypted, empty — the admin sets the values next), and 1 `ExtensionInstallation` row (status = PENDING). The `Extension.Installed.v1` event is staged to the outbox.

### 9.4 Runtime enforcement

When the extension calls `ctx.apis.invoke("ext:booking-api", "update", { bookingId, … })`:
1. **Capability check**: `invoke.apis` is granted → pass.
2. **Resource check**: `booking.update` is in `requiredAPIs` with `condition: { customerTier: "premium" }`.
3. **Condition check**: the platform reads the booking's `customerTier` (via the M2 authorization engine's ABAC layer). If the booking's tier is not `premium`, the call is denied with `ForbiddenError("abac_condition_failed:customerTier")`.
4. If the condition passes, the call proceeds to the booking-api extension.

When the extension calls `ctx.secrets.get("CONCIERGE_OPENAI_KEY")`:
1. **Capability check**: `access.secrets` is granted → pass.
2. **Resource check**: `CONCIERGE_OPENAI_KEY` is in `requiredSecrets` → pass.
3. **Quota check**: the invocation has not exhausted its secret-read quota → pass.
4. **Audit**: `AuditLog(EXTENSION_SECRET_READ)` is written.
5. The platform reads the `Secret` row, decrypts it with the KMS, returns the value.

When the extension calls `ctx.secrets.get("UNDECLARED_KEY")`:
1. **Capability check**: `access.secrets` is granted → pass.
2. **Resource check**: `UNDECLARED_KEY` is NOT in `requiredSecrets` → **deny** with `ForbiddenError("secret_not_declared")`.
3. The platform writes `AuditLog(EXTENSION_PERMISSION_DENIED)` and `ExtensionLog(warn)`.

---

## 10. Cross-references

| Topic | Document |
|---|---|
| Capability enforcement (proxies, check pipeline) | `RUNTIME_ARCHITECTURE.md` §4, `SECURITY_MODEL.md` §3 |
| Manifest `permissions` field | `EXTENSION_AUTHORING.md` §3 |
| SDK call surface gated by each capability | `SDK_GUIDE.md` §2 |
| `authorize()` (M2 RBAC layer that wraps M3 capabilities) | `docs/identity/AUTHORIZATION_POLICIES.md` |
| `ExtensionPermission` Prisma model | `EXTENSION_AUTHORING.md` §3 |
| `eks permissions grant/revoke` CLI | `CLI_GUIDE.md` |
| Audit logging of permission grants/revocations | `SECURITY_MODEL.md` §6 |
| M2 PERMISSIONS registry (the human-action layer) | `docs/identity/AUTHORIZATION_POLICIES.md` §3 |
