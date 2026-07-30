# Eks-Food Developer CLI — `@eks/dev-cli`

> **Audience:** Extension authors and platform operators. Read alongside `EXTENSION_AUTHORING.md` (project layout), `PACKAGING_GUIDE.md` (the `package` command), `PUBLISHING_GUIDE.md` (the `publish` and `rollout` commands), `SDK_GUIDE.md` (what the local dev server mounts), and `DEVELOPER_ONBOARDING.md` (the 30/60/90 walkthrough that uses this CLI end-to-end).
>
> **Status:** Milestone 3. The `@eks/dev-cli` package provides the `eks` command — the single entry point for extension authoring, testing, packaging, publishing, installation, and operational inspection. This document is the canonical reference for every command, flag, and example.

---

## 1. Installation

```bash
# Globally (recommended for everyday use):
npm install -g @eks/dev-cli
# or
bun add -g @eks/dev-cli

# Locally (per-project; pins the CLI version per repo):
bun add -d @eks/dev-cli
```

Verify:

```bash
eks --version
# eks/3.1.2 (@eks/dev-cli)
#   node/20.11.0
#   platform-compat: ^3.0.0
```

The CLI requires Node.js 20+ and Bun 1.1+ (Bun is used for the dev workflow and the bundler; Node is the production runtime). The CLI auto-detects Bun if present; if absent, it falls back to npm for installation but cannot run `eks dev` or `eks test` (which require Bun).

---

## 2. Configuration

The CLI reads configuration from three layers (later layers override earlier):

1. **Global defaults** — built into the CLI (e.g. `registry = https://registry.eks.food`).
2. **`~/.eks/config.json5`** — per-user configuration (e.g. your default publisher, your default tenant).
3. **`./.eks/dev.json5`** — per-project configuration (e.g. local dev secrets, fake Principals).

A typical `~/.eks/config.json5`:

```json5
{
  "registry": "https://registry.eks.food",
  "publisher": "pub_acme",
  "signingKeyPath": "~/.eks/keys/pub_acme_key-2025-01.pem",
  "signingKeyId": "key-2025-01",
  "defaultTenant": "org_dev",
  "outputFormat": "table",    // "table" | "json" | "yaml"
  "color": true,
  "telemetry": "off"          // "off" | "errors" | "all"
}
```

A typical `.eks/dev.json5` (per-project, gitignored):

```json5
{
  "tenant": {
    "id": "org_dev",
    "region": "east-legon",
    "name": "Dev Org"
  },
  "principals": [
    {
      "id": "u_amara",
      "name": "Amara",
      "roles": ["ADMIN"],
      "permissions": ["booking.read", "booking.create", "extension.invoke", "extension.manage"]
    },
    {
      "id": "u_kweku",
      "name": "Kweku",
      "roles": ["COOK"],
      "permissions": ["booking.read"]
    }
  ],
  "secrets": {
    "STRIPE_SECRET_KEY": "sk_test_…",
    "ACME_API_KEY": "acme_key_…"
  },
  "egress": {
    "mode": "record",          // "record" | "replay" | "live"
    "logPath": ".eks/egress.log"
  },
  "events": {
    "fixturesPath": "tests/fixtures/events"
  }
}
```

---

## 3. Command reference

The CLI's commands are grouped by lifecycle stage:

| Group | Commands |
|---|---|
| **Project** | `eks create`, `eks manifest:generate` |
| **Validation** | `eks validate` |
| **Local dev** | `eks dev`, `eks test`, `eks logs` |
| **Packaging** | `eks package`, `eks keys` |
| **Registry** | `eks publish`, `eks install`, `eks upgrade`, `eks rollback`, `eks yank` |
| **Rollout** | `eks rollout` |
| **Operations** | `eks events:replay`, `eks audit`, `eks permissions` |
| **Secrets** | `eks secrets` |

Each command is documented below with its usage, flags, and examples.

---

## 4. `eks create`

Scaffolds a new extension or connector project.

### Usage

```bash
eks create <name> [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--kind` | `extension` \| `connector` | `extension` | Project kind |
| `--slug` | string | (derived from `<name>`) | Extension slug |
| `--publisher` | string | (from config) | Publisher id |
| `--template` | `hello-world` \| `event-driven` \| `connector` \| `blank` | `hello-world` | Starter template |
| `--directory` | path | `./<name>` | Output directory |
| `--license` | string | `Apache-2.0` | License SPDX identifier |
| `--install-deps` | bool | `true` | Run `bun install` after scaffolding |
| `--git-init` | bool | `true` | Initialise a git repo |

