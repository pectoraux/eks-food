# Eks-Food Publishing Guide

> **Audience:** Extension publishers and platform operators. Read alongside `PACKAGING_GUIDE.md` (how a `.ekx` is built and signed), `SECURITY_MODEL.md` (publisher verification, signing keys, malware-scan hooks), `PERMISSION_MODEL.md` (capability review during install), and `CLI_GUIDE.md` (the `eks publish` command).
>
> **Status:** Milestone 3. The publishing pipeline takes a packaged `.ekx` and turns it into an installable `ExtensionVersion` row in the private registry. **There is no public marketplace in M3** — only verified publishers (Eks-Food partners and approved tenants) can publish, and only their explicitly-granted tenants can install. The public marketplace, search, ratings, and revenue split are M5.

---

## 1. The publishing pipeline at a glance

```
┌────────────────────────────────────────────────────────────────────┐
│  eks package                                                       │
│  (produces dist/<slug>-<version>.ekx, signed, integrity-stamped)   │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  eks publish                                                       │
│  (POST /api/v1/registry/versions with the .ekx as multipart)       │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Stage 1 — Authentication                                          │
│  • Verify the caller is the publisher's owner (M2 authorize)       │
│  • Verify the publisher is in ACTIVE status                        │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Stage 2 — Package verification (see PACKAGING_GUIDE.md §5)        │
│  • SHA-256 of the entire .ekx                                      │
│  • Ed25519 signature over integrity.json                           │
│  • Per-file SHA-256 against the integrity manifest                 │
│  • Lockfile: no forbidden packages, all @eks/* versions OK         │
│  • Manifest schema re-validation                                   │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Stage 3 — Compatibility check                                     │
│  • compatibilityRanges.eks-platform vs current platform version    │
│  • compatibilityRanges.@eks/sdk vs current SDK version             │
│  • Previous version's compatibilityRanges (cannot break installs)  │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Stage 4 — Malware scan hook (interface only in M3)                │
│  • Pluggable interface: MalwareScanner.scan(.ekx) → ScanResult     │
│  • Default implementation: NoOpScanner (passes everything)         │
│  • Production deployments plug in a real scanner via config        │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Stage 5 — Publisher verification                                  │
│  • Package.publisherId must match an existing Publisher row        │
│  • Package.signingPublicKey must match Publisher.signingPublicKey  │
│  • Package.signingKeyId must be in Publisher.activeKeyIds          │
│  • Publisher.status must be ACTIVE (not SUSPENDED, not REVOKED)    │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Stage 6 — Semantic-versioning check                               │
│  • version must be a valid semver                                 │
│  • version must be strictly greater than the previous PUBLISHED    │
│    version of the same extension                                   │
│  • cannot reuse a DEPRECATED version number                        │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Stage 7 — Create ExtensionVersion + Package rows                  │
│  • status = VALIDATED                                              │
│  • storageKey = content-addressed path                             │
│  • sha256, signature, signingKeyId persisted                       │
│  • Extension.VersionPublished.v1 event staged to EventOutbox       │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Stage 8 — Staged rollout                                          │
│  • version.rolloutPercentage = 0 (initial)                         │
│  • A platform operator bumps the percentage via the Console or     │
│    PUT /api/v1/extensions/:id/versions/:v/rollout                  │
│  • Existing installations upgrade when their tenant's hash falls   │
│    in the rollout bucket (feature-flag-style)                      │
└────────────────────────────────────────────────────────────────────┘
```

Each stage is idempotent and individually auditable. A failure at any stage records a `PublishAttempt` row with the stage that failed, the reason, and the raw `.ekx` SHA-256 (so the publisher can correlate a failed attempt with a local package).

> **Event & audit vocabulary.** Every stage that mutates a `Package` or `ExtensionVersion` row stages a domain event to the M1 `EventOutbox` using `buildDeveloperEvent(name, aggregateId, payload, meta?)` from the `@eks/developer` package. The events used by the publish pipeline are: `ManifestValidated` / `ManifestValidationFailed` (stage 5), `PackageSignatureVerified` (stage 6), `PackagePublished` (stage 7), `ExtensionUpgraded` (stage 8 per-tenant upgrade), `ExtensionRolledBack` (auto-rollback on health-gate failure). The matching audit codes from `DEVELOPER_AUDIT_ACTIONS` are written to `AuditLog.action` in the same transaction: `MANIFEST_VALIDATED` / `MANIFEST_VALIDATION_FAILED`, `PACKAGE_SIGNATURE_VERIFIED`, `PACKAGE_PUBLISHED`, `EXTENSION_UPGRADED`, `EXTENSION_ROLLED_BACK`, `PUBLISHER_VERIFIED` (stage 5 publisher re-check). The pipeline never writes a literal string — every emit references the registry constant, so a typo is a compile error.

