# Eks-Food Packaging Guide

> **Audience:** Extension and connector authors preparing to publish. Read alongside `EXTENSION_AUTHORING.md` (project structure + manifest), `PUBLISHING_GUIDE.md` (what happens after `eks publish`), `SECURITY_MODEL.md` (signing keys, secret management), and `CLI_GUIDE.md` (the `eks package` command).
>
> **Status:** Milestone 3. This document specifies the `.ekx` package format, the dependency-locking rules, the SHA-256 integrity verification, the Ed25519 digital signature, the tar+zstd compression, and the reproducible-build guarantees that the `@eks/registry` enforces on every published `Package`.

---

## 1. What an `.ekx` package is

An `.ekx` file is a single artifact that contains everything the runtime needs to cold-start an extension:

- The bundled JavaScript entrypoint (ESM, tree-shaken, minified).
- The static assets declared in the manifest (icons, locale catalogs).
- A deterministic dependency lockfile (the exact module versions bundled).
- The manifest itself, with all relative paths resolved.
- A SHA-256 integrity manifest (one checksum per file inside the package).
- An Ed25519 detached signature over the integrity manifest, produced by the publisher's private key.
- The publisher's Ed25519 public key fingerprint (so the registry can match it against the `Publisher.signingPublicKey` row).

The format is **tar + zstd** (`.tar.zst`), wrapped in a single file with the `.ekx` extension. The choice of zstd over gzip is intentional: zstd's content-defined chunking produces near-identical archives for small source diffs, which makes package storage and CDN distribution cheaper. The choice of tar (not zip) is intentional: tar preserves Unix permissions and mtime, which the reproducible-build pipeline relies on.

The naming convention is `<slug>-<version>.ekx` (e.g. `loyalty-engine-1.0.0.ekx`). The package file name is part of the integrity contract — renaming a package invalidates the signature, because the name is recorded inside the integrity manifest.

---

## 2. The `Package` Prisma model

Every published package is recorded as a `Package` row. The model is the source of truth for what's in the registry; the `.ekx` file itself is content-addressable storage (the file is stored at a path derived from its SHA-256, not from its name).

```prisma
model Package {
  id                String   @id @default(cuid())
  publisherId       String
  extensionId       String
  version           String              // semver, e.g. "1.0.0"
  // ── Storage ───────────────────────────────────────────────────────
  storageKey        String              // e.g. "packages/ab/cd/abcd1234…ef.ekx"
  sizeBytes         Int
  // ── Integrity ─────────────────────────────────────────────────────
  sha256            String              // SHA-256 of the entire .ekx file
  integrityManifest String              // JSON: { "files": [{ "path": "...", "sha256": "..." }] }
  // ── Signature ─────────────────────────────────────────────────────
  signingAlgorithm  String   @default("ed25519")
  signature         String              // base64 detached signature over integrityManifest
  signingPublicKey  String              // base64 Ed25519 public key (matches Publisher.signingPublicKey)
  signingKeyId      String              // publisher-assigned key id (e.g. "key-2025-01")
  // ── Bundler ───────────────────────────────────────────────────────
  bundler           String              // "esbuild@0.21.0"
  bundlerConfigHash String              // SHA-256 of the bundler config
  // ── Reproducibility ───────────────────────────────────────────────
  sourceCommitSha   String?             // git commit sha (if reproducible-build mode)
  sourceTreeHash    String?             // git tree hash (deterministic across clones)
  buildHost         String?             // omitted in reproducible mode
  buildTimestamp    String?             // omitted in reproducible mode (set on first install instead)
  // ── Status ────────────────────────────────────────────────────────
  status            String   @default("VALIDATED")  // VALIDATED | PUBLISHED | DEPRECATED | BLOCKED
  publishedAt       DateTime?
  publishedBy       String?             // user id
  blockedReason     String?
  // ── Relations ─────────────────────────────────────────────────────
  publisher         Publisher       @relation(fields: [publisherId], references: [id])
  extension         Extension       @relation(fields: [extensionId], references: [id])
  versions          ExtensionVersion[]
  // ── Timestamps ────────────────────────────────────────────────────
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([extensionId, version])
  @@index([publisherId])
  @@index([sha256])
  @@index([status])
}
```