### Examples

```bash
# Default scaffold (hello-world extension):
eks create my-hello

# Connector scaffold:
eks create acme-pos --kind connector --slug acme-pos --template connector

# Event-driven extension scaffold:
eks create loyalty-engine --template event-driven --publisher pub_acme

# Blank project (no starter code; just manifest + entrypoint stub):
eks create experimental-thing --template blank
```

### Output

A new directory containing the project layout documented in `EXTENSION_AUTHORING.md` §2. The CLI prints next-step instructions:

```
✓ Created my-hello in ./my-hello
  Next steps:
    cd my-hello
    eks validate
    eks test
    eks dev
```

---

## 5. `eks validate`

Validates the manifest, the project structure, and (optionally) the bundled output.

### Usage

```bash
eks validate [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--strict` | bool | `false` | Enable extra checks (see below) |
| `--manifest` | path | `./eks.manifest.json5` | Manifest path |
| `--bundler-dry-run` | bool | `true` | Run a bundler dry-run to catch syntax errors |
| `--check-compatibility` | bool | `true` | Verify `compatibilityRanges` against the installed CLI |
| `--check-secrets` | bool | `false` | Verify every `requiredSecrets` entry has a `.eks/dev.json5` value |
| `--check-events` | bool | `false` | Verify every `requiredEvents` entry has a fixture |

### Strict-mode checks

- Every `requiredSecrets` entry must have a corresponding `.eks/dev.json5` entry.
- Every `requiredEvents` entry must have at least one fixture under `tests/fixtures/events/<eventType>.json`.
- Every `metricsDeclared` entry must be emitted by at least one test.
- Every `scheduledJobs` entry must have a corresponding `ctx.scheduled.register` call in `src/index.ts`.
- The manifest's `permissions` array must be minimal — every capability must be exercised by the bundled code (heuristic; may produce false positives).

### Examples

```bash
eks validate
# ✓ manifest is valid (slug, version, capabilities, permissions, configurationSchema)
# ✓ compatibility ranges satisfied (eks-platform ^3.0.0 → 3.1.2)
# ✓ bundler dry-run succeeded (4.2 KB output)
# ✓ no forbidden imports detected

eks validate --strict
# ✓ manifest is valid
# ✓ compatibility ranges satisfied
# ✓ bundler dry-run succeeded
# ✓ no forbidden imports detected
# ✓ all requiredSecrets have dev values (1/1)
# ✓ all requiredEvents have fixtures (2/2)
# ✓ all metricsDeclared are emitted in tests (3/3)
# ✓ all scheduledJobs are registered (1/1)
# ⚠ 1 capability may be unused: "delegate.auth" (heuristic; ignore if false positive)
```

---

## 6. `eks build`

Runs the bundler and produces the bundled output (without signing or packaging). Useful for inspecting the bundle size and verifying the bundler config.

### Usage

```bash
eks build [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--out` | path | `./dist/build/` | Output directory |
| `--minify` | bool | `true` | Minify the bundle |
| `--sourcemap` | bool | `true` | Generate external source map |
| `--watch` | bool | `false` | Watch mode (rebuild on file change) |
| `--analyze` | bool | `false` | Produce a bundle-size analysis (`dist/build/analyze.html`) |

### Examples

```bash
eks build
# ✓ bundled dist/build/index.mjs (4.2 KB, 1.8 KB gzipped)
# ✓ source map dist/build/index.mjs.map (8.7 KB)

eks build --analyze
# ✓ bundled dist/build/index.mjs (4.2 KB)
# ✓ analysis dist/build/analyze.html (open in browser to inspect)

eks build --watch
# watching src/**/* for changes...
# 10:31:05 rebuild succeeded (4.2 KB)
# 10:31:42 rebuild succeeded (4.3 KB)
```

---

## 7. `eks test`

Runs the Vitest suite under `tests/` with the `@eks/testing` harness materialised.

### Usage

