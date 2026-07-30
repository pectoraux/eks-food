# Eks-Food Connector Schema Registry Guide

> **Audience:** Connector authors, integration architects, platform maintainers. Read alongside `ARCHITECTURE.md` (Schema Registry bounded context), `TRANSFORMATION_GUIDE.md` (how mapping templates reference schema versions), `CONNECTOR_DEVELOPMENT.md` §3.8 (the `mapSchema()` method), and the M3 `docs/developer/CONNECTOR_SDK_GUIDE.md` §5 (the schema-mapping helper).
>
> **Status:** M4. The schema registry lives in `@eks/integration/schema-registry.ts`. State is persisted in `SchemaDefinition` (one row per logical schema, e.g. `acme-order`, `eks-booking`) and `SchemaVersion` (one row per semver version of a schema). Compatibility is enforced at publish time and at install time.

---

## 1. Why a Schema Registry?

A connector maps external records to Eks-Food canonical records. Both sides evolve:
- The **external** system (Acme POS) publishes new API versions that add fields, rename fields, or change types.
- The **Eks-Food** canonical schema evolves as the platform adds features (e.g. a `dietaryTags` field on `Booking`).

Without a registry, every schema change is a breaking change: a connector that mapped `customer.phone` to `customerPhone` breaks when Acme renames `customer.phone` to `customer.phoneNumber`. The schema registry provides:

1. **Versioning** — every schema has a semver version; old versions remain queryable.
2. **Compatibility validation** — the registry enforces compatibility rules between versions (backward, forward, full).
3. **Evolution** — schemas can evolve in a controlled way: add fields (backward-compatible), deprecate fields (forward-compatible), remove fields (breaking).
4. **Documentation** — every schema version has a human-readable description, change log, and JSON Schema document.
5. **Validation** — the runtime validates every mapped record against the target schema version. A mismatch surfaces as `CONN_SCHEMA_MISMATCH` from `@eks/connector-sdk/errors`.
6. **Rollback** — a broken schema version can be deprecated; connectors using it are notified and can pin to the previous version.

---

## 2. The `SchemaDefinition` and `SchemaVersion` Models

### 2.1 `SchemaDefinition`

```prisma
model SchemaDefinition {
  id              String   @id @default(cuid())
  organizationId  String?  // null for platform-owned schemas (e.g. eks-booking)
  // The logical name, e.g. "acme-order", "eks-booking", "stripe-payment"
  name            String
  // The role: "source" (external) or "target" (Eks-Food canonical) or "intermediate"
  role            String   // "SOURCE" | "TARGET" | "INTERMEDIATE"
  // The owner: "platform" (Eks-Food team) or "connector:<code>" (the connector that owns this source schema)
  owner           String
  // The current "latest" version (denormalised; updated on publish)
  latestVersion   String?  // e.g. "1.4.2"
  // The current "stable" version (the recommended version for new installations)
  stableVersion   String?
  // Whether this schema is currently active
  active          Boolean  @default(true)
  description     String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  versions        SchemaVersion[]

  @@unique([organizationId, name])
  @@index([role, active])
}
```

### 2.2 `SchemaVersion`

```prisma
model SchemaVersion {
  id              String   @id @default(cuid())
  schemaDefId     String   // → SchemaDefinition.id
  // The semver version, e.g. "1.4.2"
  version         String
  // The JSON Schema document (the actual schema)
  schema          String   // JSON
  // The compatibility level this version declares against its predecessor
  // BACKWARD | FORWARD | FULL | NONE
  compatibility   String   @default("BACKWARD")
  // The change log (human-readable; what changed from the previous version)
  changeLog       String
  // PUBLISHED | DEPRECATED | RETIRED
  status          String   @default("PUBLISHED")
  // The SHA-256 of the schema (for integrity verification)
  checksum        String
  // The previous version (for the compatibility chain)
  previousVersionId String?
  publishedBy     String?
  publishedAt     DateTime @default(now())
  retiredAt       DateTime?

  schemaDef       SchemaDefinition @relation(fields: [schemaDefId], references: [id], onDelete: Cascade)
  previousVersion SchemaVersion?   @relation("SchemaVersionChain", fields: [previousVersionId], references: [id])

  @@unique([schemaDefId, version])
  @@index([schemaDefId, status])
  @@index([status])
}
```

