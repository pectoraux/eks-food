# Eks-Food Developer Platform — Security Model

> **Audience:** Security reviewers, platform engineers, on-call security maintainers, and publishers responsible for managing signing keys. Read alongside `PERMISSION_MODEL.md` (capability registry), `PACKAGING_GUIDE.md` (signing mechanics), `PUBLISHING_GUIDE.md` (publisher verification), `RUNTIME_ARCHITECTURE.md` (sandbox enforcement), and `docs/SECURITY.md` (the platform-wide security baseline from M1).
>
> **Status:** Milestone 3. This document specifies the security model of the Developer Platform: how extensions are signed, how permissions are reviewed and enforced, how the sandbox isolates third-party code, how runtime isolation prevents cross-extension faults, how every lifecycle event is audited, how publisher identity is verified, how secrets are protected, and how the supply chain is defended.

---

## 1. Threat model

The Developer Platform runs **third-party code** inside the same process tree as customer payment data and tenant-scoped business data. The threat model assumes:

1. **A malicious publisher.** An attacker has been onboarded as a `Publisher` (M3 is private, so this requires compromising the onboarding process — but we still assume it for defence-in-depth). They sign a real package with a real signing key, and the package contains malicious code that tries to exfiltrate data, tamper with another extension, or crash the platform.
2. **A compromised dependency.** A legitimate publisher's dependency tree includes a package whose npm registry account was hijacked (the typical `event-stream`-style attack). The malicious update is bundled into a legitimate extension's `.ekx`.
3. **A buggy extension.** A well-meaning publisher writes an extension that accidentally logs PII, holds long-running transactions, or makes excessive outbound calls.
4. **A malicious tenant admin.** A tenant admin tries to install an extension that the tenant has not been granted access to, or to use an extension to read another tenant's data.
5. **A compromised signing key.** An attacker obtains a publisher's Ed25519 private key (e.g. via a stolen laptop) and tries to publish a malicious version.

The security model in §2–§7 addresses each of these threats with multiple, independent controls. The principle is **defence in depth**: no single control is trusted to stop an attack on its own.

---

## 2. Extension signing

Every published `Package` is signed with an Ed25519 keypair held by the publisher. The signing key is the **root of trust** for an extension — anyone who holds the private key can publish new versions of the extension (and deprecate old ones).

### 2.1 Keypair generation

```bash
eks keys generate --publisher pub_acme --key-id key-2025-01
# → writes .eks/signing-key.pem (private, Ed25519 PKCS#8)
# → prints the public key fingerprint: sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

The private key is a 32-byte Ed25519 seed, wrapped in PKCS#8, encrypted with a passphrase (argon2id KDF, 64 MiB memory cost). The CLI refuses to write an unencrypted private key.

The public key is the corresponding 32-byte Ed25519 verification key. Its SHA-256 fingerprint is recorded in `Publisher.signingPublicKey` at onboarding (§3).

### 2.2 What is signed

The signature is computed over the **canonicalised `integrity.json`** document (see `PACKAGING_GUIDE.md` §5). The `integrity.json` lists every file in the `.ekx` and its SHA-256 — so signing the `integrity.json` transitively signs every file. The signature is **detached** (stored in `signature.bin` inside the `.ekx`, not embedded in `integrity.json`).

```
Canonicalised integrity.json
   │
   ▼
Ed25519 sign(privateKey, bytes)
   │
   ▼
