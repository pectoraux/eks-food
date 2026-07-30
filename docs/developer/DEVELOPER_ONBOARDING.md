# Eks-Food Developer Onboarding — 30 / 60 / 90 Minute Walkthrough

> **Audience:** A developer joining the Eks-Food extension ecosystem for the first time. By the end of this document you will have: installed the CLI, created a working extension, run it locally, written and run a test, packaged it, published it to the private registry, installed it in the Developer Console, and inspected its logs and events. Total time budget: 90 minutes (split as 30/30/30).
>
> **Prerequisites:** Node.js 20+, Bun 1.1+, an Eks-Food developer account (you should have received a `publisherId` like `pub_acme` and a one-time Ed25519 signing-key onboarding link from the platform team). Read alongside `EXTENSION_AUTHORING.md`, `SDK_GUIDE.md`, `CLI_GUIDE.md`, `PACKAGING_GUIDE.md`, and `PUBLISHING_GUIDE.md` — this document is the connective tissue; the others are the reference.

---

## 0. Before you start — accounts and keys

Before minute 0, make sure you have:

1. **A publisher account.** Your `Publisher` row exists in `status = "ACTIVE"` with `signingPublicKey` set. If you do not have one, request onboarding from the Eks-Food platform team (M3 is private — there is no self-registration).
2. **A signing keypair.** Generated locally with `eks keys generate` and the public key submitted to the platform team during onboarding. The private key lives at `~/.eks/keys/<publisher>_key-<key-id>.pem` (encrypted with a passphrase you chose).
3. **A dev tenant.** A `Organization` row you are an `ADMIN` of, with at least one test user (you). The platform team provisions `org_dev` for you on request.
4. **The CLI installed.**

```bash
npm install -g @eks/dev-cli
eks --version
# eks/3.1.2 (@eks/dev-cli)
```

If any of the four are missing, ping the platform team in `#eks-developers` on Slack before continuing.

---

# Minute 0–30 — Create, run, and test your first extension

## 1. Configure the CLI (2 minutes)

Create `~/.eks/config.json5`:

```json5
{
  "registry": "https://registry.eks.food",
  "publisher": "pub_acme",            // ← your publisher id
  "signingKeyPath": "~/.eks/keys/pub_acme_key-2025-01.pem",
  "signingKeyId": "key-2025-01",
  "defaultTenant": "org_dev",         // ← your dev tenant
  "outputFormat": "table",
  "color": true,
  "telemetry": "errors"
}
```

Verify the CLI can reach the registry:

```bash
eks whoami
# → publisher: pub_acme (Acme, ACTIVE)
# → signing key: key-2025-01 (active, fingerprint sha256:9f86d0…)
# → default tenant: org_dev
```

If `eks whoami` fails with `401 Unauthorized`, your signing key is not registered. Re-run `eks keys generate` and submit the new public key to the platform team.

## 2. Scaffold the project (3 minutes)

```bash
eks create my-first-ext --publisher pub_acme --template hello-world
cd my-first-ext
```

The scaffold produces the project layout documented in `EXTENSION_AUTHORING.md` §2:

```
my-first-ext/
├── eks.manifest.json5
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   └── index.ts          # the hello-world entrypoint
├── tests/
│   └── handlers/
│       └── greet.spec.ts
├── examples/
│   └── hello.http
└── .eks/
    └── dev.json5         # local dev config (gitignored)
```

Open `eks.manifest.json5` and verify:

```jsonc
{
  "slug": "my-first-ext",
  "name": "My First Extension",
  "version": "0.1.0",
  "kind": "extension",
  "description": "A minimal Eks-Food extension that demonstrates the SDK surface.",
  "publisher": { "id": "pub_acme" },
  "license": "Apache-2.0",
  "capabilities": ["apis", "events", "storage", "cache", "metrics", "tracer"],
  "permissions": [
    "invoke.apis",
    "subscribe.events",
    "publish.events",
    "access.storage",
    "access.cache"
  ],
  "requiredAPIs": [],
  "requiredEvents": ["booking.created.v1"],
  "configurationSchema": {
    "type": "object",
    "properties": {
      "greeting": { "type": "string", "default": "hello" }
    }
  },
  "compatibilityRanges": { "eks-platform": "^3.0.0", "@eks/sdk": "^3.0.0" }
}
```