The `previousVersionId` forms a linked list of versions within a schema definition. The registry walks this list to compute compatibility (each version must be compatible with its predecessor per the declared `compatibility` level).

---

## 3. Schema Versioning (Semver)

The platform follows strict semver:

- **MAJOR** (`1.x.x → 2.x.x`) — breaking change. A major version bump requires:
  - A new `SchemaDefinition` row (e.g. `acme-order-v2`) OR a `compatibility=NONE` declaration on the new `SchemaVersion`.
  - A migration guide for connectors using the previous major version.
  - A platform review (the M3 `@eks/registry` validation pipeline flags major-version bumps for human review).
- **MINOR** (`1.4.x → 1.5.0`) — backward-compatible change (added fields, optional fields). A minor version bump requires `compatibility=BACKWARD` or `FULL`.
- **PATCH** (`1.4.2 → 1.4.3`) — documentation, description, or example changes. The schema document is functionally identical (the JSON Schema is the same modulo `$id` and `description`).

The registry enforces:
1. **Uniqueness** — `@@unique([schemaDefId, version])` prevents duplicate versions.
2. **Monotonicity** — a new version must be strictly greater than the previous `latestVersion` (semver compare).
3. **Compatibility** — the new version must pass the declared compatibility check against its predecessor (see §4).
4. **Immutability** — once `PUBLISHED`, a version's `schema` and `checksum` cannot be modified. Corrections require a new version.

---

## 4. Compatibility Validation

The platform supports four compatibility levels:

| Level | What it means | Use case |
|---|---|---|
| `BACKWARD` | New consumers can read old data. New fields must be optional; removed fields must be optional. | Adding optional fields to a schema (most common) |
| `FORWARD` | Old consumers can read new data. New fields must be optional; removed fields must be optional. | Removing optional fields from a schema |
| `FULL` | Both backward and forward. The schema change is fully compatible. | Safest; the default for platform-owned schemas |
| `NONE` | No compatibility guarantee. | Major-version bumps; experimental schemas |

### 4.1 The compatibility check algorithm

The registry's `checkCompatibility(oldSchema, newSchema, level)` (in `@eks/integration/schema-registry.compatibility.ts`):

1. Parse both JSON Schemas into a normalised AST (field paths + types + required-ness).
2. Compute the diff: `added`, `removed`, `modified`.
3. Apply the rules:

| Change | BACKWARD | FORWARD | FULL |
|---|---|---|---|
| Added optional field | ✅ | ✅ | ✅ |
| Added required field | ✅ (with default) | ❌ | ❌ |
| Removed optional field | ✅ | ✅ | ✅ |
| Removed required field | ❌ | ✅ | ❌ |
| Type widened (e.g. int → number) | ✅ | ❌ | ❌ |
| Type narrowed (e.g. number → int) | ❌ | ✅ | ❌ |
| Type changed (e.g. string → boolean) | ❌ | ❌ | ❌ |
| Enum value added | ✅ | ❌ | ❌ |
| Enum value removed | ❌ | ✅ | ❌ |
| Field renamed (without alias) | ❌ | ❌ | ❌ |
| Field renamed (with alias) | ✅ | ✅ | ✅ |

4. If any rule fails, the publish is rejected with `{"error":"incompatible","violations":[...]}`.

### 4.2 Worked example — adding an optional field

The Acme order schema v1.4.2:

```json
{
  "$id": "https://schemas.eks-food.com/acme-order/1.4.2.json",
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "customer": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "phone": { "type": "string" }
      },
      "required": ["name"]
    },
    "total_cents": { "type": "integer" }
  },
  "required": ["id", "customer", "total_cents"]
}
```

Acme announces v1.5.0 adding `customer.email` (optional):

```json
{
  "$id": "https://schemas.eks-food.com/acme-order/1.5.0.json",
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "customer": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "phone": { "type": "string" },
        "email": { "type": "string", "format": "email" }
      },
      "required": ["name"]
    },
    "total_cents": { "type": "integer" }
  },
  "required": ["id", "customer", "total_cents"]
}
```

The compatibility check:
- `added`: `customer.email` (optional)
- `removed`: (none)
- `modified`: (none)
- Result: `BACKWARD ✅`, `FORWARD ✅`, `FULL ✅`.