```bash
eks test [options] [test-filter]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--watch` | bool | `false` | Watch mode |
| `--coverage` | bool | `false` | Produce a coverage report |
| `--coverage-threshold` | number | `80` | Minimum coverage % (CI gate) |
| `--reporter` | `default` \| `verbose` \| `json` \| `junit` | `default` | Reporter |
| `--bail` | number | `0` | Stop after N failures (0 = no bail) |
| `--timeout` | number | `5000` | Per-test timeout (ms) |
| `--egress-mode` | `record` \| `replay` \| `live` | `replay` | Egress mode (see below) |

### Egress modes

- `replay` (default): the test harness replays recorded egress calls from `.eks/egress.log`. No real network calls. Use this in CI.
- `record`: the test harness makes real network calls and records them to `.eks/egress.log`. Use this when adding new fixtures.
- `live`: the test harness makes real network calls and does not record. Use this for smoke tests against a staging environment.

### Examples

```bash
eks test
# ✓ tests/handlers/greet.spec.ts (2 tests) 12ms
# ✓ tests/subscribers/booking.created.spec.ts (1 test) 18ms
# 3 tests passed, 0 failed

eks test --coverage --coverage-threshold 90
# ✓ tests/handlers/greet.spec.ts (2 tests) 12ms
# ✓ tests/subscribers/booking.created.spec.ts (1 test) 18ms
# 3 tests passed, 0 failed
# coverage: 94.2% (threshold: 90%)

eks test "booking.created" --reporter verbose
# RUN  v3.1.2
#  ✓ tests/subscribers/booking.created.spec.ts (1) 18ms
#     ✓ booking.created.v1 awards 100 points
# Test Files  1 passed (1)
#      Tests  1 passed (1)
```

---

## 8. `eks package`

Packages the project into a signed `.ekx` file. See `PACKAGING_GUIDE.md` for the full pipeline.

### Usage

```bash
eks package [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--sign` | bool | `true` | Sign the package |
| `--key` | path | (from config) | Path to the Ed25519 private key |
| `--key-id` | string | (from config) | Key id to record in `Package.signingKeyId` |
| `--reproducible` | bool | `true` in CI | Omit build-time metadata |
| `--verify-reproducibility` | bool | `true` | Re-run packaging and assert byte-identity |
| `--git` | bool | `false` | Record `sourceCommitSha` + `sourceTreeHash` from git |
| `--bundler` | string | `esbuild@0.21.0` | Override the bundler |
| `--no-minify` | bool | `false` | Skip minification (debugging only) |
| `--no-sourcemap` | bool | `false` | Skip source map generation |
| `--strict` | bool | `false` | Enable extra manifest + lockfile checks |
| `--out` | path | `./dist/` | Output directory |

### Examples

```bash
# Standard packaging (CI):
eks package --git --reproducible --verify-reproducibility
# ✓ stage 1/8 — manifest validation
# ✓ stage 2/8 — dependency locking (3 deps, 0 forbidden)
# ✓ stage 3/8 — bundling (4.2 KB)
# ✓ stage 4/8 — static asset collection (3 assets)
# ✓ stage 5/8 — integrity manifest (8 files)
# ✓ stage 6/8 — signing (Ed25519, key-2025-01)
# ✓ stage 7/8 — compression (tar+zstd, 18_512 bytes)
# ✓ stage 8/8 — reproducibility verification (byte-identical)
# → dist/loyalty-engine-1.0.0.ekx

# Debug packaging (no minify, no sourcemap, no sign):
eks package --no-minify --no-sourcemap --sign=false --out dist/debug/
# → dist/debug/loyalty-engine-1.0.0.ekx (12_345 bytes, unsigned)
```

---

## 9. `eks install`

Installs a published extension into a tenant. Can also install a local `.ekx` for testing.

### Usage

```bash
eks install <extensionId[@version]> [options]
# or
eks install --local <path-to-ekx> [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--tenant` | string | (from config) | Target tenant |
| `--version` | string | latest | Version to install |
| `--local` | path | — | Install a local `.ekx` (bypasses the registry) |
| `--auto-approve` | bool | `false` | Skip the permission review prompt (CI only) |
| `--set-secret` | string | — | Set a secret during install (repeatable): `NAME=value` |
| `--set-config` | string | — | Set a config value during install (repeatable): `key=value` |
| `--wait` | bool | `false` | Block until the installation reaches ACTIVE |

### Examples