The model is **immutable once `status = "PUBLISHED"`**. The only field that can change after publish is `status` (to `DEPRECATED` or `BLOCKED`) and the corresponding reason. Re-publishing the same `(extensionId, version)` pair is forbidden — a new version requires a semver bump.

---

## 3. The packaging pipeline

`eks package` runs the following stages in order. Each stage writes intermediate artifacts under `dist/.build/` for inspection.

### Stage 1 — Manifest validation

```bash
eks validate --strict
```

Validates the manifest against the JSON schema, checks that `slug`, `version`, and `publisher.id` match `package.json`, and verifies that every capability declared in `capabilities` has the corresponding permission in `permissions` (e.g. `apis` requires `invoke.apis`). A failure here aborts packaging before any code is bundled.

### Stage 2 — Dependency locking

The bundler resolves the full dependency tree starting from `package.json` and writes a lockfile that records the exact version of every module bundled into the package. The lockfile is the second line of defence against supply-chain attacks (the first is the publisher's signing key).

```jsonc
// dist/.build/eks-lock.json
{
  "lockfileVersion": 1,
  "bundler": "esbuild@0.21.0",
  "root": { "name": "loyalty-engine", "version": "1.0.0" },
  "dependencies": [
    { "name": "@eks/sdk", "version": "3.1.2", "resolved": "internal:@eks/sdk", "integrity": "sha512-…" },
    { "name": "stripe", "version": "14.21.0", "resolved": "npm:stripe@14.21.0", "integrity": "sha512-…" },
    { "name": "zod", "version": "3.23.8", "resolved": "npm:zod@3.23.8", "integrity": "sha512-…" }
  ],
  "forbidden": [],
  "warnings": []
}
```

Locking rules:
- **`@eks/sdk` and `@eks/connector-sdk` are always locked to a version that satisfies `compatibilityRanges` in the manifest.** A manifest declaring `"@eks/sdk": "^3.0.0"` cannot be packaged with `@eks/sdk@2.5.0`.
- **Every external dependency must have an `integrity` field** (a SHA-512 from the npm registry). Bundling a dependency without a lockfile entry aborts packaging.
- **A deny-list of forbidden packages is enforced** (see `SECURITY_MODEL.md` §6). Currently the list includes: `child_process`, `node:fs`, `node:net`, `node:child_process`, `eval`, `vm2`, and any package whose name matches `^p(?:r|rea)built($|-)`. The `forbidden` array in the lockfile lists any packages that were flagged and stripped; the `warnings` array lists packages that were allowed but are under review.
- **The lockfile is bundled inside the `.ekx`** so the registry can re-verify it at install time.

### Stage 3 — Bundling

The bundler is **esbuild** (configured by `@eks/dev-cli`). The bundle is:
- **ESM format** (`.mjs`).
- **Tree-shaken** — only the modules actually imported by the entrypoint are included.
- **Minified** (variable names mangled, whitespace stripped).
- **Source maps** included as a separate `.map` file inside the package (not inline — keeps the bundle small for cold-start).
- **No external dependencies** — every module is bundled in. The only external is `@eks/sdk`, which is provided by the runtime at cold-start.

```bash
esbuild src/index.ts \
  --bundle \
  --format=esm \
  --platform=node \
  --target=node20 \
  --minify \
  --sourcemap=external \
  --outfile=dist/.build/index.mjs \
  --external:@eks/sdk \
  --external:@eks/connector-sdk \
  --banner:js='//# sourceURL=eks://loyalty-engine/1.0.0/index.mjs'
```

The `--external:@eks/sdk` flag is critical: the SDK is provided by the runtime at cold-start (so it can be shared across all extensions for memory efficiency), and the bundle must not include a private copy. The runtime resolves the `import "@eks/sdk"` at module-load time against the platform's own SDK instance.

### Stage 4 — Static asset collection

The bundler copies the static assets declared in the manifest into `dist/.build/assets/`:
- `manifest.icon` (if set)
- `manifest.localization.catalogPath` (per-locale JSON files)
- Any `assets/` directory entries referenced by `configurationSchema`'s `$comment` fields (this is the conventional way to bundle reference data)

Each asset is SHA-256 checksummed and added to the integrity manifest.

### Stage 5 — Integrity manifest

The integrity manifest is a JSON document listing every file inside the package and its SHA-256 checksum. It is the document that the Ed25519 signature is computed over.

```jsonc
// dist/.build/integrity.json
{
  "schemaVersion": 1,
  "package": {
    "slug": "loyalty-engine",
    "version": "1.0.0",
    "kind": "extension",
    "publisherId": "pub_acme"
  },
  "bundler": {
    "name": "esbuild",
    "version": "0.21.0",
    "configHash": "sha256-…"
  },
  "lockfile": {
    "path": "eks-lock.json",
    "sha256": "sha256-…"
  },
  "files": [
    { "path": "index.mjs",        "size": 4_321, "sha256": "sha256-abc…" },
    { "path": "index.mjs.map",    "size": 8_765, "sha256": "sha256-def…" },
    { "path": "manifest.json5",   "size": 1_234, "sha256": "sha256-ghi…" },
    { "path": "eks-lock.json",    "size":   567, "sha256": "sha256-jkl…" },
    { "path": "assets/icon.svg",  "size":   890, "sha256": "sha256-mno…" },
    { "path": "locales/en.json",  "size":   234, "sha256": "sha256-pqr…" },
    { "path": "locales/fr.json",  "size":   256, "sha256": "sha256-stu…" },
    { "path": "locales/sw.json",  "size":   245, "sha256": "sha256-vwx…" }
  ],
  "totalSizeBytes": 18_512,
  "createdAt": "2025-01-15T10:30:00Z"   // only in non-reproducible mode
}
```

The manifest is **canonicalised** before signing:
- JSON keys are sorted alphabetically (recursively).
- Whitespace is removed (no spaces, no newlines).
- UTF-8 encoded.

This canonicalisation is what makes the signature reproducible across machines — the same source tree packaged on two different CI runners produces byte-identical `integrity.json` (modulo the optional `createdAt` field, omitted in reproducible mode).

### Stage 6 — Signing

The signing key is an Ed25519 keypair. The publisher's private key is held by the publisher (typically in a hardware-backed keystore, a 1Password vault, or AWS KMS); the publisher's public key is registered with the platform in the `Publisher.signingPublicKey` column at onboarding time.

```bash
# Generate a keypair (done once per publisher, on onboarding):
eks keys generate --publisher pub_acme --key-id key-2025-01
# → writes .eks/signing-key.pem (private) and prints the public key fingerprint

# Sign the integrity manifest:
eks package --sign --key .eks/signing-key.pem --key-id key-2025-01
```

The signature is a **detached** Ed25519 signature over the canonicalised `integrity.json`:

```typescript
import { sign } from "@noble/ed25519";

const canonicalIntegrityJson = canonicalize(integrityManifest);
const privateKey = await loadPemPrivateKey(".eks/signing-key.pem");
const signature = await sign(toBytes(canonicalIntegrityJson), privateKey);
// signature is 64 bytes, base64-encoded for storage in Package.signature
```

Ed25519 was chosen because:
1. **It is deterministic.** The same input + private key always produces the same signature, which is essential for reproducible builds.
2. **It is fast.** Signing and verification are both sub-millisecond for the typical 5–20 KB integrity manifest.
3. **It is small.** Signatures are 64 bytes; public keys are 32 bytes. This keeps the `Package` row compact and the signature verification step cheap on every install.
4. **It is widely available.** `@noble/ed25519` (a pure-JS implementation) runs in any V8 isolate; no native modules required.

The signing public key fingerprint (`sha256:<first-32-bytes-hex>`) is recorded in the `Package.signingPublicKey` column and **must match** the `Publisher.signingPublicKey` registered for the publisher. A mismatch means the private key was rotated without notifying the platform — the publish is rejected with `SigningKeyMismatchError`.

### Stage 7 — Compression (tar + zstd)

The package contents are archived with `tar` (deterministic mode) and compressed with `zstd` (level 19, long-distance matching).

```bash
# Deterministic tar (no mtime, no owner, sorted entries):
tar --sort=name \
    --mtime=@0 \
    --owner=0 --group=0 --numeric-owner \
    --mode=u=rw,go=r \
    -cf dist/.build/package.tar \
    -C dist/.build/package-root \
    .

# zstd compression (level 19, long-distance matching window):
zstd --ultra -19 --long=27 \
     -f dist/.build/package.tar \
     -o dist/loyalty-engine-1.0.0.ekx
```

The `--sort=name` and `--mtime=@0` flags make the tar deterministic — the same input tree always produces the same tar bytes. The `--long=27` flag enables a 128 MB matching window, which gives zstd its best compression ratio for code packages (which have a lot of repeated boilerplate between versions).

The resulting `.ekx` file is **content-addressable**: its SHA-256 (stored in `Package.sha256`) uniquely identifies it. Two publishers packaging the exact same source tree produce the exact same `.ekx` bytes and the exact same `Package.sha256` — which is how the registry detects accidental duplicate uploads.

### Stage 8 — Reproducible build verification

After packaging, the CLI re-runs the packaging pipeline in a second temp directory and verifies that the second `.ekx` is byte-identical to the first:

```bash
eks package --verify-reproducibility
# ✓ initial package: 18_512 bytes, sha256=abc…
# ✓ reproducible build: 18_512 bytes, sha256=abc…
# ✓ byte-identical — package is reproducible
```

A non-reproducible package fails the `--verify-reproducibility` check. The most common causes of non-reproducibility are:
- A dependency that embeds a build timestamp in its bundle (rare with esbuild-tree-shaken bundles).
- A source asset with a non-deterministic mtime that gets baked into the tar.
- An `eval(...)` or `new Function(...)` that captures the bundler's environment.

The CLI prints the diff between the two `.ekx` files (decompressed and untarred) to help locate the source of non-determinism.

---

## 4. The `.ekx` file layout

The internal layout of an `.ekx` (after `tar -tf` extraction) is:

```
./
├── manifest.json5                # the manifest (paths resolved)
├── index.mjs                     # the bundled entrypoint
├── index.mjs.map                 # esbuild external source map
├── eks-lock.json                 # the dependency lockfile
├── integrity.json                # the integrity manifest (canonical)
├── signature.bin                 # the Ed25519 detached signature (64 bytes)
├── assets/
│   └── icon.svg
└── locales/
    ├── en.json
    ├── fr.json
    └── sw.json
```

The runtime reads `manifest.json5`, `integrity.json`, and `signature.bin` at cold-start. It does not read `index.mjs` until the first invocation (lazy module load), which keeps cold-start fast.

---

## 5. Integrity verification on install

When an operator runs `eks install` (or POSTs to `/api/v1/extensions/:id/install`), the registry performs the following verification before the installation is committed to `ExtensionInstallation`:

```
1. Fetch the .ekx from content-addressable storage by Package.sha256.
   ↓
2. Compute SHA-256 of the entire .ekx file.
   • If it does not match Package.sha256 → reject with IntegrityError.
   ↓
3. Decompress (zstd -d) and untar (tar -xf) into a temp directory.
   ↓
4. Read integrity.json from the temp directory.
   ↓
5. Canonicalise integrity.json (sort keys, strip whitespace).
   ↓
6. Read signature.bin (64 bytes).
   ↓
7. Resolve the publisher's signing public key:
   a. Look up Publisher.signingPublicKey by Package.publisherId.
   b. Confirm Package.signingPublicKey == Publisher.signingPublicKey.
      (else: SigningKeyMismatchError)
   c. Confirm Package.signingKeyId is in Publisher.activeKeyIds.
      (else: SigningKeyRevokedError)
   ↓
8. Verify the Ed25519 signature:
   verify(publicKey, canonicalIntegrityJson, signature)
   • If verification fails → reject with SignatureVerificationError.
   ↓
9. For each file in integrity.json.files:
   a. Open the file from the temp directory.
   b. Compute its SHA-256.
   c. Compare to the recorded sha256.
   • Any mismatch → reject with FileIntegrityError.
   ↓
10. Validate the manifest against the schema (re-run of Stage 1).
   ↓
11. Validate the lockfile:
    a. No forbidden packages present.
    b. All @eks/sdk / @eks/connector-sdk versions satisfy compatibilityRanges.
    c. All external dependencies have integrity hashes.
   ↓
12. (Optional, M3.1) Run the configured malware-scan hook on the temp directory.
   See PUBLISHING_GUIDE.md §3.4.
   ↓
13. Move the verified temp directory into the runtime's package cache:
    /var/lib/eks/packages/<extensionId>/<version>/
   ↓
14. Create the ExtensionInstallation row (status = PENDING).
   ↓
15. Stage the Extension.Installed event to the EventOutbox.
   ↓
16. Commit the transaction. The extension is now installable.
```

Every step is audited: the `AuditLog` row records `(action=EXTENSION_PACKAGE_VERIFIED, extensionId, version, sha256, signatureKeyId, integrityChecksPassed=12/12)`. The literal action code is taken from `DEVELOPER_AUDIT_ACTIONS.PACKAGE_SIGNATURE_VERIFIED` in `@eks/developer` (`src/packages/developer/audit-actions.ts`) — the verification handler imports the constant rather than spelling out the string, so SIEM queries and compliance reports that pivot on the code are stable across renames. A successful verification also stages a `PackageSignatureVerified` event (wire string `Package.SignatureVerified`) to the `EventOutbox` via `buildDeveloperEvent` from the same `@eks/developer` package; the event is what triggers the eager cold-start on a fresh install and what the Developer Console's live-activity feed subscribes to.

---

## 6. Dependency validation rules

The lockfile enforces a strict allow-list / deny-list model. The rules are evaluated in this order; the first failure aborts the install:

1. **No `node:`-prefixed built-in modules.** The sandbox does not expose Node built-ins; a bundle that imports `node:fs` cannot be loaded. (esbuild's `--external:node:*` is applied automatically; any explicit `import "node:fs"` fails the bundler stage.)
2. **No `child_process`, `cluster`, `worker_threads` (other than the runtime's own usage).** The bundle is loaded inside a worker; spawning more workers is forbidden.
3. **No `eval`, `Function`, `vm.runInContext` (the runtime scans for these tokens after bundling).** The scan is conservative: a string `"eval"` in a comment triggers a warning, not a failure. A real `eval(...)` call triggers a failure.
4. **No packages on the `EKX_FORBIDDEN_PACKAGES` list.** The list is maintained in `@eks/registry/forbidden-packages.ts` and versioned with the platform. Current entries:
   - `puppeteer`, `puppeteer-core`, `playwright` (browser automation — should use the platform's headless-browser service, not bundled)
   - `node-fetch` (use the runtime-provided `ctx.apis.request` instead)
   - `axios` (same)
   - `got` (same)
   - `request`, `superagent` (same)
   - `vm2`, `isolated-vm` (the runtime provides isolation; nested VMs are not allowed)
   - `prebuild-install`, `node-pre-gyp` (no native modules)
   - Any package matching `^@prisma/` (no direct DB access)
   - Any package matching `^ioredis$`, `^redis$` (no direct cache access)
5. **All other packages must be pure-JS** (no `.node` native addons). The bundler detects this during `eks package` and refuses to bundle a package that ships a `.node` file.
6. **`@eks/sdk` and `@eks/connector-sdk` are special-cased:** they are always `--external` (provided by the runtime), so they are not bundled into the package. Their version range in `compatibilityRanges` is checked against the runtime's own version at install time.

---

## 7. Reproducible builds — why and how

A reproducible build is one where the **same source tree produces byte-identical `.ekx` output on any machine**. The platform requires reproducible builds for two reasons:

1. **Auditability.** A security reviewer who wants to verify that a published `Package` corresponds to a particular source commit must be able to rebuild it and compare the bytes. Non-reproducible builds break this contract.
2. **Deduplication.** The registry content-addresses packages by SHA-256. If two CI runners produce different bytes for the same source, the registry sees two different packages — even though they are semantically identical. Reproducibility keeps the registry clean.

The reproducibility contract is enforced by:
- **Deterministic tar** (`--sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --mode=u=rw,go=r`).
- **Deterministic JSON canonicalisation** for `integrity.json` (sorted keys, no whitespace).
- **Ed25519 deterministic signing** (same input → same signature).
- **esbuild's `--banner:js`** injects a fixed `//# sourceURL` comment with the package's slug and version — no host-specific paths leak into the bundle.
- **No build-time environment variables.** The bundler does not read `process.env` (the manifest's `configurationSchema` and `compatibilityRanges` are the only inputs). Source-map paths are stripped to relative paths.
- **Optional `sourceTreeHash` and `sourceCommitSha`** recorded in the `Package` row (when `eks package --git` is invoked from a clean git working tree). These enable the registry to confirm reproducibility against a public git repository.

The `--verify-reproducibility` flag (default on in CI mode) re-runs the packaging pipeline in a fresh temp directory and asserts byte-identity. A failure surfaces the diff:

```
✗ reproducibility check failed
  initial:   18_512 bytes  sha256=abc…
  reproducible: 18_512 bytes  sha256=def…
  diff (decompressed):
    --- integrity.json
    +++ integrity.json
    @@ -1,5 +1,5 @@
     {
       "schemaVersion": 1,
       "package": { ... },
    -  "createdAt": "2025-01-15T10:30:00.000Z"
    +  "createdAt": "2025-01-15T10:30:00.123Z"
     }
  fix: re-run with --reproducible to omit the createdAt field
```

The most common fix is `eks package --reproducible`, which omits the `createdAt` field from `integrity.json`. The trade-off is that the package loses its build timestamp (the registry instead records `publishedAt` when the package is first pushed).

---

## 8. The `eks package` command (quick reference)

```bash
eks package [options]

Options:
  --sign                    Sign the package (default: true)
  --key <path>              Path to the Ed25519 private key (default: .eks/signing-key.pem)
  --key-id <id>             Key id to record in Package.signingKeyId (default: key-2025-01)
  --reproducible            Omit build-time metadata (default: true in CI mode)
  --verify-reproducibility  Re-run packaging and assert byte-identity (default: true)
  --git                     Record sourceCommitSha + sourceTreeHash from git
  --bundler <name@version>  Override the bundler (default: esbuild@0.21.0)
  --no-minify               Skip minification (debugging only; never publish with this)
  --no-sourcemap            Skip source map generation
  --strict                  Enable extra manifest + lockfile checks
  --out <dir>               Output directory (default: dist/)
  --watch                   Re-package on file change (dev only)
```

Typical usage:

```bash
# CI pipeline:
eks validate --strict
eks test
eks package --git --reproducible --verify-reproducibility
eks publish --registry https://registry.eks.food --key .eks/signing-key.pem
```

```bash
# Local debugging:
eks package --no-minify --no-sourcemap --out dist/debug/
eks install --local dist/debug/loyalty-engine-1.0.0.ekx --tenant org_dev
```

---

## 9. Cross-references

| Topic | Document |
|---|---|
| Project structure and manifest | `EXTENSION_AUTHORING.md` |
| Publishing pipeline (what happens after `eks publish`) | `PUBLISHING_GUIDE.md` |
| Publisher model and signing-key onboarding | `PUBLISHING_GUIDE.md` §2, `SECURITY_MODEL.md` §2 |
| Runtime package cache and cold-start | `RUNTIME_ARCHITECTURE.md` §3 |
| Forbidden-packages list rationale | `SECURITY_MODEL.md` §6 |
| `eks` CLI command reference | `CLI_GUIDE.md` |
| `@eks/registry` (the package store) | `ARCHITECTURE.md` §2 |