---

## 2. The `Publisher` model and verification

Every extension is owned by exactly one `Publisher`. A publisher is created by the Eks-Food platform team during partner onboarding; tenants cannot self-register as publishers in M3 (this gate is what keeps the M3 registry "private").

```prisma
model Publisher {
  id                String   @id @default(cuid())  // e.g. "pub_acme"
  kind              String                          // "platform" | "partner" | "tenant"
  name              String
  email             String   @unique
  // ─── Verification ──────────────────────────────────────────────
  status            String   @default("PENDING")   // PENDING | ACTIVE | SUSPENDED | REVOKED
  verifiedAt        DateTime?
  verifiedBy        String?                          // user id of the platform admin
  verificationNotes String?
  // ─── Signing ───────────────────────────────────────────────────
  signingPublicKey  String                          // base64 Ed25519 public key
  activeKeyIds      String[]                        // ["key-2025-01"]
  keyRotatedAt      DateTime?
  // ─── Tenancy ───────────────────────────────────────────────────
  homeOrganizationId String?                        // for kind=tenant publishers
  allowedInstallOrganizations String[]              // explicit grant list; empty = any
  // ─── Contact ───────────────────────────────────────────────────
  contactName       String
  contactEmail      String
  securityContactEmail String
  // ─── Relations ─────────────────────────────────────────────────
  extensions        Extension[]
  packages          Package[]
  // ─── Timestamps ────────────────────────────────────────────────
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([status])
  @@index([kind])
}
```

### 2.1 Publisher kinds

| Kind | Description | Can publish | Can be installed by |
|---|---|---|---|
| `platform` | Eks-Food's own publisher (id `pub_eks`) | Curated platform extensions | All tenants automatically |
| `partner` | A verified third party (e.g. Acme, Stripe) | Partner extensions | Any tenant whose admin has approved the partner |
| `tenant` | A tenant acting as its own publisher (internal extensions) | Tenant-private extensions | Only the tenant itself |

### 2.2 The verification flow

A new `Publisher` row is created in `PENDING` status. The platform team:
1. Confirms the legal entity behind the publisher (e.g. via business registration documents).
2. Confirms the security contact email is monitored.
3. Receives the publisher's Ed25519 public key out-of-band (typically via a signed email or an in-person key exchange).
4. Sets `verifiedAt`, `verifiedBy`, `status = "ACTIVE"`, and persists `signingPublicKey`.

Until `status = "ACTIVE"`, `eks publish` returns `403 PublisherNotVerified`. Suspended or revoked publishers (set by the platform team via the Console) cannot publish new versions or rotate keys; existing published versions remain installable but no new installations are permitted.

### 2.3 Key rotation

A publisher may rotate their signing key by:
1. Generating a new keypair locally (`eks keys generate`).
2. Submitting the new public key to the platform (`POST /api/v1/publishers/:id/keys`).
3. Signing the submission with the **old** private key (so the platform knows the rotation is authorised).
4. The platform adds the new `keyId` to `activeKeyIds` and rotates `signingPublicKey` to the new key.
5. The old key remains valid for **30 days** for verifying packages signed before the rotation; after 30 days the old `keyId` is removed from `activeKeyIds`.

This dual-key window lets publishers rotate keys without invalidating packages already in the registry.

---

## 3. Validation stages in detail

### 3.1 Manifest schema validation

The manifest is re-validated by `@eks/registry` after the `.ekx` is unpacked. The schema is the same one enforced by `eks validate` locally (see `EXTENSION_AUTHORING.md` §3); the registry runs it again because the local CLI is a trusted client and the registry is the trust boundary.