The registry publishes v1.5.0 with `compatibility=FULL`. Existing connectors using v1.4.2 continue to work (the new field is optional); new connectors can opt into v1.5.0.

### 4.3 Worked example — adding a required field

If Acme had instead added `customer.email` as **required**:

```json
"required": ["name", "email"]
```

The compatibility check:
- `added`: `customer.email` (required)
- Result: `BACKWARD ❌` (old data without `email` would fail validation), `FORWARD ✅` (new consumers can read new data), `FULL ❌`.

The publish is rejected unless the connector author declares `compatibility=NONE` and provides a migration guide (e.g. "old records will have `email=null`; the connector must default to a placeholder").

---

## 5. How Mapping Templates Reference Schema Versions

A `MappingTemplate` declares the source and target schemas by name and version range:

```prisma
model MappingTemplate {
  id              String   @id @default(cuid())
  organizationId  String?  // null for platform-owned templates
  name            String   // e.g. "order-to-booking"
  // The source schema reference (JSON: { name, versionRange })
  sourceSchema    String   // e.g. {"name":"acme-order","versionRange":"^1.4.0"}
  // The target schema reference (JSON: { name, versionRange })
  targetSchema    String   // e.g. {"name":"eks-booking","versionRange":"^1.2.0"}
  // The mapping rules (JSON array of { source, target, transform, required })
  rules           String   // JSON
  // The transformation rule IDs to apply after mapping (JSON array)
  transformationRuleIds String @default("[]")
  // The version of this template (semver)
  version         String   @default("1.0.0")
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, name, version])
  @@index([organizationId, active])
}
```

At runtime, the platform resolves the schema versions:
1. Queries `SchemaDefinition WHERE name=<source.name>` → gets the `SchemaDefinition`.
2. Queries `SchemaVersion WHERE schemaDefId=<id> AND status='PUBLISHED'` → gets all published versions.
3. Filters by the `versionRange` (semver `satisfies` from the M1 `@eks/common`).
4. Picks the highest matching version (or, if the connector pinned a specific version, that version).
5. Same for the target schema.

The `MappingTemplate.rules` are then applied with the resolved schemas in scope. The runtime asserts that the mapped record satisfies the target `SchemaVersion.schema`; if not, it raises `CONN_SCHEMA_MISMATCH` (from `@eks/connector-sdk/errors`).

### 5.1 Worked example — mapping template

`mappings/order-to-booking.json`:

```json
{
  "name": "order-to-booking",
  "sourceSchema": { "name": "acme-order", "versionRange": "^1.4.0" },
  "targetSchema": { "name": "eks-booking", "versionRange": "^1.2.0" },
  "rules": [
    { "source": "id", "target": "externalId", "required": true },
    { "source": "customer.name", "target": "customerName", "required": true },
    { "source": "customer.phone", "target": "customerPhone" },
    { "source": "customer.email", "target": "customerEmail" },
    { "source": "total_cents", "target": "totalAmount", "transform": "toMoneyGHS", "required": true },
    { "source": "region_id", "target": "regionId", "transform": "acmeRegionToEksRegion", "required": true },
    { "source": "created_at", "target": "placedAt", "transform": "toISO", "required": true }
  ],
  "transformationRuleIds": ["tr_price_rounding", "tr_region_lookup"]
}
```