Open `src/index.ts` and read it — it's the complete hello-world example from `EXTENSION_AUTHORING.md` §6.3.

## 3. Validate the project (1 minute)

```bash
eks validate --strict
# ✓ manifest is valid (slug, version, capabilities, permissions, configurationSchema)
# ✓ compatibility ranges satisfied (eks-platform ^3.0.0 → 3.1.2)
# ✓ bundler dry-run succeeded (4.2 KB output)
# ✓ no forbidden imports detected
# ✓ all requiredEvents have fixtures (1/1)
```

If `--strict` fails on a missing fixture, create `tests/fixtures/events/booking.created.v1.json`:

```json
{
  "eventId": "evt_test_001",
  "eventType": "booking.created.v1",
  "aggregateType": "Booking",
  "aggregateId": "b_test_001",
  "occurredAt": "2025-01-15T10:30:00.000Z",
  "version": 1,
  "tier": "domain",
  "correlationId": "corr_test_001",
  "causationId": null,
  "traceId": "trace_test_001",
  "actorUserId": "u_amara",
  "organizationId": "org_dev",
  "payload": {
    "bookingId": "b_test_001",
    "customerId": "u_amara",
    "regionId": "east-legon",
    "total": { "amount": 5000, "currency": "usd" }
  }
}
```

## 4. Run the tests (3 minutes)

```bash
eks test
# ✓ tests/handlers/greet.spec.ts (2 tests) 12ms
# ✓ tests/subscribers/booking.created.spec.ts (1 test) 18ms
# 3 tests passed, 0 failed
```

If a test fails, the harness prints the diff between expected and actual SDK calls. The most common cause of a first-run failure is a missing fixture — the harness needs an event fixture to deliver (see step 3 above).

## 5. Run the extension locally (10 minutes)

In one terminal:

```bash
eks dev
# → bundling...
# → runtime ready at http://localhost:9100
# → tenant: org_dev  principal: u_amara (ADMIN)
# → egress: replay (from .eks/egress.log)
# → watching src/**/* for changes
```

In another terminal, exercise the extension:

```bash
# Call the registered route:
curl 'http://localhost:9100/api/v1/extensions/my-first-ext/route/greet?name=amara'
# → { "message": "hello, amara!", "visits": 1 }

# Call it again — the storage-backed visit counter increments:
curl 'http://localhost:9100/api/v1/extensions/my-first-ext/route/greet?name=amara'
# → { "message": "hello, amara!", "visits": 2 }

# Simulate a domain-event delivery:
eks events:replay \
  --extension my-first-ext \
  --from 2025-01-01T00:00:00Z \
  --to 2025-01-31T23:59:59Z \
  --type booking.created.v1 \
  --dry-run
# → would replay 1 event (booking.created.v1)

# Actually deliver an event (uses the fixture):
eks events:replay \
  --extension my-first-ext \
  --from 2025-01-15T00:00:00Z \
  --to 2025-01-15T23:59:59Z
# → replay rpl_local_001 started
# → events scanned: 1
# → events delivered: 1
# → completed in 0.1s

# Tail the logs:
eks logs --tail
# 2025-01-15T10:30:00Z info  my-first-ext@0.1.0  extension_ready version=0.1.0
# 2025-01-15T10:30:05Z info  my-first-ext@0.1.0  awarded_points userId=u_amara award=100 source=evt_test_001
```

Try editing `src/index.ts` — change the greeting from `"hello"` to `"kia ora"` in `eks.manifest.json5`'s `configurationSchema`. The dev server reloads automatically:

```bash
curl 'http://localhost:9100/api/v1/extensions/my-first-ext/route/greet?name=amara'
# → { "message": "kia ora, amara!", "visits": 3 }
```

## 6. Read what you've got (11 minutes)