```bash
# Install from the registry:
eks install loyalty-engine --tenant org_abc
# → resolves latest version, prompts for permission review, installs

# Install a specific version:
eks install loyalty-engine@1.0.0 --tenant org_abc

# Install with secrets and config:
eks install loyalty-engine --tenant org_abc \
  --set-secret STRIPE_SECRET_KEY=sk_live_... \
  --set-secret ACME_API_KEY=acme_... \
  --set-config pointsPerBooking=150 \
  --set-config redemptionFloor=75

# Install a local .ekx (testing):
eks install --local dist/loyalty-engine-1.0.0.ekx --tenant org_dev --auto-approve
# → bypasses registry verification; uses the local .ekx bytes

# Wait for activation:
eks install loyalty-engine --tenant org_abc --wait
# → install pending... active (3.2s)
```

---

## 10. `eks publish`

Publishes a packaged `.ekx` to the private registry. See `PUBLISHING_GUIDE.md` for the full pipeline.

### Usage

```bash
eks publish [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--registry` | url | (from config) | Registry URL |
| `--package` | path | `./dist/<slug>-<version>.ekx` | Path to the `.ekx` |
| `--key` | path | (from config) | Path to the publisher's private key |
| `--key-id` | string | (from config) | Key id |
| `--notes` | string | — | Release notes (markdown) |
| `--notes-file` | path | — | Read release notes from a file |
| `--compatibility-check` | bool | `true` | Verify `compatibilityRanges` before publish |
| `--scan` | bool | `true` | Run the malware scanner |
| `--confirm-breaking` | bool | `false` | Required for MAJOR version bumps |
| `--dry-run` | bool | `false` | Run all stages but do not commit |
| `--wait` | bool | `false` | Block until the version reaches PUBLISHED |
| `--timeout` | seconds | `300` | Max wait time for `--wait` |

### Examples

```bash
# Initial publish:
eks publish --notes "Initial release" --wait
# → stage 1/8 — authentication ✓
# → stage 2/8 — package verification ✓
# → stage 3/8 — compatibility check ✓
# → stage 4/8 — malware scan (clean) ✓
# → stage 5/8 — publisher verification ✓
# → stage 6/8 — semver check ✓
# → stage 7/8 — create ExtensionVersion + Package rows ✓
# → stage 8/8 — staged rollout (0% → ready)
# → published loyalty-engine@1.0.0

# Major version:
eks publish --notes "Breaking: removed legacy /v1/redeem route" --confirm-breaking

# Dry run (for CI):
eks publish --dry-run

# Publish with file-based release notes:
eks publish --notes-file RELEASE_NOTES.md
```

---

## 11. `eks upgrade`

Upgrades an installation to a new version.

### Usage

```bash
eks upgrade <extensionId> --version <version> [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--tenant` | string | (from config) | Target tenant |
| `--version` | string | (required) | Target version |
| `--auto-approve` | bool | `false` | Skip the permission re-review if new permissions are required |
| `--wait` | bool | `false` | Block until the upgrade completes |

### Examples

```bash
# Upgrade to a specific version:
eks upgrade loyalty-engine --version 1.1.0 --tenant org_abc

# Wait for the upgrade to complete:
eks upgrade loyalty-engine --version 1.1.0 --tenant org_abc --wait
# → upgrade pending... active (4.1s)
```

---

## 12. `eks rollback`

Rolls back an installation to a previous version.

### Usage