At install time:
1. The runtime resolves `acme-order ^1.4.0` → v1.5.0 (the latest matching).
2. The runtime resolves `eks-booking ^1.2.0` → v1.2.3 (the latest matching).
3. The runtime validates that every `source` path exists in `acme-order@1.5.0` (or is optional in the template).
4. The runtime validates that every `target` path is a valid field in `eks-booking@1.2.3`.
5. The runtime validates that every `transform` (e.g. `toMoneyGHS`, `acmeRegionToEksRegion`, `toISO`) is a registered transformation (either built-in or declared in the connector's `transformations[]`).
6. On success, the template is persisted to `MappingTemplate`.

At sync time:
1. The runtime loads the `MappingTemplate` by `(connectorCode, "order-to-booking")`.
2. Resolves the schema versions (cached for 24h in `@eks/cache`).
3. Applies the rules to each source record.
4. Applies the `transformationRuleIds` in order.
5. Validates the result against `eks-booking@1.2.3`'s JSON Schema.
6. On validation failure: `CONN_SCHEMA_MISMATCH` with the validation error.

See `TRANSFORMATION_GUIDE.md` for the full transformation pipeline.

---

## 6. Schema Evolution

When a schema needs to evolve, the schema owner (the platform team for `eks-*` schemas, the connector author for `<connector>-*` schemas) publishes a new version.

### 6.1 Backward-compatible evolution (most common)

Add an optional field, deprecate an existing field, widen a type, add an enum value. The new version is `compatibility=BACKWARD` (or `FULL`); existing connectors continue to work.

The schema owner:
1. `POST /api/v1/integrations/schemas` with the new version and `compatibility=BACKWARD`.
2. The registry runs the compatibility check; on success, publishes.
3. The new version becomes `latestVersion`; the old version remains `PUBLISHED`.
4. Connectors using `versionRange: "^1.4.0"` automatically pick up the new version on their next sync (the runtime re-resolves the version range every 24h, or on connector restart).
5. The old version is eventually deprecated (see §6.3).

### 6.2 Breaking evolution (major version)

Rename a field, remove a required field, narrow a type. The new version is `compatibility=NONE` and requires a major version bump.

The schema owner:
1. `POST /api/v1/integrations/schemas` with the new major version and `compatibility=NONE`.
2. The registry flags the publish for human review (the M3 validation pipeline).
3. On review approval, publishes.
4. Existing connectors using `versionRange: "^1.4.0"` are NOT auto-upgraded (the major version is outside the range).
5. The schema owner notifies connector authors (via the `Schema.MajorVersionPublished` event) and provides a migration guide.
6. Connector authors update their templates to `versionRange: "^2.0.0"` and ship a new connector version.

### 6.3 Deprecation

A schema version can be deprecated:

```
POST /api/v1/integrations/schemas/acme-order/versions/1.4.2/deprecate
{ "reason": "Acme has discontinued v1 of their API; upgrade to 1.5.0+", "deprecatedBy": "user_eks_platform_team" }
```

This:
1. Transitions the `SchemaVersion.status` to `DEPRECATED`.
2. Emits `Schema.Deprecated` to the `EventOutbox`.
3. `@eks/notifications` alerts every connector author whose templates reference the deprecated version.
4. The Integration Console shows a "Schema deprecated" warning on the connector detail page.
5. The deprecated version continues to function for 90 days (grace period), after which it is `RETIRED`.

A retired version is unusable — connectors referencing it fail at sync time with `CONN_SCHEMA_MISMATCH` (the runtime refuses to load a retired version). Connector authors must update their templates before the retirement date.

---

## 7. Schema Documentation

Every `SchemaVersion` has:
- `changeLog` — a human-readable description of what changed from the previous version.
- `schema` — the JSON Schema document (which includes `description` fields per property).
- `checksum` — the SHA-256 of the `schema` (for integrity verification).

The `/api/v1/integrations/schemas/:name/versions/:v` route returns the full schema document with the change log:

```json
{
  "name": "acme-order",
  "version": "1.5.0",
  "status": "PUBLISHED",
  "compatibility": "FULL",
  "changeLog": "Added optional customer.email field for upcoming Acme v2 API.",
  "schema": { ... },
  "checksum": "sha256:abc123...",
  "publishedBy": "user_acme_team",
  "publishedAt": "2025-01-15T10:00:00Z"
}
```

The Integration Console renders this as a side-by-side diff against the previous version, highlighting added/removed/modified fields.

---

## 8. Schema Validation

The runtime validates every mapped record against the target `SchemaVersion.schema`. The validation is performed by the M1 `@eks/api/validation` Ajv instance (the same one used for API request validation):

```typescript
// In @eks/integration/mapping.ts
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export function validateAgainstSchema(record: unknown, schemaVersion: SchemaVersion): Result<void, DomainError> {
  const validate = ajv.compile(JSON.parse(schemaVersion.schema));
  if (!validate(record)) {
    return err({
      code: "CONN_SCHEMA_MISMATCH",
      message: `Schema validation failed for ${schemaVersion.schemaDef.name}@${schemaVersion.version}`,
      details: validate.errors,
    });
  }
  return ok(undefined);
}
```

On validation failure:
1. The runtime records a `ConnectorExecution` row (`status=FAILED`, `errorMessage=CONN_SCHEMA_MISMATCH: <details>`).
2. The mapped record is dropped (not emitted to the outbox).
3. The `SynchronizationJob.errors` counter is incremented.
4. If `errors > batchSize × 0.5`, the job transitions to `FAILED` with `errorMessage="error_rate_exceeded"`.

Validation is **opt-out**: a connector can declare `skipSchemaValidation: true` in the manifest (e.g. for legacy sources with non-deterministic shapes). This is strongly discouraged and requires a platform review.

---

## 9. Schema Rollback

When a published schema version turns out to be broken (e.g. a typo in the JSON Schema causes every mapped record to fail validation), the schema owner can roll back:

```
POST /api/v1/integrations/schemas/acme-order/versions/1.5.0/retire
{ "reason": "Schema validation regex is incorrect; rolling back to 1.4.2", "retiredBy": "user_acme_team" }
```

This:
1. Transitions `SchemaVersion.status` to `RETIRED`.
2. Updates `SchemaDefinition.latestVersion` to the previous non-retired version (e.g. `1.4.2`).
3. Emits `Schema.Retired` to the `EventOutbox`.
4. Connectors using `versionRange: "^1.4.0"` are notified; the runtime re-resolves the version (since v1.5.0 is retired, the highest matching is v1.4.2).
5. Connectors using `versionRange: "^1.5.0"` (pinned to the broken version) fail at sync time with `CONN_SCHEMA_MISMATCH`; the connector author must update the range.

Rollback is fast (no data migration; the previous version was never deleted) and safe (the retired version remains queryable for audit).

---

## 10. Schema Registry API Reference

```
# Schema definition management
GET    /api/v1/integrations/schemas                          — list (filter by role, owner, active)
POST   /api/v1/integrations/schemas                          — create a new schema definition
GET    /api/v1/integrations/schemas/:name                    — schema definition detail (with versions)
PATCH  /api/v1/integrations/schemas/:name                    — update (description, active)
DELETE /api/v1/integrations/schemas/:name                    — remove (must have no PUBLISHED versions)

# Version management
GET    /api/v1/integrations/schemas/:name/versions           — list versions
POST   /api/v1/integrations/schemas/:name/versions           — publish a new version (body: { version, schema, compatibility, changeLog })
GET    /api/v1/integrations/schemas/:name/versions/:v        — version detail
POST   /api/v1/integrations/schemas/:name/versions/:v/check  — compatibility check (no publish)
POST   /api/v1/integrations/schemas/:name/versions/:v/deprecate — deprecate
POST   /api/v1/integrations/schemas/:name/versions/:v/retire    — retire (rollback)
GET    /api/v1/integrations/schemas/:name/versions/:v/diff   — diff against the previous version

# Mapping template management
GET    /api/v1/integrations/mappings                         — list (filter by source/target schema)
POST   /api/v1/integrations/mappings                         — create
GET    /api/v1/integrations/mappings/:id                     — detail
PATCH  /api/v1/integrations/mappings/:id                     — update (rules, transformationRuleIds)
DELETE /api/v1/integrations/mappings/:id                     — remove
POST   /api/v1/integrations/mappings/:id/validate            — validate the rules against the resolved schemas
```

---

## 11. Worked Example — End-to-End Schema Lifecycle

This section traces the `acme-order` schema from initial publication through a minor-version evolution to a major-version breaking change.

### 11.1 Initial publication (v1.0.0)

Acme publishes their initial order schema:

```
POST /api/v1/integrations/schemas/acme-order/versions
{
  "version": "1.0.0",
  "schema": { ... },  // the v1.0.0 JSON Schema
  "compatibility": "FULL",
  "changeLog": "Initial publication."
}
```

The registry:
1. Creates `SchemaDefinition` (`name=acme-order`, `role=SOURCE`, `owner=connector:acme-pos`, `latestVersion=1.0.0`).
2. Creates `SchemaVersion` (`version=1.0.0`, `status=PUBLISHED`, `compatibility=FULL`).
3. Emits `Schema.Published` to the `EventOutbox`.

### 11.2 Minor-version evolution (v1.5.0)

Six months later, Acme adds `customer.email` (optional) to their API:

```
POST /api/v1/integrations/schemas/acme-order/versions
{
  "version": "1.5.0",
  "schema": { ... },  // the v1.5.0 JSON Schema (with optional email)
  "compatibility": "FULL",
  "changeLog": "Added optional customer.email field for upcoming Acme v2 API."
}
```

The registry:
1. Runs the compatibility check against v1.0.0 → `FULL ✅`.
2. Creates `SchemaVersion` (`version=1.5.0`, `status=PUBLISHED`, `previousVersionId=<v1.0.0 id>`).
3. Updates `SchemaDefinition.latestVersion=1.5.0`.
4. Emits `Schema.Published`.
5. Connectors using `versionRange: "^1.0.0"` automatically pick up v1.5.0 on their next sync (within 24h).

### 11.3 Major-version breaking change (v2.0.0)

Acme announces v2 of their API, renaming `customer.phone` to `customer.phoneNumber`:

```
POST /api/v1/integrations/schemas/acme-order/versions
{
  "version": "2.0.0",
  "schema": { ... },  // the v2.0.0 JSON Schema (with phoneNumber instead of phone)
  "compatibility": "NONE",
  "changeLog": "BREAKING: renamed customer.phone to customer.phoneNumber. Migration guide: https://docs.acme.test/migrate-v2"
}
```

The registry:
1. Runs the compatibility check → `NONE` (field rename without alias).
2. Flags for human review (the M3 validation pipeline).
3. On review approval, creates `SchemaVersion` (`version=2.0.0`, `status=PUBLISHED`, `compatibility=NONE`).
4. Updates `SchemaDefinition.latestVersion=2.0.0`.
5. Emits `Schema.MajorVersionPublished` to the `EventOutbox`.
6. Existing connectors using `versionRange: "^1.0.0"` continue to use v1.5.0 (not auto-upgraded).
7. The Acme connector author updates their mapping template:
   ```json
   { "sourceSchema": { "name": "acme-order", "versionRange": "^2.0.0" }, ... }
   ```
   and ships a new connector version (1.5.0 → 2.0.0 of the connector).
8. The connector's `Schema.RenamedField` migration logic (in the connector code) handles the field rename transparently: it reads from `customer.phoneNumber` if present, falls back to `customer.phone` for older records.

### 11.4 Deprecation of v1.0.0

When v1.0.0 is no longer needed (all connectors have moved to v1.5.0+):

```
POST /api/v1/integrations/schemas/acme-order/versions/1.0.0/deprecate
{ "reason": "All consumers on ^1.5.0; deprecating v1.0.0", "deprecatedBy": "user_acme_team" }
```

The registry transitions v1.0.0 to `DEPRECATED`, alerts any remaining consumers, and schedules retirement for 90 days later.

---

## 12. Common Schema Registry Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Pinning to an exact version (`version: "1.4.2"`) instead of a range | Cannot pick up backward-compatible patches | Use `versionRange: "^1.4.2"` (or `~1.4.2` for patch-only) |
| Declaring `compatibility=NONE` to bypass the check | Every version is a breaking change; consumers can never upgrade | Use `NONE` only for genuine major-version bumps; provide a migration guide |
| Adding a required field without a default | Old records fail validation | Add the field as optional first, migrate old records, then make it required in a subsequent version |
| Renaming a field without an alias | Mapping templates break | Add the new field alongside the old (both optional), update consumers, then remove the old in a major version |
| Not publishing a change log | Consumers cannot decide whether to upgrade | Every version must have a non-empty `changeLog` (enforced by the registry) |
| Using `format: "date-time"` without an example | Consumers misinterpret the format | Always include `examples` in the JSON Schema; the Integration Console renders them |
| Publishing a new version with the same `checksum` as the previous | No-op publish; consumers think nothing changed | The registry rejects same-checksum publishes with `{"error":"identical_to_previous"}` |
| Forgetting to retire a deprecated version | Deprecated versions linger forever | The registry alerts the schema owner 30 days before the 90-day grace period expires |

When in doubt, run `bunx @eks/dev-cli validate --schemas` — it static-analyses the connector's schema declarations and templates for these pitfalls.