By minute 30 you have:
- A working extension that registers an HTTP route, subscribes to a domain event, reads and writes per-installation storage, and emits metrics.
- A passing test suite.
- A local runtime that mounts the extension exactly as production would.
- An understanding of the SDK surface (`ctx.apis`, `ctx.events`, `ctx.storage`, `ctx.cache`, `ctx.config`, `ctx.logger`, `ctx.metrics`).

Spend the last 11 minutes reading:
- `SDK_GUIDE.md` §2 (the `ExtensionContext` surface).
- `SDK_GUIDE.md` §3–§14 (each capability, with examples).
- `EXTENSION_AUTHORING.md` §9 (common patterns).
- `EXTENSION_AUTHORING.md` §10 (anti-patterns to avoid).

You're now ready to publish.

---

# Minute 30–60 — Package and publish

## 7. Generate a signing keypair (if you haven't already) (2 minutes)

If you skipped step 0:

```bash
eks keys generate --publisher pub_acme --key-id key-2025-01
# Enter passphrase: ********
# Confirm passphrase: ********
# → wrote ~/.eks/keys/pub_acme_key-2025-01.pem
# → wrote ~/.eks/keys/pub_acme_key-2025-01.pub
# → public key fingerprint: sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

Submit the public key to the platform team. They register it against your `Publisher` row. Until then, `eks publish` will fail at Stage 5 (publisher verification).

## 8. Package the extension (5 minutes)

```bash
eks package --git --reproducible --verify-reproducibility
# ✓ stage 1/8 — manifest validation
# ✓ stage 2/8 — dependency locking (3 deps, 0 forbidden)
# ✓ stage 3/8 — bundling (4.2 KB)
# ✓ stage 4/8 — static asset collection (0 assets)
# ✓ stage 5/8 — integrity manifest (5 files)
# ✓ stage 6/8 — signing (Ed25519, key-2025-01)
# ✓ stage 7/8 — compression (tar+zstd, 4_821 bytes)
# ✓ stage 8/8 — reproducibility verification (byte-identical)
# → dist/my-first-ext-0.1.0.ekx
```

Inspect the package:

```bash
eks inspect dist/my-first-ext-0.1.0.ekx
# Package:  my-first-ext-0.1.0.ekx
# Size:     4_821 bytes
# SHA-256:  9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
# Signed:   pub_acme / key-2025-01 (Ed25519)
# Files:
#   manifest.json5      1_234 bytes  sha256-abc…
#   index.mjs           4_321 bytes  sha256-def…
#   index.mjs.map       8_765 bytes  sha256-ghi…
#   eks-lock.json         567 bytes  sha256-jkl…
#   integrity.json        890 bytes  sha256-mno…
#   signature.bin          64 bytes  sha256-pqr…
```

The package is signed, integrity-stamped, and reproducible. You could ship this exact `.ekx` to a customer and they could verify it independently.

## 9. Publish to the private registry (5 minutes)

```bash
eks publish --notes "Initial release of my-first-ext" --wait
# → stage 1/8 — authentication ✓
# → stage 2/8 — package verification ✓
# → stage 3/8 — compatibility check ✓
# → stage 4/8 — malware scan (clean) ✓
# → stage 5/8 — publisher verification ✓
# → stage 6/8 — semver check ✓
# → stage 7/8 — create ExtensionVersion + Package rows ✓
# → stage 8/8 — staged rollout (0% → ready)
# → published my-first-ext@0.1.0
```

`eks publish --wait` blocks until the version reaches `PUBLISHED` status. The whole pipeline typically completes in 5–15 seconds; the `--wait` flag is for CI scripts that need a deterministic completion signal.

## 10. Verify the publication (3 minutes)

```bash
eks info my-first-ext
# Extension:  my-first-ext
# Publisher:  pub_acme (Acme, ACTIVE)
# Kind:       extension
# Versions:   1 published
#   0.1.0  PUBLISHED  2025-01-15  sha256=9f86d0…  rollout=0%
# Required capabilities: invoke.apis, subscribe.events, publish.events, access.storage, access.cache
# Required events:      booking.created.v1
# Required secrets:     (none)
# Compatibility:        eks-platform ^3.0.0
```

The extension is in the registry. No installations yet (rollout is 0% — but since this is your first install, you'll install it explicitly in the next section).

## 11. Read what you've shipped (15 minutes)

By minute 60 you have:
- A signed, integrity-stamped `.ekx` package.
- A published `ExtensionVersion` row in the private registry.
- A `Package` row with the SHA-256, Ed25519 signature, and lockfile persisted for verification.

Spend the remaining 15 minutes reading:
- `PACKAGING_GUIDE.md` §3 (the eight-stage pipeline you just ran).
- `PACKAGING_GUIDE.md` §6 (dependency validation rules — what you cannot bundle).
- `PUBLISHING_GUIDE.md` §3 (the eight publishing stages).
- `PUBLISHING_GUIDE.md` §4 (staged rollout — what you'll do for your next version).
- `SECURITY_MODEL.md` §2 (the signing model you just used).

---

# Minute 60–90 — Install, observe, and operate

## 12. Open the Developer Console (2 minutes)

Browse to `https://console.eks.food/developer` (or your tenant's Console URL). Sign in with your M2 session. You should see:

- **Registry** tab: `my-first-ext` is listed under your publisher.
- **Pending Installs** tab: empty (no one has installed it yet).

## 13. Install the extension (5 minutes)

In the Console:

1. Click **Registry** → **my-first-ext**.
2. Click **Install**.
3. The install-review page renders:

   ```
   Install: my-first-ext 0.1.0
   Publisher: Acme (verified, ACTIVE)

   Capabilities (5 declared, 0 high-risk):
     ✓ invoke.apis           — Register HTTP handlers; call APIs
     ✓ subscribe.events      — Subscribe to domain events
     ✓ publish.events        — Publish integration events
     ✓ access.storage        — Per-installation key/value storage
     ✓ access.cache          — Per-installation cache

   Required events (1):
     ✓ booking.created.v1     — emitted when a booking is created

   Compatibility: eks-platform ^3.0.0 (you are on 3.1.2) ✓

   Package: 4_821 bytes, sha256=9f86d0…, signed by pub_acme/key-2025-01 ✓

   [ Reject ]                              [ Approve & Install ]
   ```

4. Click **Approve & Install**. The Console redirects to the installation page, which shows status `PENDING` then `ACTIVE` within ~2 seconds.

Alternatively, install via the CLI:

```bash
eks install my-first-ext --tenant org_dev --auto-approve --wait
# → install pending... active (2.1s)
```

## 14. Inspect the installation (3 minutes)

In the Console:

- **Installed Extensions** tab: `my-first-ext` is listed, version `0.1.0`, status `ACTIVE`.
- Click into it: tabs for **Routes**, **Subscriptions**, **Logs**, **Events**, **Configuration**, **Secrets**, **Health**.

Or via the CLI:

```bash
eks info my-first-ext --tenant org_dev
# Extension:  my-first-ext
# Installation: inst_<cuid>  status=ACTIVE  version=0.1.0  activated=2025-01-15T10:35:00Z
# Routes: greet:GET
# Subscriptions: booking.created.v1
# Storage: 0 keys
# Secrets: (none)
# Health: healthy (last check 8s ago)
```

## 15. Call the extension's route (3 minutes)

The extension's route is now live at `https://api.eks.food/api/v1/extensions/my-first-ext/route/greet`. Call it with your session cookie (the Console's "Try it out" widget does this for you), or with an API key:

```bash
# Get an API key from the Console (Identity → API Keys → New API Key, scopes: extension.invoke)
export EKS_API_KEY=eks_live_...

curl -H "Authorization: Bearer $EKS_API_KEY" \
     'https://api.eks.food/api/v1/extensions/my-first-ext/route/greet?name=amara'
# → { "message": "hello, amara!", "visits": 1 }
```

## 16. Inspect the logs (5 minutes)