signature (64 bytes) → stored as Package.signature (base64)
```

### 2.3 What is verified

At install time (`eks install` or `POST /api/v1/extensions/:id/install`) and at every cold-start (defence-in-depth), the platform verifies:

1. The Ed25519 signature over the canonicalised `integrity.json` using the publisher's public key.
2. The SHA-256 of every file inside the `.ekx` against the entries in `integrity.json`.
3. The SHA-256 of the entire `.ekx` against `Package.sha256`.

A failure at any step aborts the install / cold-start with the corresponding error (`SignatureVerificationError`, `FileIntegrityError`, `PackageIntegrityError`).

### 2.4 Key rotation

A publisher may rotate their signing key without invalidating already-published packages. The rotation flow:

1. The publisher generates a new keypair locally (`eks keys generate --publisher pub_acme --key-id key-2026-01`).
2. The publisher submits the new public key to the platform:

   ```bash
   eks keys rotate --publisher pub_acme \
                   --new-key-id key-2026-01 \
                   --new-public-key-file .eks/signing-key-2026.pub \
                   --signing-key .eks/signing-key.pem
   ```

   The CLI signs the rotation request `(publisherId, newKeyId, newPublicKey)` with the **old** private key, so the platform can verify the rotation is authorised.
3. The platform:
   - Adds `key-2026-01` to `Publisher.activeKeyIds`.
   - Sets `Publisher.signingPublicKey` to the new key.
   - Sets `Publisher.keyRotatedAt = now()`.
   - The old `key-2025-01` remains in `activeKeyIds` for **30 days**, so packages signed before the rotation can still be verified.
4. After 30 days, the platform removes `key-2025-01` from `activeKeyIds`. Packages signed with the old key can no longer be **newly installed**; existing installations continue to run (their `Package.signature` was verified at install time, and the runtime's cold-start verification trusts the `Package` row).
5. If the publisher discovers the old key was compromised, they can call `eks keys revoke --publisher pub_acme --key-id key-2025-01` to revoke it immediately. The platform removes it from `activeKeyIds`, sets a `revokedAt` timestamp, and **auto-rolls-back** every installation whose active `Package` was signed with the revoked key.

### 2.5 Why Ed25519

Ed25519 is used (instead of RSA or ECDSA) because:

- **Deterministic.** The same input + private key always produces the same signature. This is essential for reproducible builds (see `PACKAGING_GUIDE.md` §7).
- **Fast.** Signing and verification are sub-millisecond for a typical 20 KB integrity manifest.
- **Small.** 64-byte signatures, 32-byte public keys, 32-byte private keys. Keeps the `Package` row compact.
- **Widely vetted.** Used by SSH, Signal, age, minisign, and the OpenBSD project.
- **No padding oracle.** RSA PKCS#1 v1.5 has a long history of padding-oracle vulnerabilities; Ed25519 does not.

The `@noble/ed25519` library is used (pure JS, no native modules, audited). It runs in any V8 isolate, including the sandboxed worker thread.

---

## 3. Permission review during installation

Permissions are **capability-based**, not role-based. An extension declares the capabilities it needs in its manifest; the tenant admin reviews and approves them at install time; the runtime enforces them at every capability call. The principle is **least privilege**: an extension should be granted only the capabilities it actually needs, and the platform rejects calls outside that grant.

### 3.1 The review flow

```
1. Tenant admin clicks "Install" in the Developer Console.
   ↓
2. The platform renders the install-review page, showing:
   - Extension name, publisher, version, compatibility range.
   - The manifest's permissions (grouped by category: storage, events, APIs, etc.).
   - The manifest's requiredAPIs (with descriptions of each API action).
   - The manifest's requiredEvents (the event types the extension will receive).
   - The manifest's requiredSecrets (the secret names the extension will read).
   - The manifest's allowedDomains (the external domains the extension may call).
   - The manifest's connectorDependencies (the connectors that must be installed).
   ↓
3. The admin clicks "Approve" or "Reject".
   ↓
4. On approve:
   a. The platform records the granted permissions in ExtensionPermission rows
      (one row per (installationId, permissionCode)).
   b. The platform verifies all requiredSecrets have values for this tenant
      (or prompts the admin to set them as part of the install flow).
   c. The platform verifies all connectorDependencies are installed and ACTIVE.
   d. The platform creates the ExtensionInstallation row (status = PENDING).
   e. The platform stages Extension.Installed.v1 to the EventOutbox.
   ↓
5. The runtime's subscriber on Extension.Installed.v1 eager-cold-starts the
   worker, runs setup(), and on success transitions to ACTIVE.