Additional registry-side checks:
- `slug` matches the `Extension.slug` already registered for this publisher (if it's a new extension, the slug is reserved atomically).
- `version` is strictly greater than the latest PUBLISHED `ExtensionVersion.version` for this extension.
- `permissions` are a subset of the platform's known permission codes (see `PERMISSION_MODEL.md`). Unknown permissions → `UnknownPermissionError`.
- `requiredAPIs` are a subset of the platform's known API actions. Unknown APIs → `UnknownApiError`.
- `requiredEvents` are a subset of the platform's published event types. Unknown events → warning (not failure — events may be added in newer platform versions).
- `configurationSchema` is a valid JSON Schema and the platform can materialise defaults.

### 3.2 Compatibility checks

`compatibilityRanges.eks-platform` is checked against the platform's current version (e.g. `3.1.2`):

```
manifest: "compatibilityRanges": { "eks-platform": "^3.0.0" }
platform: "3.1.2"
result:   ✓ 3.1.2 satisfies ^3.0.0
```

A manifest declaring `"^3.0.0"` cannot be installed on platform `2.x` or `4.0.0-beta`. This is the contract that lets the platform evolve without breaking extensions: a MAJOR bump of the platform bumps the SDK's MAJOR, and extensions must update their `compatibilityRanges` to opt in.

A manifest declaring `"^3.0.0"` **can** be installed on any platform `3.x.y` — minor and patch releases are backwards-compatible by contract. The platform's `CHANGELOG` (in `docs/`) records every breaking change under a "SDK breaking changes" section.

The check also enforces:
- A new version's `compatibilityRanges.eks-platform` must be **broader or equal** to the previous version's range. A publisher cannot narrow the compatibility range in a patch release (that would silently de-install tenants running the older platform version).
- The `@eks/sdk` and `@eks/connector-sdk` ranges must be satisfiable by the runtime's currently bundled SDK versions.

### 3.3 Malware scanning (interface only in M3)

The platform defines a `MalwareScanner` interface in `@eks/registry/malware-scanner.ts`:

```typescript
export interface MalwareScanner {
  /** Unique name for the implementation. */
  readonly name: string;

  /** Scan a verified, unpacked package directory. */
  scan(
    packageRoot: string,
    manifest: ExtensionManifest,
    lockfile: Lockfile,
  ): Promise<ScanResult>;
}

export interface ScanResult {
  /** "clean" | "suspicious" | "malicious" */
  status: "clean" | "suspicious" | "malicious";
  /** Confidence score 0..1 (1 = highest confidence). */
  confidence: number;
  /** Human-readable findings. */
  findings: Array<{
    severity: "info" | "low" | "medium" | "high" | "critical";
    rule: string;
    message: string;
    file?: string;
    line?: number;
  }>;
  /** Scanner-specific metadata (e.g. signature database version). */
  metadata: Record<string, unknown>;
}
```

**M3 ships a `NoOpScanner` that always returns `status: "clean"`.** This is the interface contract that M4+ will implement with a real scanner (ClamAV, a YARA-rules engine, an LLM-based heuristic scanner, or a combination). The scanner is pluggable via `EKS_MALWARE_SCANNER` env var:

```
EKS_MALWARE_SCANNER=clamav   # uses the bundled ClamAV scanner
EKS_MALWARE_SCANNER=noop     # default; passes everything
EKS_MALWARE_SCANNER=custom   # uses the implementation in src/packages/registry/malware-scanners/custom.ts
```

Scan rules:
- `status: "clean"` → publish proceeds.
- `status: "suspicious"` → publish proceeds but the `ExtensionVersion` is flagged `reviewRequired = true`; it cannot be activated by tenants until a platform operator reviews and clears it.
- `status: "malicious"` → publish is rejected with `MalwareDetectedError`. The publisher is notified; the `.ekx` is quarantined for 30 days for forensic analysis.

The scanner output is recorded on the `ExtensionVersion` row (`scanStatus`, `scanConfidence`, `scanFindings`, `scannedAt`, `scannerName`).

### 3.4 Digital signatures

Already covered in `PACKAGING_GUIDE.md` §6. The registry's verification step (Stage 5 of the pipeline) confirms:
- `Package.signingPublicKey` matches `Publisher.signingPublicKey`.
- `Package.signingKeyId` is in `Publisher.activeKeyIds`.
- The Ed25519 signature verifies over the canonicalised `integrity.json`.

A failed signature verification produces `SignatureVerificationError` with the canonicalised integrity document attached (for the publisher to debug). The registry **never** reveals the publisher's public key in the error message (defence against key-confirmation oracle attacks).

### 3.5 Semantic versioning

`ExtensionVersion.version` must be a valid semver (`MAJOR.MINOR.PATCH`, optionally with `-prerelease` and `+build` metadata). The platform enforces:

| Transition | Allowed? | Notes |
|---|---|---|
| `1.0.0` → `1.0.1` (patch) | yes | Bug fixes only; the manifest's `permissions` and `requiredAPIs` must not change. |
| `1.0.0` → `1.1.0` (minor) | yes | New features; new `requiredEvents` allowed; `permissions` may add but not remove. |
| `1.0.0` → `2.0.0` (major) | yes | Breaking changes; `permissions` may change freely; new `compatibilityRanges` required. |
| `1.0.0` → `1.0.0` (same) | no | Re-publishing the same version is forbidden. |
| `1.0.0` → `0.9.0` (downgrade) | no | Use rollback of an existing installation instead. |
| `1.0.0` → `1.0.0-rc.1` | yes | Prerelease versions are allowed but not auto-installed. |
| `1.0.0-rc.1` → `1.0.0` | yes | Promoting a prerelease to a release. |

A MAJOR bump requires the publisher to confirm in the publish request that they have read the platform's breaking-change migration guide (`docs/migrations/<from>-to-<to>.md`).

---

## 4. Staged rollout

A newly published `ExtensionVersion` starts at `rolloutPercentage = 0`. No existing installation is upgraded until a platform operator (or the publisher themselves, if they have `extension.publish` permission) bumps the rollout.

### 4.1 The rollout model

```prisma
model ExtensionVersion {
  id                String   @id @default(cuid())
  extensionId       String
  version           String
  packageId         String
  // ─── Rollout ─────────────────────────────────────────────────────
  rolloutPercentage Int      @default(0)        // 0..100
  rolloutStrategy   String   @default("hash")   // "hash" | "ring" | "explicit"
  rolloutRings      Json?                        // for "ring" strategy: ["ring1","ring2",...]
  // ─── Status ─────────────────────────────────────────────────────
  status            String   @default("VALIDATED") // VALIDATED | PUBLISHED | DEPRECATED | BLOCKED
  reviewRequired    Boolean  @default(false)
  // ─── Scan results (see §3.3) ────────────────────────────────────
  scanStatus        String   @default("clean")
  scanConfidence    Float    @default(1.0)
  scanFindings      Json?
  scannedAt         DateTime?
  scannerName       String?
  // ─── Relations + timestamps ─────────────────────────────────────
  extension         Extension @relation(fields: [extensionId], references: [id])
  package           Package   @relation(fields: [packageId], references: [id])
  installations     ExtensionInstallation[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([extensionId, version])
  @@index([extensionId, status])
}
```

### 4.2 The `hash` strategy (default)

Each tenant's `Organization.id` is hashed (SHA-256, then mod 100) to a stable 0..99 bucket. A version with `rolloutPercentage = 25` is auto-upgraded for tenants whose bucket is < 25. Bumping the percentage from 25 to 50 adds the next 25 buckets atomically.

The bucket assignment is **deterministic and stable** — a tenant that was in bucket 17 yesterday is in bucket 17 today, so the upgrade path is predictable. The hash function is published (`sha256(organizationId + ":" + extensionSlug)` truncated to 8 bytes, mod 100) so tenants can compute their own bucket for transparency.

### 4.3 The `ring` strategy

For high-risk versions, the publisher can declare a sequence of named rings:

```json
{
  "rolloutStrategy": "ring",
  "rolloutRings": ["internal", "canary", "early-adopters", "general"]
}
```

Each ring is mapped to a list of `Organization.id` values via `PUT /api/v1/extensions/:id/versions/:v/rings/:name`. The version is auto-upgraded for tenants in the current active ring only; the publisher promotes a ring by `POST /api/v1/extensions/:id/versions/:v/promote` which moves the active ring pointer forward.

### 4.4 The `explicit` strategy

No auto-upgrade. Each tenant must explicitly run `eks upgrade <extensionId> --version <v>` (or click "Upgrade" in the Console). This is the safest strategy and the default for MAJOR version bumps.

### 4.5 Rollout percentage bumps

```bash
# Bump to 25%:
PUT /api/v1/extensions/loyalty-engine/versions/1.1.0/rollout
{ "percentage": 25 }

# Or via the CLI:
eks rollout loyalty-engine@1.1.0 --percentage 25

# Promote to general availability:
eks rollout loyalty-engine@1.1.0 --percentage 100
```

The platform refuses to bump from 0 directly to 100 — at least one intermediate bump is required (default 10%). This forces a canary step even for trusted publishers. The intermediate bump minimum is configurable per publisher (a `Publisher.canaryRequirement` field, default 10).

### 4.6 Health-gated rollout

When the platform bumps the rollout percentage, it monitors the newly-upgraded installations for 30 minutes. If the error rate exceeds the `Publisher.errorRateThreshold` (default 1%), the rollout is **automatically paused**:

- `ExtensionVersion.rolloutPercentage` is frozen at the current value.
- A `RolloutPaused` event is published to the EventOutbox.
- The publisher and the affected tenants' admins are notified.
- A platform operator must explicitly resume the rollout via `POST /api/v1/extensions/:id/versions/:v/resume` after diagnosing the cause.

The health-gate compares the post-upgrade error rate against the pre-upgrade baseline for the same installations. A spike caused by an unrelated platform incident is filtered out by the comparison.

---

## 5. Rollback

### 5.1 Automatic rollback

If a new version's health-gate fails catastrophically (error rate > 10% in the first 5 minutes), the platform **automatically rolls back** all installations that were upgraded to the new version, restoring their `activeVersionId` to `previousVersionId`. The operator is notified; the publisher's `Publisher.autoRollbackCount` is incremented; three auto-rollbacks within 30 days trigger a mandatory review.

### 5.2 Manual rollback (per installation)

An operator can roll back a single installation to any prior PUBLISHED version:

```bash
eks rollback --installation inst_abc --to-version 1.0.0
# or
POST /api/v1/extensions/loyalty-engine/installations/inst_abc/rollback
{ "toVersion": "1.0.0" }
```

The rollback:
1. Verifies the target version is in `PUBLISHED` status and the publisher has not deprecated it.
2. Writes the new `activeVersionId` and the old one to `previousVersionId`.
3. Evicts the isolate pool for the installation (so the next invocation cold-starts with the rolled-back version).
4. Stages an `Extension.RolledBack.v1` event to the EventOutbox.
5. Records an `AuditLog` row with `action = EXTENSION_ROLLBACK`, `actorUserId`, `fromVersion`, `toVersion`, `reason`.

### 5.3 Manual rollback (per version — "yank")

A publisher can "yank" a version, which prevents any **new** installation from using it but does not affect existing installations:

```bash
eks yank loyalty-engine@1.1.0 --reason "data_loss_bug"
```

Yank sets `ExtensionVersion.status = "DEPRECATED` and `blockedReason = reason`. Existing installations are unaffected — they continue running on the deprecated version until the tenant explicitly upgrades. The Console surfaces a "deprecated" badge and recommends the latest non-deprecated version.

A full "block" (which **does** force existing installations to roll back) is reserved for the platform team and is only used for security incidents. A blocked version's `ExtensionInstallation` rows are auto-rolled-back to their `previousVersionId` and the installation's `status` is set to `SUSPENDED` with `reason = "version_blocked"`.

---

## 6. The `Extension` and `ExtensionVersion` lifecycle

```
Extension
   │ (created on first publish by a given publisher+slug pair)
   │
   ├── ExtensionVersion 1.0.0  ─── VALIDATED → PUBLISHED → (DEPRECATED | BLOCKED)
   ├── ExtensionVersion 1.1.0  ─── VALIDATED → PUBLISHED
   ├── ExtensionVersion 1.2.0  ─── VALIDATED (reviewRequired=true, awaiting scan clearance)
   └── ExtensionVersion 2.0.0  ─── VALIDATED → PUBLISHED

ExtensionInstallation (one per tenant per extension)
   │
   ├── activeVersionId → ExtensionVersion 1.1.0
   ├── previousVersionId → ExtensionVersion 1.0.0
   └── status: ACTIVE
```

The `Extension` row is the canonical identity; `ExtensionVersion` rows are immutable once PUBLISHED; `ExtensionInstallation` rows are the per-tenant mutable state.

---

## 7. Permissions for publishing

| Action | Required permission | Who has it |
|---|---|---|
| `POST /api/v1/registry/versions` (publish) | `extension.publish` | The publisher's OWNER role |
| `PUT /api/v1/extensions/:id/versions/:v/rollout` | `extension.publish` | The publisher's OWNER or ADMIN role |
| `POST /api/v1/extensions/:id/versions/:v/yank` | `extension.publish` | The publisher's OWNER role |
| `POST /api/v1/extensions/:id/versions/:v/block` | `extension.publish` (platform only) | Eks-Food platform team |
| `POST /api/v1/extensions/:id/install` | `extension.install` | Any tenant admin |
| `POST /api/v1/extensions/:id/upgrade` | `extension.manage` | Any tenant admin |
| `POST /api/v1/extensions/:id/rollback` | `extension.manage` | Any tenant admin |
| `POST /api/v1/extensions/:id/remove` | `extension.manage` | Any tenant admin |

These action codes are registered in the M2 `PERMISSIONS` registry (`src/packages/authorization/permissions.ts`) and follow the standard `authorize(principal, action, resource)` flow.

---

## 8. What's coming in M5 (the public marketplace)

M3 ships the private registry. M5 will ship the public marketplace on top of it:

- **Public listing** — `Extension` rows with `Publisher.kind = "partner"` and `marketplaceVisibility = "public"` become searchable.
- **Ratings and reviews** — a new `ExtensionReview` model; one review per (userId, extensionId).
- **Revenue split** — the publisher declares a price; the platform takes a commission; payouts flow through the M1 `@eks/payments` port.
- **Search and discovery** — full-text search over `name`, `description`, `categories`; category taxonomy.
- **Automated security review** — every public extension goes through the real malware scanner (M3's interface, M4's first implementation) and a manual code review before being listed.

The M3 pipeline is designed to be forward-compatible with M5: every `Publisher`, `Extension`, `ExtensionVersion`, and `Package` row created in M3 will be visible in the M5 marketplace without migration.

---

## 9. The `eks publish` command (quick reference)

```bash
eks publish [options]

Options:
  --registry <url>            Registry URL (default: https://registry.eks.food)
  --package <path>            Path to the .ekx (default: dist/<slug>-<version>.ekx)
  --key <path>                Path to the publisher's private key (default: .eks/signing-key.pem)
  --key-id <id>               Key id (default: key-2025-01)
  --notes <string>            Release notes (markdown; surfaced in the Console)
  --notes-file <path>         Read release notes from a file
  --compatibility-check <bool> Verify compatibilityRanges before publish (default: true)
  --scan <bool>               Run the malware scanner (default: true)
  --confirm-breaking          Required for MAJOR version bumps
  --dry-run                   Run all stages but do not commit the ExtensionVersion row
  --wait                      Block until the version reaches PUBLISHED (default: false)
  --timeout <seconds>         Max wait time for --wait (default: 300)
```

Typical usage:

```bash
# Initial publish:
eks publish --notes "Initial release" --wait

# Major version:
eks publish --notes "Breaking: removed legacy /v1/redeem route" --confirm-breaking

# Dry run (for CI):
eks publish --dry-run
```

---

## 10. Cross-references

| Topic | Document |
|---|---|
| Packaging, signing, integrity | `PACKAGING_GUIDE.md` |
| Publisher model, signing-key onboarding | `SECURITY_MODEL.md` §2 |
| Malware-scanner interface | `SECURITY_MODEL.md` §6 |
| Permission codes (`extension.publish`, `extension.install`) | `PERMISSION_MODEL.md` |
| Installation lifecycle (install/upgrade/rollback) | `RUNTIME_ARCHITECTURE.md` §3 |
| Staged rollout + feature-flag integration | `ARCHITECTURE.md` §6.3 |
| `eks` CLI command reference | `CLI_GUIDE.md` |
| M2 authorization (`authorize()`, `Principal`) | `docs/identity/AUTHORIZATION_POLICIES.md` |
| M1 event outbox (`Extension.VersionPublished.v1`) | `docs/EVENT_CONVENTIONS.md` |