```bash
eks logs --extension my-first-ext --tail
# 2025-01-15T10:35:00Z info  my-first-ext@0.1.0  extension_ready version=0.1.0
# 2025-01-15T10:36:12Z info  my-first-ext@0.1.0  greeting_served name=amara visits=1
# 2025-01-15T10:36:18Z info  my-first-ext@0.1.0  greeting_served name=amara visits=2
```

In the Console, the **Logs** tab shows the same rows with a filter UI. Try filtering by `level=warn` (you should see no rows — the extension has not warned yet).

## 17. Trigger an event delivery (5 minutes)

The extension subscribes to `booking.created.v1`. To trigger a delivery, you need a booking to be created. In the Console:

1. Navigate to **Bookings** (the regular Eks-Food app, not the Developer Console).
2. Create a test booking for a test customer.
3. The platform emits `booking.created.v1` to the outbox; the relay worker publishes it to the EventBus; the runtime's subscriber routes it to your extension.

Or via the CLI (synthesised event for testing):

```bash
eks events:emit --type booking.created.v1 \
                --aggregate-id b_test_002 \
                --payload '{"bookingId":"b_test_002","customerId":"u_amara","regionId":"east-legon","total":{"amount":5000,"currency":"usd"}}' \
                --tenant org_dev
# → emitted booking.created.v1 (eventId=evt_test_002)

eks logs --extension my-first-ext --tail
# ...
# 2025-01-15T10:38:00Z info  my-first-ext@0.1.0  booking_seen bookingId=b_test_002 customerId=u_amara
```

## 18. Inspect the audit log (3 minutes)

```bash
eks audit --extension my-first-ext --since 1h
# 2025-01-15T10:35:00Z  EXTENSION_INSTALLED            actor=u_amara  version=0.1.0
# 2025-01-15T10:35:00Z  EXTENSION_PERMISSION_GRANTED   actor=u_amara  permission=invoke.apis
# 2025-01-15T10:35:00Z  EXTENSION_PERMISSION_GRANTED   actor=u_amara  permission=subscribe.events
# 2025-01-15T10:35:00Z  EXTENSION_PERMISSION_GRANTED   actor=u_amara  permission=publish.events
# 2025-01-15T10:35:00Z  EXTENSION_PERMISSION_GRANTED   actor=u_amara  permission=access.storage
# 2025-01-15T10:35:00Z  EXTENSION_PERMISSION_GRANTED   actor=u_amara  permission=access.cache
# 2025-01-15T10:35:00Z  EXTENSION_ACTIVATED            actor=u_amara  version=0.1.0
# 2025-01-15T10:36:12Z  EXTENSION_EGRESS               actor=u_amara  method=GET  url=…  status=200
# 2025-01-15T10:38:00Z  EXTENSION_EVENT_DELIVERED      actor=u_amara  type=booking.created.v1  eventId=evt_test_002
```

Every lifecycle event and every capability call is recorded. The audit log is your forensic record — if anything goes wrong, this is where you look first.

## 19. Roll out to a wider audience (1 minute)

For a real release, you'd bump the rollout percentage. For your first extension, you can leave it at 0% (you installed it explicitly, which bypasses the rollout). To practise the flow:

```bash
eks rollout my-first-ext@0.1.0 --percentage 10
# → bumped my-first-ext@0.1.0 to 10% (hash strategy)
# → ~10% of installations will auto-upgrade in the next 5 minutes
```

Since your tenant is the only one with the extension installed, this has no visible effect — but you've now exercised the rollout command. Bump it back to 0%:

```bash
eks rollout my-first-ext@0.1.0 --percentage 0
```

## 20. Read what you've operated (3 minutes)

By minute 90 you have:
- A published extension, installed in your dev tenant, actively serving HTTP requests and reacting to domain events.
- A working knowledge of the Console's install/log/audit tabs.
- Practised the CLI commands you'll use day-to-day.

Spend the last 3 minutes bookmarking:
- `CLI_GUIDE.md` §3 (command reference).
- `SDK_GUIDE.md` §2 (the `ExtensionContext` surface).
- `PERMISSION_MODEL.md` §2 (the capability registry).
- `SECURITY_MODEL.md` §10 (incident response).