```bash
eks rollback --installation <id> --to-version <version> [options]
# or
eks rollback --extension <slug> --to-version <version> [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--installation` | string | — | Installation id (mutually exclusive with `--extension`) |
| `--extension` | string | — | Extension slug (resolves to the tenant's installation) |
| `--tenant` | string | (from config) | Target tenant (with `--extension`) |
| `--to-version` | string | (required) | Target version |
| `--reason` | string | `"manual"` | Reason (recorded in audit log) |
| `--wait` | bool | `false` | Block until the rollback completes |

### Examples

```bash
# Rollback by installation id:
eks rollback --installation inst_abc --to-version 1.0.0 --reason "1.1.0_data_loss_bug"

# Rollback by extension slug:
eks rollback --extension loyalty-engine --to-version 1.0.0 --tenant org_abc
```

---

## 13. `eks yank`

Yanks (deprecates) a published version. Existing installations are unaffected; new installations cannot use the yanked version.

### Usage

```bash
eks yank <extensionId>@<version> --reason <reason> [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--reason` | string | (required) | Reason (recorded in audit log; surfaced in the Console) |
| `--publisher` | string | (from config) | Publisher id (must match the extension's publisher) |

### Examples

```bash
eks yank loyalty-engine@1.1.0 --reason "data_loss_bug"
# → yanked loyalty-engine@1.1.0
# → 0 active installations affected (use 'eks rollback' if any are still on 1.1.0)
```

---

## 14. `eks rollout`

Bumps the staged-rollout percentage for a published version.

### Usage

```bash
eks rollout <extensionId>@<version> --percentage <0-100> [options]
# or
eks rollout <extensionId>@<version> --promote [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--percentage` | number | — | Target rollout percentage (0-100) |
| `--promote` | bool | `false` | Promote to the next ring (only with `ring` strategy) |
| `--pause` | bool | `false` | Pause the rollout (auto-resume requires `--resume`) |
| `--resume` | bool | `false` | Resume a paused rollout |
| `--strategy` | `hash` \| `ring` \| `explicit` | (current) | Override the strategy |

### Examples

```bash
# Bump to 25%:
eks rollout loyalty-engine@1.1.0 --percentage 25
# → bumped loyalty-engine@1.1.0 to 25% (hash strategy)
# → ~25% of installations will auto-upgrade in the next 5 minutes

# Promote to general availability:
eks rollout loyalty-engine@1.1.0 --percentage 100

# Pause (e.g. after a health-gate failure):
eks rollout loyalty-engine@1.1.0 --pause
# → paused loyalty-engine@1.1.0 (was at 25%)

# Resume:
eks rollout loyalty-engine@1.1.0 --resume
```

---

## 15. `eks manifest:generate`

Generates a manifest skeleton from a TypeScript source file (e.g. by introspecting `defineExtension(...)` calls). Useful for jumpstarting a manifest from code, or for refreshing a manifest after adding new handlers.

### Usage

```bash
eks manifest:generate [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--entrypoint` | path | `./src/index.ts` | Entrypoint to introspect |
| `--out` | path | `./eks.manifest.json5` | Output manifest path |
| `--merge` | bool | `true` | Merge with the existing manifest (preserve fields not derivable from code) |
| `--slug` | string | (existing or derived) | Override slug |
| `--version` | string | (existing or `0.1.0`) | Override version |

### Examples

```bash
eks manifest:generate
# ✓ introspected src/index.ts
#   - 2 HTTP handlers: greet:GET, echo:POST
#   - 1 event subscriber: booking.created.v1
#   - 1 workflow step: compute_balance
#   - 1 scheduled job: nightly_digest
# ✓ merged with existing eks.manifest.json5 (preserved: permissions, requiredSecrets, allowedDomains)
# → wrote eks.manifest.json5
```

---

## 16. `eks logs`

Tails or queries `ExtensionLog` rows for an installation.

### Usage

```bash
eks logs [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--installation` | string | — | Filter by installation id |
| `--extension` | string | — | Filter by extension slug (resolves to all installations in tenant) |
| `--tenant` | string | (from config) | Target tenant |
| `--level` | `debug` \| `info` \| `warn` \| `error` | `info` | Minimum log level |
| `--since` | duration | `5m` | Lookback window (`5m`, `1h`, `24h`, etc.) |
| `--tail` | bool | `false` | Tail mode (stream new logs) |
| `--follow` | bool | `false` | Alias for `--tail` |
| `--filter` | string | — | Filter expression (e.g. `handler="redeem"`) |
| `--search` | string | — | Full-text search |

### Examples

```bash
# Tail logs for a specific installation:
eks logs --installation inst_abc --tail
# 2025-01-15T10:30:00Z info  loyalty-engine@1.0.0  extension_ready
# 2025-01-15T10:30:05Z info  loyalty-engine@1.0.0  awarded_points userId=u_1 award=100
# 2025-01-15T10:30:10Z warn  loyalty-engine@1.0.0  insufficient_points userId=u_2 requested=200 balance=50
# ...

# Query the last hour of warn+ logs for an extension:
eks logs --extension loyalty-engine --level warn --since 1h

# Filter by handler:
eks logs --extension loyalty-engine --filter 'handler="redeem"' --since 24h

# Full-text search:
eks logs --extension loyalty-engine --search "insufficient_points" --since 7d
```

---

## 17. `eks events:replay`

Triggers an `EventReplay` for an installation.

### Usage

```bash
eks events:replay [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--installation` | string | — | Installation id |
| `--extension` | string | — | Extension slug (resolves to all installations in tenant) |
| `--tenant` | string | (from config) | Target tenant |
| `--from` | ISO date | (required) | Replay start (inclusive) |
| `--to` | ISO date | (required) | Replay end (inclusive) |
| `--type` | string | — | Event type to replay (repeatable; default: all `requiredEvents`) |
| `--dry-run` | bool | `false` | Print the events that would be replayed without delivering them |
| `--wait` | bool | `false` | Block until the replay completes |
| `--timeout` | seconds | `600` | Max wait time for `--wait` |

### Examples

```bash
# Replay all declared events for the last 24h:
eks events:replay --extension loyalty-engine --from $(date -u -d '1 day ago' +%FT%TZ) --to $(date -u +%FT%TZ)
# → replay rpl_abc started
# → events scanned: 1234
# → events delivered: 1234
# → events skipped (idempotency): 0
# → completed in 8.2s

# Replay a specific event type:
eks events:replay --extension loyalty-engine --from 2025-01-01T00:00:00Z --to 2025-01-31T23:59:59Z --type booking.created.v1

# Dry run:
eks events:replay --extension loyalty-engine --from 2025-01-01T00:00:00Z --to 2025-01-02T00:00:00Z --dry-run
# → would replay 42 events (35 booking.created.v1, 7 booking.cancelled.v1)
```

---

## 18. `eks audit`

Queries the `AuditLog` for extension-related actions.

### Usage

```bash
eks audit [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--extension` | string | — | Filter by extension slug |
| `--installation` | string | — | Filter by installation id |
| `--tenant` | string | (from config) | Filter by tenant |
| `--action` | string | — | Filter by action code (repeatable) |
| `--actor` | string | — | Filter by actor user id |
| `--since` | duration | `24h` | Lookback window |
| `--limit` | number | `100` | Max rows to return |

### Examples

```bash
# All audit entries for an extension in the last 7 days:
eks audit --extension loyalty-engine --since 7d

# All permission grants:
eks audit --action EXTENSION_PERMISSION_GRANTED --since 30d

# All egress calls by a specific installation:
eks audit --installation inst_abc --action EXTENSION_EGRESS --since 1h
```

### Action code vocabulary

The `--action` flag accepts any of the 25 codes from the `DEVELOPER_AUDIT_ACTIONS` registry in `@eks/developer` (`src/packages/developer/audit-actions.ts`). Tab-completion in the CLI's interactive shell enumerates them; `eks audit --list-actions` prints the full list. The 25 codes are:

| Group | Codes |
|---|---|
| Extension lifecycle | `EXTENSION_INSTALLED`, `EXTENSION_ACTIVATED`, `EXTENSION_SUSPENDED`, `EXTENSION_REMOVED`, `EXTENSION_UPGRADED`, `EXTENSION_ROLLED_BACK`, `EXTENSION_HEALTH_CHECK`, `EXTENSION_LOG_EMITTED` |
| Connector lifecycle | `CONNECTOR_EXECUTED`, `CONNECTOR_FAILED` |
| Workflow lifecycle | `WORKFLOW_STARTED`, `WORKFLOW_COMPLETED`, `WORKFLOW_FAILED` |
| Eventing | `EVENT_REPLAYED` |
| Manifest | `MANIFEST_VALIDATED`, `MANIFEST_VALIDATION_FAILED` |
| Package | `PACKAGE_PUBLISHED`, `PACKAGE_SIGNATURE_VERIFIED` |
| Secrets | `SECRET_CREATED`, `SECRET_ROTATED`, `SECRET_ACCESSED` |
| Permissions | `PERMISSION_GRANTED`, `PERMISSION_DENIED` |
| Publisher | `PUBLISHER_VERIFIED` |
| Sandbox | `SANDBOX_VIOLATION` |

The four "negative-outcome" codes (`CONNECTOR_FAILED`, `MANIFEST_VALIDATION_FAILED`, `PERMISSION_DENIED`, `SANDBOX_VIOLATION`) record attempts that did **not** mutate an aggregate — they appear in the audit log only, never as a domain event in the outbox. The other 21 codes each pair with a `DEVELOPER_EVENTS` entry (e.g. `EXTENSION_INSTALLED` ↔ `Extension.Installed`) so a correlated query across `AuditLog` and `EventOutbox` is possible on the `(aggregateId, occurredAt)` pair.

---

## 19. `eks permissions`

Manages `ExtensionPermission` rows for an installation.

### Usage

```bash
eks permissions <subcommand> [options]
```

### Subcommands

| Subcommand | Description |
|---|---|
| `list` | List permissions for an installation |
| `grant` | Grant a permission |
| `revoke` | Revoke a permission |

### Examples

```bash
# List:
eks permissions list --installation inst_abc
# access.storage       granted 2025-01-15 by u_amara
# access.secrets       granted 2025-01-15 by u_amara
# invoke.apis          granted 2025-01-15 by u_amara
# ...

# Grant:
eks permissions grant --installation inst_abc --permission access.cache
# → granted access.cache to inst_abc

# Revoke:
eks permissions revoke --installation inst_abc --permission access.secrets --reason "no_longer_needed"
# → revoked access.secrets from inst_abc (reason: no_longer_needed)
```

---

## 20. `eks secrets`

Manages `Secret` rows for an installation.

### Usage

```bash
eks secrets <subcommand> [options]
```

### Subcommands

| Subcommand | Description |
|---|---|
| `list` | List secret names (values are not displayed) |
| `set` | Set or update a secret value (prompts for the value) |
| `rotate` | Rotate a secret (alias for `set` with an audit-flag) |
| `delete` | Delete a secret |

### Examples

```bash
# List:
eks secrets list --installation inst_abc
# STRIPE_SECRET_KEY   lastReadAt=2025-01-15T10:30:00Z  readCount=42  rotatedAt=2025-01-10
# ACME_API_KEY        lastReadAt=2025-01-15T10:29:55Z  readCount=18  rotatedAt=2025-01-10

# Set (interactive):
eks secrets set --installation inst_abc --name STRIPE_SECRET_KEY
# Enter value: ********
# → set STRIPE_SECRET_KEY for inst_abc (encrypted, key version 2)

# Set (non-interactive, from stdin):
echo "sk_live_..." | eks secrets set --installation inst_abc --name STRIPE_SECRET_KEY --stdin

# Rotate (same as set, but with an audit-flag):
eks secrets rotate --installation inst_abc --name STRIPE_SECRET_KEY

# Delete:
eks secrets delete --installation inst_abc --name ACME_API_KEY
# → deleted ACME_API_KEY from inst_abc (audit: EXTENSION_SECRET_DELETED)
```

---

## 21. `eks keys`

Manages the publisher's Ed25519 signing keys.

### Usage

```bash
eks keys <subcommand> [options]
```

### Subcommands

| Subcommand | Description |
|---|---|
| `generate` | Generate a new keypair |
| `rotate` | Submit a key-rotation request to the platform |
| `revoke` | Revoke a key (emergency) |
| `list` | List keys recorded for the publisher |

### Examples

```bash
# Generate a new keypair:
eks keys generate --publisher pub_acme --key-id key-2025-01
# → wrote ~/.eks/keys/pub_acme_key-2025-01.pem (private, encrypted)
# → wrote ~/.eks/keys/pub_acme_key-2025-01.pub (public)
# → public key fingerprint: sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
# → submit this public key to the platform team during onboarding

# Rotate:
eks keys rotate --publisher pub_acme \
                --new-key-id key-2026-01 \
                --new-public-key-file ~/.eks/keys/pub_acme_key-2026-01.pub \
                --signing-key ~/.eks/keys/pub_acme_key-2025-01.pem
# → submitted rotation request (signed by key-2025-01)
# → key-2026-01 added to activeKeyIds
# → key-2025-01 remains active for 30 days (then auto-removed)

# Revoke (emergency):
eks keys revoke --publisher pub_acme --key-id key-2025-01
# ⚠ This will auto-rollback every installation whose active Package was signed with key-2025-01.
#   Type the publisher id to confirm: pub_acme
# → revoked key-2025-01
# → 3 installations auto-rolled-back (see 'eks audit --action EXTENSION_ROLLED_BACK')

# List:
eks keys list --publisher pub_acme
# key-2025-01  active (rotating, expires 2025-02-15)  fingerprint=sha256:9f86d0…
# key-2026-01  active                                  fingerprint=sha256:3b1a40…
```

---

## 22. `eks dev`

Spins up a local runtime at `http://localhost:9100` that mounts your extension exactly as production would. See `EXTENSION_AUTHORING.md` §7 for the full dev workflow.

### Usage

```bash
eks dev [options]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--port` | number | `9100` | Port |
| `--tenant` | string | (from config) | Tenant id |
| `--principal` | string | (first from config) | Principal to impersonate |
| `--egress` | `record` \| `replay` \| `live` | `replay` | Egress mode |
| `--watch` | bool | `true` | Rebuild and reload on file change |
| `--inspect` | bool | `false` | Enable Node inspector (for debugging the extension) |

### Examples

```bash
eks dev
# → bundling...
# → runtime ready at http://localhost:9100
# → tenant: org_dev  principal: u_amara (ADMIN)
# → egress: replay (from .eks/egress.log)
# → watching src/**/* for changes

# In another terminal:
curl http://localhost:9100/api/v1/extensions/loyalty-engine/route/greet?name=amara
# → { "message": "hello, amara!", "visits": 1 }
```

---

## 23. Common workflows

### 23.1 First-time publish

```bash
eks create my-ext --publisher pub_acme
cd my-ext
eks validate --strict
eks test
eks package --git --reproducible
eks publish --notes "Initial release" --wait
```

### 23.2 Local iteration

```bash
eks dev &
sleep 2
curl http://localhost:9100/api/v1/extensions/my-ext/route/hello
eks logs --tail
# edit src/index.ts...
# (auto-reload)
curl http://localhost:9100/api/v1/extensions/my-ext/route/hello
```

### 23.3 Patch release

```bash
# bump version in eks.manifest.json5 + package.json
eks validate --strict
eks test
eks package --git --reproducible
eks publish --notes "Fix: race condition in storage tx"
eks rollout my-ext@1.0.1 --percentage 10
# ...monitor health for 30 minutes...
eks rollout my-ext@1.0.1 --percentage 100
```

### 23.4 Incident response — rollback

```bash
# Discover a problem with 1.1.0:
eks logs --extension my-ext --level error --since 30m

# Roll back all installations in the tenant:
eks rollback --extension my-ext --to-version 1.0.0 --tenant org_abc --reason "1.1.0_data_loss_bug"

# Yank the bad version (prevents new installs):
eks yank my-ext@1.1.0 --reason "data_loss_bug"

# Verify:
eks audit --extension my-ext --action EXTENSION_ROLLED_BACK --since 1h
```

### 23.5 Compromised signing key

```bash
# Discover key compromise:
eks keys revoke --publisher pub_acme --key-id key-2025-01
# (auto-rolls-back all installations signed with key-2025-01)

# Generate a new keypair:
eks keys generate --publisher pub_acme --key-id key-2026-02

# Submit rotation:
eks keys rotate --publisher pub_acme \
                --new-key-id key-2026-02 \
                --new-public-key-file ~/.eks/keys/pub_acme_key-2026-02.pub \
                --signing-key ~/.eks/keys/pub_acme_key-2025-01.pem

# Re-publish a clean version:
eks package --git --reproducible
eks publish --notes "Security: re-published after key compromise" --confirm-breaking
```

---

## 24. Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Generic error (see stderr) |
| `2` | Manifest validation error |
| `3` | Bundler error |
| `4` | Test failure |
| `5` | Package integrity error |
| `6` | Signature verification error |
| `7` | Publish pipeline rejection (compatibility, semver, scan, etc.) |
| `8` | Permission denied (M2 authorization) |
| `9` | Network error (registry unreachable) |
| `10` | Timeout |

CI scripts should check for non-zero exit codes; the specific code is informative for debugging.

---

## 25. Cross-references

| Topic | Document |
|---|---|
| Project structure & manifest | `EXTENSION_AUTHORING.md` |
| The `ExtensionContext` API | `SDK_GUIDE.md` |
| Packaging pipeline | `PACKAGING_GUIDE.md` |
| Publishing pipeline | `PUBLISHING_GUIDE.md` |
| Permission codes | `PERMISSION_MODEL.md` |
| Security model (signing, secrets, audit) | `SECURITY_MODEL.md` |
| Runtime architecture | `RUNTIME_ARCHITECTURE.md` |
| 30/60/90 onboarding | `DEVELOPER_ONBOARDING.md` |