```

### 3.2 Capability enforcement at runtime

Every `ctx.*` call is intercepted by a permission-checking proxy (see `RUNTIME_ARCHITECTURE.md` §4). The proxy:

1. Looks up the capability the call exercises (e.g. `ctx.storage.set` → `access.storage`).
2. Reads `ExtensionPermission` rows for this `(installationId, permissionCode)`.
3. If the permission is granted, the call proceeds.
4. If the permission is not granted, the call throws `ForbiddenError` with `code = "permission_not_granted"` and `details = { permission, capability, method }`.

The check is **defensive against missing rows**: a capability without an `ExtensionPermission` row is treated as denied. This means an extension that adds a new permission in version 1.1.0 cannot use that capability in 1.1.0 unless the tenant re-approves (the install flow re-triggers on upgrade if the new version's permissions are not a subset of the old version's).

### 3.3 Permission review on upgrade

When a tenant upgrades an extension to a new version:

1. The platform diffs the new version's `manifest.permissions` against the old version's.
2. If the new version is a **subset** of the old version's permissions (or equal), the upgrade proceeds without re-approval.
3. If the new version requires **additional** permissions, the upgrade flow pauses and the tenant admin must approve the new permissions. The old version continues to run until the admin approves.
4. If the new version's `requiredAPIs` includes actions the tenant has not yet granted (e.g. the new version needs `booking.cancel` and the tenant has only granted `booking.read`), the install flow prompts the admin to grant the additional API scope.

A downgrade (rollback to a previous version) does not require re-approval — the previous version's permissions are already granted.

### 3.4 Audit logging of permission grants

Every permission grant (or revocation) is recorded in `AuditLog`:

```
{
  "action": "EXTENSION_PERMISSION_GRANTED",
  "actorUserId": "u_xyz",
  "organizationId": "org_abc",
  "installationId": "inst_def",
  "extensionId": "ext_loyalty-engine",
  "version": "1.0.0",
  "permission": "access.storage",
  "grantedAt": "2025-01-15T10:30:00Z"
}
```

These rows are queryable via `GET /api/v1/audit?action=EXTENSION_PERMISSION_GRANTED` and surfaced in the Developer Console's audit tab.

---

## 4. Sandbox enforcement

The sandbox is documented in `ARCHITECTURE.md` §4 and `RUNTIME_ARCHITECTURE.md` §9. This section focuses on the security guarantees.

### 4.1 No direct filesystem access

The sandbox's module loader forbids `node:fs` and `node:fs/promises`. The only filesystem operations available to an extension are:
- Reading the bundled assets declared in the manifest (via the runtime's `ctx.assets.read(path)` API — read-only, scoped to the package's `assets/` directory).
- Writing to `ctx.storage` (a key/value store backed by `ExtensionStorage`, scoped by `installationId` + `organizationId`).

An extension cannot read `/etc/passwd`, `/proc/self/environ`, the host's `.env` file, or any other file outside its package's `assets/` directory.

### 4.2 No direct network access

The sandbox does not expose `globalThis.fetch`, `globalThis.XMLHttpRequest`, or any TCP/UDP API. The only way to make an outbound call is via `ctx.apis.request`, `ctx.apis.fetch`, or `ctx.apis.invoke`. All three route through the platform's egress proxy, which:
- Enforces the manifest's `allowedDomains` allowlist.
- Records every call to `ExtensionLog` and `AuditLog`.
- Applies per-installation rate limits.

### 4.3 No direct database access

The sandbox forbids `@prisma/client`, `pg`, `mysql2`, `ioredis`, `redis`, and `mongodb` (see `PACKAGING_GUIDE.md` §6). The only data-access APIs available are:
- `ctx.storage` (per-installation key/value, backed by `ExtensionStorage`).
- `ctx.cache` (per-installation cache, backed by `@eks/cache`).
- `ctx.config` (per-installation config, backed by `ExtensionConfiguration`).
- `ctx.secrets` (per-installation secrets, backed by `Secret`).

All four are scoped by `(installationId, organizationId)` at the `WHERE` clause — a bug in the SDK cannot leak another installation's data because the WHERE clause is built server-side from the installation's identity.

### 4.4 No `eval`, no `Function`, no `vm`

The sandbox scans the bundled `index.mjs` for `eval(`, `new Function(`, `vm.runInContext(`, `vm.runInNewContext(`, and `vm.Script(`. Any match fails the lockfile validation at install time (Stage 1 of the verification pipeline). This prevents an extension from dynamically generating code that bypasses the static module-loader checks.

The scan is conservative: a string literal `"eval"` does not trigger a failure (it's a string, not a call). The runtime uses esbuild's AST to detect actual `CallExpression`s with the `eval` callee.

### 4.5 No `process.env`

The sandbox does not expose `globalThis.process`. An extension cannot read environment variables — the only way to receive configuration is via `ctx.config` (operator-managed) and `ctx.secrets` (operator-managed). This prevents an extension from reading sensitive host-level env vars (database URLs, signing keys, etc.).

### 4.6 No `setTimeout` beyond the invocation deadline

`setTimeout` and `setInterval` are exposed but bounded by the invocation deadline. A `setTimeout(fn, 60_000)` inside a 5-second invocation is silently truncated to the deadline; `fn` is called only if the invocation is still running at the deadline (which it never is, because the runtime terminates the worker at the deadline). This prevents extensions from running background work that outlives the invocation.

---

## 5. Runtime isolation

Runtime isolation (one extension cannot crash another) is documented in `RUNTIME_ARCHITECTURE.md` §10. The security-relevant guarantees:

1. **Process isolation.** A `SIGSEGV` in worker A terminates worker A only. Worker B (running a different extension) is unaffected. The host process is unaffected.
2. **Memory isolation.** Each worker has its own V8 heap (`worker_threads.resourceLimits.maxOldGenerationSizeMb`). A memory leak in extension A cannot exhaust extension B's heap.
3. **CPU isolation.** Each invocation is bounded by a CPU-time limit. A CPU-bound extension cannot starve other extensions' invocations (the host process's event loop continues to dispatch to other workers).
4. **Resource-quota isolation.** Per-invocation quotas (outbound calls, storage ops, event publishes) prevent a single extension from monopolising a shared resource.
5. **Tenant isolation.** Every `WHERE` clause on `ExtensionStorage`, `ExtensionLog`, `ExtensionConfiguration`, `Secret`, `ConnectorConfiguration`, `WorkflowExecution`, `EventReplay` includes both `installationId` and `organizationId`. A cross-tenant query is impossible by construction.

---

## 6. Audit logging of every lifecycle event

Every lifecycle event — install, activate, suspend, upgrade, rollback, remove, plus every capability call that touches a sensitive resource — is recorded in `AuditLog`. The audit log is the platform's tamper-evident record of what happened, when, by whom, and to what.

The set of action codes written to `AuditLog.action` is **not** free-form — every code is drawn from the `DEVELOPER_AUDIT_ACTIONS` registry exported by the `@eks/developer` package (`src/packages/developer/audit-actions.ts`). The registry is the single source of truth: SIEM integrations, compliance reports, and anomaly-detection jobs reference the constant rather than the literal string, so a typo is caught at compile time and a renaming is a single edit. The 25 canonical codes are: `EXTENSION_INSTALLED`, `EXTENSION_ACTIVATED`, `EXTENSION_SUSPENDED`, `EXTENSION_REMOVED`, `EXTENSION_UPGRADED`, `EXTENSION_ROLLED_BACK`, `EXTENSION_HEALTH_CHECK`, `EXTENSION_LOG_EMITTED`, `CONNECTOR_EXECUTED`, `CONNECTOR_FAILED`, `WORKFLOW_STARTED`, `WORKFLOW_COMPLETED`, `WORKFLOW_FAILED`, `EVENT_REPLAYED`, `MANIFEST_VALIDATED`, `MANIFEST_VALIDATION_FAILED`, `PACKAGE_PUBLISHED`, `PACKAGE_SIGNATURE_VERIFIED`, `SECRET_CREATED`, `SECRET_ROTATED`, `SECRET_ACCESSED`, `PERMISSION_GRANTED`, `PERMISSION_DENIED`, `PUBLISHER_VERIFIED`, `SANDBOX_VIOLATION`. Codes are append-only — retired codes are kept in the registry and marked `@deprecated` so historical audit rows remain queryable.

Negative-outcome codes (`CONNECTOR_FAILED`, `MANIFEST_VALIDATION_FAILED`, `PERMISSION_DENIED`, `SANDBOX_VIOLATION`) are emitted to the audit log even though they have **no** corresponding domain event — the audit log is the only record of "an action was attempted and refused", because the aggregate was never mutated. The M2 `@eks/observability/audit` writer accepts any of these codes; the M3 runtime, registry, workflow, and connector surfaces all import from `@eks/developer` so the literal-string surface area is zero.

### 6.1 Lifecycle audit actions

| Action code | Trigger | Recorded fields |
|---|---|---|
| `EXTENSION_INSTALLED` | install flow completes | `installationId`, `extensionId`, `version`, `organizationId`, `actorUserId`, `permissions` |
| `EXTENSION_ACTIVATED` | activation completes | `installationId`, `version` |
| `EXTENSION_SUSPENDED` | suspend (manual or auto) | `installationId`, `reason`, `actorUserId` (if manual) |
| `EXTENSION_UPGRADED` | upgrade completes | `installationId`, `fromVersion`, `toVersion`, `actorUserId` |
| `EXTENSION_ROLLED_BACK` | rollback completes | `installationId`, `fromVersion`, `toVersion`, `reason`, `actorUserId` |
| `EXTENSION_REMOVED` | remove completes | `installationId`, `actorUserId` |
| `EXTENSION_PERMISSION_GRANTED` | install / upgrade grants | `installationId`, `permission`, `actorUserId` |
| `EXTENSION_PERMISSION_REVOKED` | admin revokes a permission | `installationId`, `permission`, `actorUserId` |
| `EXTENSION_SECRET_SET` | operator sets a secret | `installationId`, `secretName`, `actorUserId` (the value is never recorded) |
| `EXTENSION_SECRET_ROTATED` | operator rotates a secret | `installationId`, `secretName`, `actorUserId` |
| `EXTENSION_INVOKE_FAILED` | invocation throws | `installationId`, `invocationId`, `error`, `correlationId` |
| `EXTENSION_AUTH_DELEGATED` | `ctx.auth.asUser` call | `installationId`, `targetUserId`, `scopes`, `ttlSeconds` |
| `EXTENSION_EGRESS` | outbound call | `installationId`, `method`, `url`, `status`, `durationMs` |
| `EXTENSION_PACKAGE_VERIFIED` | install-time verification | `extensionId`, `version`, `sha256`, `signatureKeyId`, `integrityChecksPassed` |
| `EXTENSION_PUBLISHED` | publish pipeline completes | `extensionId`, `version`, `publisherId`, `actorUserId` |
| `EXTENSION_PUBLISH_BLOCKED` | publish pipeline rejects | `extensionId`, `version`, `stage`, `reason` |
| `EXTENSION_VERSION_DEPRECATED` | publisher yanks a version | `extensionId`, `version`, `reason`, `actorUserId` |
| `EXTENSION_VERSION_BLOCKED` | platform team blocks a version | `extensionId`, `version`, `reason`, `caseId` |

### 6.2 Tamper-evidence

`AuditLog` rows are append-only — no `UPDATE` or `DELETE` is permitted at the database level (a Postgres trigger rejects the operation). The M1 `@eks/observability/audit` module (see `docs/SECURITY.md`) records the hash of the previous row in each new row, forming a hash chain. A tampered row breaks the chain and is detectable by an external verifier.

### 6.3 Retention

Audit log rows are retained for **7 years** (the platform's compliance baseline). The `audit.gc` worker (registered on the M1 `@eks/workers` scheduler) moves rows older than 7 years to cold storage (S3 Glacier) and deletes them from the hot Postgres table.

### 6.4 Querying

```bash
# CLI:
eks audit --extension loyalty-engine --since 7d
eks audit --action EXTENSION_PERMISSION_GRANTED --organization org_abc

# API:
GET /api/v1/audit?installationId=inst_abc&since=2025-01-01T00:00:00Z
```

The query API enforces M2 authorization: only the tenant's `ADMIN` and `SUPPORT` roles can read audit rows for their own tenant; the platform team can read across tenants.

---

## 7. Publisher verification

Publisher verification is documented in `PUBLISHING_GUIDE.md` §2. The security-relevant guarantees:

1. **No self-registration.** A `Publisher` row is created by the Eks-Food platform team after out-of-band identity verification. Tenants cannot self-register as publishers in M3.
2. **Signing key pinned at onboarding.** The publisher's Ed25519 public key is recorded in `Publisher.signingPublicKey` at onboarding, signed by the platform team's own key (so the platform can prove the key was accepted by Eks-Food, not inserted by an attacker).
3. **Key rotation is signed by the old key.** A key rotation request that is not signed by the old key is rejected. This prevents an attacker who compromises the platform team's database from swapping a publisher's key without the publisher's consent.
4. **Suspended publishers cannot publish.** A `Publisher.status = "SUSPENDED"` row blocks `eks publish` immediately. Existing published versions remain installable but no new versions can be added.
5. **Revoked publishers' packages are auto-rolled-back.** A `Publisher.status = "REVOKED"` row triggers an auto-rollback of every installation whose active `Package` was published by that publisher. The platform team uses this for the "kill switch" scenario.

### 7.1 Publisher verification hooks (interface)

The platform defines a `PublisherVerifier` interface in `@eks/registry/publisher-verifier.ts`:

```typescript
export interface PublisherVerifier {
  /** Verify a new publisher's identity during onboarding. */
  verifyOnboarding(request: PublisherOnboardingRequest): Promise<VerificationResult>;

  /** Periodically re-verify an existing publisher (e.g. annual KYC refresh). */
  reverify(publisher: Publisher): Promise<VerificationResult>;

  /** Verify a key-rotation request is authorised. */
  verifyKeyRotation(publisher: Publisher, newPublicKey: string, signedRotationRequest: Buffer): Promise<VerificationResult>;
}

export interface VerificationResult {
  status: "verified" | "rejected" | "manual_review";
  confidence: number;
  findings: Array<{ severity: "info" | "low" | "medium" | "high" | "critical"; message: string }>;
  metadata: Record<string, unknown>;
}
```

M3 ships a `ManualVerifier` that always returns `status: "manual_review"` and surfaces the request in the platform team's Console. M4+ will plug in automated KYC providers (e.g. Persona, Stripe Identity) via this interface.

---

## 8. Secure secrets

Secrets are the most sensitive data an extension can read. The platform treats them with the highest level of care.

### 8.1 Storage at rest

Secrets are stored in the `Secret` Prisma model:

```prisma
model Secret {
  id              String   @id @default(cuid())
  organizationId  String
  installationId  String
  name            String                  // e.g. "STRIPE_SECRET_KEY"
  // ─── Encryption ────────────────────────────────────────────────
  ciphertext      String                  // base64 AES-256-GCM ciphertext
  iv              String                  // base64 12-byte IV (one per encryption)
  authTag         String                  // base64 16-byte GCM auth tag
  keyVersion      Int                     // which master-key version encrypted this
  // ─── Audit ────────────────────────────────────────────────────
  lastReadAt      DateTime?
  lastReadByInvocationId String?
  readCountTotal  Int      @default(0)
  // ─── Lifecycle ────────────────────────────────────────────────
  rotatedAt       DateTime?
  rotatedBy       String?
  // ─── Relations + timestamps ────────────────────────────────────
  installation    ExtensionInstallation @relation(fields: [installationId], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([installationId, name])
  @@index([organizationId])
}
```

The encryption scheme is **AES-256-GCM** with a per-row IV (12 bytes, random) and a 16-byte GCM auth tag. The master key is held in the platform's KMS (AWS KMS in production; a local keystore in dev). The `keyVersion` field tracks which master-key version was used, so keys can be rotated without re-encrypting every row at once — old rows are decrypted with the old key version, re-encrypted with the new key version, and the `keyVersion` is bumped (a background job).

### 8.2 Scoped access

An extension can read a secret only if:
1. The secret's `name` is in the manifest's `requiredSecrets` array.
2. The `ExtensionPermission` row for `access.secrets` exists for this installation.
3. The secret's `(organizationId, installationId, name)` matches the calling installation's identity.

A violation of any of these throws `ForbiddenError`. The check is enforced at the SDK proxy layer (the manifest's `requiredSecrets` list is the allowlist).

### 8.3 Never exposed raw

The decrypted secret value is held in memory only for the duration of the `ctx.secrets.get(name)` call. The platform:
- Never logs the secret value (the logger scans for the value and redacts it before writing to `ExtensionLog`).
- Never returns the secret value in error messages (a `SecretNotFoundError` says only that the secret was not found).
- Never caches the secret value in `ctx.cache` (the cache proxy rejects values that match a known secret's pattern).
- Never includes the secret value in metrics or traces (the tracer redacts attributes whose values match a known secret).

### 8.4 Audit logging of secret access

Every `ctx.secrets.get(name)` call writes an `AuditLog` row:

```
{
  "action": "EXTENSION_SECRET_READ",
  "installationId": "inst_abc",
  "secretName": "STRIPE_SECRET_KEY",
  "invocationId": "inv_xyz",
  "actorUserId": "u_def",
  "at": "2025-01-15T10:30:00Z"
}
```

The `Secret.lastReadAt`, `Secret.lastReadByInvocationId`, and `Secret.readCountTotal` fields are updated atomically with the audit row. An operator can detect anomalous access patterns (e.g. a spike in reads) by querying these fields.

### 8.5 Rotation

Operators rotate secrets via:

```bash
eks secrets rotate --installation inst_abc --name STRIPE_SECRET_KEY
# → prompts for the new value, encrypts, writes Secret.rotatedAt + Secret.rotatedBy
```

After rotation, the next `ctx.secrets.get(name)` call returns the new value. Existing in-flight invocations continue to use the cached value (held in the worker's memory for the duration of the invocation); new invocations get the new value. The runtime does not proactively push the new value to warm workers — extensions should not hold secrets across invocations (re-read on each invocation).

### 8.6 Deletion

When an `ExtensionInstallation` is removed (§3.6 in `RUNTIME_ARCHITECTURE.md`), the platform deletes the installation's `Secret` rows immediately. The deletion is logged as `EXTENSION_SECRET_DELETED` in `AuditLog` (the secret value is not recorded; only the name and the deletion timestamp).

---

## 9. Dependency validation

Dependency validation is documented in `PACKAGING_GUIDE.md` §6. The security-relevant guarantees:

1. **Lockfile required.** Every external dependency must have an `integrity` field (a SHA-512 from the npm registry) recorded in `eks-lock.json`. Bundling a dependency without a lockfile entry aborts packaging.
2. **Forbidden packages list.** A deny-list of forbidden packages is enforced at packaging time. The list includes `child_process`, `node:fs`, `node:net`, `node:child_process`, `eval`, `vm2`, `puppeteer`, `playwright`, `node-fetch`, `axios`, `got`, `request`, `superagent`, `isolated-vm`, `prebuild-install`, `node-pre-gyp`, any `@prisma/*`, `ioredis`, `redis`, `mongodb`. The list is versioned with the platform and updated via the standard platform release process.
3. **No native modules.** Packages that ship `.node` files are rejected at packaging time (esbuild's bundler detects them).
4. **No `eval` / `Function` / `vm` calls.** The bundled `index.mjs` is AST-scanned for these tokens; a match fails the lockfile validation at install time.
5. **Reproducible builds.** The same source tree produces byte-identical `.ekx` output on any machine, so a security reviewer can rebuild a published package and compare bytes to confirm the registry-hosted artifact matches the publisher's source.

### 9.1 The forbidden-packages list

```typescript
// src/packages/registry/forbidden-packages.ts
export const FORBIDDEN_PACKAGES: readonly ForbiddenPackage[] = [
  { name: "child_process", reason: "Native module; sandbox does not expose Node built-ins." },
  { name: "node:fs",       reason: "Filesystem access; use ctx.storage instead." },
  { name: "node:net",      reason: "Network access; use ctx.apis.request instead." },
  { name: "node:child_process", reason: "Process spawning; forbidden in sandbox." },
  { name: "vm2",           reason: "Nested VM; runtime provides isolation." },
  { name: "isolated-vm",   reason: "Nested VM; runtime provides isolation." },
  { name: "puppeteer",     reason: "Browser automation; use the platform's headless-browser service." },
  { name: "puppeteer-core", reason: "Browser automation; use the platform's headless-browser service." },
  { name: "playwright",    reason: "Browser automation; use the platform's headless-browser service." },
  { name: "node-fetch",    reason: "Direct HTTP; use ctx.apis.request instead." },
  { name: "axios",         reason: "Direct HTTP; use ctx.apis.request instead." },
  { name: "got",           reason: "Direct HTTP; use ctx.apis.request instead." },
  { name: "request",       reason: "Direct HTTP; use ctx.apis.request instead." },
  { name: "superagent",    reason: "Direct HTTP; use ctx.apis.request instead." },
  { name: "prebuild-install", reason: "Native module loader; native modules forbidden." },
  { name: "node-pre-gyp",  reason: "Native module loader; native modules forbidden." },
  // Pattern matches:
  { pattern: "^@prisma/",  reason: "Direct DB access; use ctx.storage instead." },
  { pattern: "^ioredis$",  reason: "Direct cache access; use ctx.cache instead." },
  { pattern: "^redis$",    reason: "Direct cache access; use ctx.cache instead." },
  { pattern: "^mongodb",   reason: "Direct DB access; use ctx.storage instead." },
  { pattern: "^pg$",       reason: "Direct DB access; use ctx.storage instead." },
  { pattern: "^mysql",     reason: "Direct DB access; use ctx.storage instead." },
] as const;
```

The list is intentionally conservative. A publisher who needs a package on the list (e.g. a legitimate use of `axios` for a non-HTTP purpose — rare) must file a capability request with the platform team. The request is reviewed, and if approved, the package is added to a per-publisher allowlist (recorded in `Publisher.allowlistPackages`).

### 9.2 The malware-scan hook

The `MalwareScanner` interface (see `PUBLISHING_GUIDE.md` §3.3) is the platform's hook for plugging in additional supply-chain defences. M3 ships a `NoOpScanner`; M4+ will plug in real scanners (ClamAV, YARA, LLM-based heuristics). The hook is called at publish time and re-called at install time (so a package that was clean at publish time can be re-scanned against updated signatures at install time).

---

## 10. Incident response

The platform supports two incident-response scenarios:

### 10.1 Compromised signing key

If a publisher discovers their signing key was compromised:

1. The publisher calls `eks keys revoke --publisher pub_acme --key-id key-2025-01`.
2. The platform removes `key-2025-01` from `activeKeyIds`, sets `revokedAt`.
3. The platform **auto-rolls-back** every installation whose active `Package` was signed with the revoked key. The rollback target is the most recent PUBLISHED version signed with a non-revoked key.
4. The platform emails the affected tenants' admins.
5. The publisher issues a new keypair (§2.4) and publishes a fresh version with a security advisory.

### 10.2 Malicious package in the registry

If the platform team discovers a published package is malicious (e.g. via a customer report or a malware-scanner hit on an already-published package):

1. The platform team calls `POST /api/v1/extensions/:id/versions/:v/block` with `reason = "security_incident_<case_id>"`.
2. The platform sets `ExtensionVersion.status = "BLOCKED"`, `blockedReason`.
3. The platform **auto-rolls-back** every installation whose active version is the blocked version. The rollback target is the most recent non-blocked version.
4. The platform suspends the publisher (`Publisher.status = "SUSPENDED"`) pending investigation.
5. The platform emails the affected tenants' admins and the publisher's security contact.
6. The platform publishes a security advisory in `docs/security-advisories/`.

---

## 11. Cross-references

| Topic | Document |
|---|---|
| Capability permissions registry | `PERMISSION_MODEL.md` |
| Signing mechanics (canonicalisation, tar+zstd) | `PACKAGING_GUIDE.md` |
| Publisher onboarding + verification flow | `PUBLISHING_GUIDE.md` §2 |
| Sandbox enforcement (module loader, resource limits) | `RUNTIME_ARCHITECTURE.md` §9 |
| M1 platform-wide security baseline | `docs/SECURITY.md` |
| M1 `@eks/security` (crypto, cookies, sanitization, RBAC) | `docs/SECURITY.md` |
| M2 authorization (Principal, `authorize()`) | `docs/identity/AUTHORIZATION_POLICIES.md` |
| M2 audit (AppendOnlyAuditLog, hash chain) | `docs/identity/AUDIT_AND_COMPLIANCE.md` |
| M1 observability (Logger, AuditLog, Metrics) | `docs/ARCHITECTURE.md` |