You're now a productive Eks-Food extension author.

---

# The `@eks/*` package cheat-sheet

A one-page reference for the M1, M2, and M3 `@eks/*` packages. The Developer Platform touches every package; the cheat-sheet maps each package to "what it does for you".

## M1 — Platform Foundation

| Package | What it does for you as an extension author |
|---|---|
| `@eks/common` | Branded UUID/ISODate types, `Money` VO, `Result<T,E>`, exponential backoff, `CircuitBreaker`. Used internally by `ctx.retry` and `ctx.connector.circuitBreaker`. |
| `@eks/config` | Zod-validated `AppConfigSchema`, `getConfig()` singleton. You don't see this directly — your `ctx.config` is materialised from `ExtensionConfiguration`. |
| `@eks/errors` | `AppError` hierarchy, RFC 7807 problem+json. Throw `ValidationError`, `BusinessRuleError`, `ForbiddenError` from your handlers — the runtime maps them to HTTP responses. |
| `@eks/observability` | `Logger`, `Metrics`, `Tracer`, `HealthRegistry`, `AuditLog`. Exposed via `ctx.logger`, `ctx.metrics`, `ctx.tracer`. |
| `@eks/events` | `DomainEvent`, `EventBus`, `EventOutbox`, `DeadLetterQueue`, `InMemoryEventStore`. Exposed via `ctx.events`. |
| `@eks/cache` | `Cache` interface, in-memory cache, single-flight `getOrSet`. Exposed via `ctx.cache`. |
| `@eks/features` | `FeatureFlagService`, `FLAG_KEYS`. Exposed via `ctx.features`. |
| `@eks/api` | `apiHandler`, Zod validation, rate limiter, idempotency, OpenAPI. The wrapper around every `/api/v1/*` route, including your extension's. |
| `@eks/workers` | `JobQueue`, scheduler. Drives the runtime's scheduled jobs (`extensions.gc`, `extensions.healthcheck`, `extensions.replay`). |
| `@eks/security` | AES-256-GCM crypto, signed cookies, input sanitisation, RBAC matrix. Used for `Secret` encryption, session cookies, and the M2 `authorize()` foundation. |
| `@eks/payments` | Provider-agnostic `PaymentProvider` port. Not exposed to extensions directly (extensions reach payments via `ctx.apis.invoke("ext:payments", …)`). |
| `@eks/domain` | 21 bounded contexts. The `developer` context owns `ApiKeyAggregate`, `WebhookAggregate`, `IntegrationAggregate` — the abstractions your extension invokes through `ctx.apis.invoke`. |
| `@eks/testing` | Factories, fixtures, `mockRepository`, HTTP helpers. The `createExtensionHarness` and `createConnectorHarness` you use in `eks test`. |

## M2 — Identity & Access Management

| Package | What it does for you as an extension author |
|---|---|
| `@eks/identity` | `IDENTITY_EVENTS` registry, `buildIdentityEvent` factory, `IDENTITY_AUDIT_ACTIONS` vocabulary. The events your extension subscribes to (`identity.user.registered.v1`, etc.) are defined here. |
| `@eks/auth` | Password, MFA, magic-link, passkey, session lifecycle. Every `/api/v1/extensions/*` call is authenticated by `@eks/auth/middleware` before your handler runs. |
| `@eks/authorization` | RBAC + ABAC engine, `Principal`, `authorize()`. Every route invocation is authorized by `@eks/authorization` before your handler runs. |
| `@eks/organizations` | Tenants, memberships, teams. Your extension's `organizationId` comes from the active `Membership`. |
| `@eks/notifications` | Email + SMS + push. Reach via `ctx.apis.invoke("ext:notifications", "sendEmail", …)`. |
| `@eks/verification` | Identity verification (KYC, document checks). Reach via `ctx.apis.invoke("ext:verification", …)`. |

## M3 — Developer Platform

| Package | What it does for you as an extension author |
|---|---|
| `@eks/sdk` | The `ExtensionContext` surface. **The only package you import directly in extension code.** See `SDK_GUIDE.md`. |
| `@eks/connector-sdk` | The `Connector` interface (`authenticate`, `poll`, `handleWebhook`, `sync`, `mapSchema`, `healthCheck`) and built-in capabilities (retry, pagination, cursors, circuit breakers). Import only if your `kind = "connector"`. See `CONNECTOR_SDK_GUIDE.md`. |
| `@eks/runtime` | The host-side runtime (lifecycle, isolate pool, sandbox, health reporting). You don't import this; it imports your extension. See `RUNTIME_ARCHITECTURE.md`. |
| `@eks/workflow` | The `WorkflowDefinition` executor. Reach via `ctx.workflow.start` (if your manifest declares `manage.workflows` or `invoke.workflows`). |
| `@eks/registry` | The package store + publishing pipeline. You interact with it via `eks publish`, `eks install`, the Console, and the `/api/v1/extensions/*` routes. |
| `@eks/dev-cli` | The `eks` command. The single entry point for authoring, testing, packaging, publishing, and operations. See `CLI_GUIDE.md`. |
| `@eks/developer` | The cross-cutting domain-events & audit-codes package. You don't import it directly in extension code (it's a platform-internal package), but it defines the canonical `DEVELOPER_EVENTS` registry (19 events: `Extension.Installed`, `Extension.Upgraded`, `Connector.Executed`, `Workflow.Started`, `Event.Replayed`, `Package.Published`, `Secret.Rotated`, etc.) and the `DEVELOPER_AUDIT_ACTIONS` registry (25 codes). Every event the runtime emits on your extension's behalf and every audit row it writes is drawn from these registries — so when you grep the audit log via `eks audit`, the codes you see are stable, enumerable, and documented in `SECURITY_MODEL.md` §6. |

---

# Where to go next

- **Build a real extension.** Pick a real need in your tenant (a notification, a report, an integration) and build it. The hello-world is intentionally minimal; real extensions exercise more of the SDK surface.
- **Build a connector.** If you integrate with an external system, build a `kind: "connector"` extension. The `CONNECTOR_SDK_GUIDE.md` walks through the Acme POS reference implementation.
- **Read the security model end-to-end.** `SECURITY_MODEL.md` is required reading before you publish anything that touches customer data. The signing-key rotation flow (§2.4) and the incident-response flows (§10) are the two sections you should be able to execute from memory.
- **Set up CI.** A minimal CI pipeline is: `eks validate --strict` → `eks test --coverage --coverage-threshold 80` → `eks package --git --reproducible --verify-reproducibility` → `eks publish --dry-run` (on PRs) / `eks publish --wait` (on merge to main). See `CLI_GUIDE.md` §24 for exit codes.
- **Join `#eks-developers` on Slack.** The platform team and other publishers hang out there. File bugs and capability requests in the `eks-platform` GitHub repo.

Welcome to the platform.

---

# Cross-references

| Topic | Document |
|---|---|
| Platform architecture | `ARCHITECTURE.md` |
| `@eks/sdk` API reference | `SDK_GUIDE.md` |
| `@eks/connector-sdk` reference | `CONNECTOR_SDK_GUIDE.md` |
| Extension authoring (manifest, project layout) | `EXTENSION_AUTHORING.md` |
| Packaging pipeline | `PACKAGING_GUIDE.md` |
| Publishing pipeline | `PUBLISHING_GUIDE.md` |
| Runtime internals | `RUNTIME_ARCHITECTURE.md` |
| Security model | `SECURITY_MODEL.md` |
| Permission model | `PERMISSION_MODEL.md` |
| CLI command reference | `CLI_GUIDE.md` |
| M1 platform docs | `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/EVENT_CONVENTIONS.md` |
| M2 IAM docs | `docs/identity/ARCHITECTURE.md`, `docs/identity/AUTHORIZATION_POLICIES.md`, `docs/identity/MULTI_TENANCY.md` |
