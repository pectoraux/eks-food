# Eks-Food Canonical Data Standards

> **Audience:** Platform engineers, application developers, data engineers, integration engineers, compliance officers. Read alongside `DOMAIN_MODEL_REFERENCE.md` (entity definitions), `ENTITY_RELATIONSHIPS.md` (relationship vocabulary), `API_DOCUMENTATION.md` (REST contract), `docs/CODING_STANDARDS.md` (general code conventions), `docs/identity/MULTI_TENANCY.md` (tenant isolation model).
>
> **Status:** Milestone 6. This document defines the **canonical data standards** that every entity in the Eks-Food food domain must follow. The standards are enforced by the `@eks/food-domain` package's repository layer, the Prisma schema, the Zod validation schemas, and the M2 `@eks/authorization` engine.

---

## 1. Principles

1. **One canonical model.** Every real-world concept in the food domain (a cook, a kitchen, an ingredient, a recipe, a supplier, a certification, an inspection) is represented by exactly one canonical Prisma model. There are no duplicate or competing representations; downstream contexts (analytics, AI, marketplace) project from the canonical model, never replace it.
2. **Globally unique identifiers.** Every entity has a UUID v4 primary key. No composite keys, no auto-increment integers, no business-field keys. Identifiers are opaque; they carry no semantic meaning.
3. **Tenant isolation by default.** Every entity carries an `organizationId` column (with three documented exceptions). Tenant isolation is enforced at the repository, API, and audit layers.
4. **Audit metadata is mandatory.** Every entity carries the full audit metadata block (§3). No exceptions.
5. **Lifecycle is explicit.** Every entity that has a meaningful lifecycle carries a `state` column with a closed enum and a documented state machine (see `DOMAIN_MODEL_REFERENCE.md`).
6. **Localization is first-class.** Every human-readable string is stored as a localized JSON object, never as a raw string.
7. **Extensibility via JSON metadata.** Every entity carries a `metadata JSON` column for tenant-specific extensions. The schema of `metadata` is validated by a tenant-configurable Zod schema; the platform reserves no keys in `metadata`.
8. **No silent mutations.** Every write increments `version`, writes an `EntityVersion` row, emits a domain event, and writes an audit log entry.
9. **No cross-tenant references.** A reference from a tenant-scoped entity to a different tenant's entity is forbidden and rejected at write time.
10. **No duplicated concepts.** Two entities with overlapping responsibility are merged or one is deprecated. `Supplier` (raw ingredients, B2B) and `Vendor` (finished goods, B2C/B2B) are not duplicates; the distinction is enforced (see `DOMAIN_MODEL_REFERENCE.md` §8.2).

---

## 2. Naming Conventions

### 2.1 Entity (Prisma model) names
- **Singular, PascalCase.** `CustomerProfile`, `Recipe`, `InventoryBatch`, `FoodSafetyIncident`.
- **Suffixes:**
  - `Profile` — a person-type entity that extends the M2 `User` (`CustomerProfile`, `CookProfile`).
  - `Batch` — a lot / subdivision of a container (`InventoryBatch`).
  - `Item` — a member of a collection (`MenuItem`, `RecipeIngredient`).
  - `Incident` — a recorded event of concern (`FoodSafetyIncident`).
  - `Version` — a version-history row (`EntityVersion`).
- **No abbreviations.** `Restaurant`, not `Rstrnt`. `Neighborhood`, not `Nbhd`.
- **No compound prefixes.** All entities live in the same Prisma schema; no `FoodDomain*` prefix is needed. The package boundary is enforced by the `@eks/food-domain` barrel, not by name prefixes.

### 2.2 Field names
- **camelCase** in TypeScript, **snake_case** in the database column (Prisma `@map` attribute bridges the two).
- **Booleans** are prefixed `is` or `has`: `isVerified`, `hasAllergens`. The exception is `active` (a lifecycle flag) and `deprecated` (a soft-deprecation flag).
- **Timestamps** end in `At`: `createdAt`, `updatedAt`, `deletedAt`, `expiresAt`, `completedAt`.
- **Foreign keys** end in `Id`: `organizationId`, `kitchenId`, `ingredientId`.
- **Enums** are SCREAMING_SNAKE_CASE: `DRAFT`, `PUBLISHED`, `DEPRECATED`.
- **JSON columns** that hold arrays are pluralized: `tags`, `allergens`, `cuisines`. JSON columns that hold a single object are singular: `metadata`, `properties`, `nutrition`.

### 2.3 Edge-type names
Edge types in the `Relationship.type` column are **snake_case verbs or prepositions**: `member_of`, `works_at`, `contains`, `supplies`, `supplies_to`, `inspects`, `certified_by`, `follows`, `operates`, `located_in`, `authored_by`, `featured_in`, `derived_from`, `substitutes`, `partner_of`, `fork_from`, `stocks`, `stocked_at`, `produces`, `produced_at`, `requires`, `owned_by`, `operated_by`, `lives_in`. The closed vocabulary is in `@eks/food-domain/graph/edge-types.ts`.

### 2.4 Event-type names
Domain events follow the M1 `DomainEvent` convention: `{context}.{entity}.{operation}.v{version}`. Examples:
- `food-domain.ingredient.created.v1`
- `food-domain.recipe.published.v1`
- `food-domain.graph.edge.created.v1`
- `food-domain.certification.expiring.v1`
- `food-domain.safety.incident.critical.v1`

The `v1` suffix is the **event schema version**, independent of the package version. A breaking change to the event payload increments the suffix (`v2`) and the old event continues to be published for one minor release to allow consumer migration.

### 2.5 API route names
REST routes are **kebab-case**, plural, and resource-named: `/api/v1/food-domain/customers`, `/api/v1/food-domain/inventory-batches`, `/api/v1/food-domain/food-safety-incidents`. The full route table is in `API_DOCUMENTATION.md`.

### 2.6 Audit-action codes
Audit codes follow the M2 convention (`{context}.{entity}.{operation}`): `food-domain.recipe.create`, `food-domain.kitchen.state-transition`, `food-domain.certification.revoke`, `food-domain.graph.edge.supersede`. The closed vocabulary is in `@eks/food-domain/audit-actions.ts`.

---

## 3. Audit Metadata Block

Every canonical entity carries the following block. The block is generated by the `@eks/food-domain/shared/audit-fields` helper and applied to every Prisma model in the schema:

| Field | Prisma type | DB column | Notes |
|---|---|---|---|
| `id` | `String @id @default(uuid())` | `id` | UUID v4. |
| `organizationId` | `String?` | `organization_id` | Null only for tenant-shared entities (§6). |
| `version` | `Int @default(1)` | `version` | Optimistic concurrency. Incremented on every write. |
| `createdAt` | `DateTime @default(now())` | `created_at` | Set once. |
| `updatedAt` | `DateTime @updatedAt` | `updated_at` | Set on every write. |
| `deletedAt` | `DateTime?` | `deleted_at` | Soft-delete timestamp. Null while the entity is live. |
| `createdBy` | `String` | `created_by` | FK → `User.id` (M2). |
| `updatedBy` | `String` | `updated_by` | FK → `User.id`. Set on every write. |
| `deletedBy` | `String?` | `deleted_by` | FK → `User.id`. Set on soft-delete. |
| `metadata` | `Json @default("{}")` | `metadata` | Extensible JSON (§8). |

The block is non-negotiable. Prisma models missing any of these fields are rejected at the schema-lint stage of CI.

### 3.1 Soft delete vs hard delete
- **Soft delete** is the default. The `deletedAt` column is set; the row remains in the database. Queries through the `@eks/food-domain` repository automatically filter `WHERE deleted_at IS NULL` unless the caller explicitly passes `includeDeleted: true`.
- **Hard delete** is reserved for data-retention compliance and is performed only by the `RetentionSweepJob` (§9). It removes the row physically; the `EntityVersion` rows for that entity are retained until their own retention window expires.

### 3.2 Optimistic concurrency
Every update includes `WHERE id = ? AND version = ?` in the SQL, and the write increments `version`. If the row was updated by another transaction, the update affects 0 rows and the repository throws a `ConflictError` (RFC 7807 `409`, `type: "https://docs.eks-food.com/errors/optimistic-concurrency"`).

---

## 4. Identifiers

### 4.1 UUID v4
All primary keys are UUID v4 (`String @id @default(uuid())`). The M1 `@eks/common/ids` helper provides `generateUuid()`, `validateUuid()`, and `formatUuid()` (the last formats a UUID with hyphens for display).

### 4.2 Human-readable codes
Some entities carry a **human-readable code** in addition to the UUID:
- `Country.iso2`, `Country.iso3` — ISO 3166-1.
- `Region.code` — ISO 3166-2 (e.g. `"GH-AH"`).
- `InventoryBatch.batchCode` — supplier-provided lot code.
- `Certification.certificateNumber` — issuer-provided.
- `Vehicle.registration` — license plate.

Codes are **unique within their scope** (e.g. `Country.iso2` is globally unique; `Vehicle.registration` is unique per country) but they are **never used as primary keys**. The UUID is the only identifier used in APIs and graph edges.

### 4.3 Stable external identifiers
Entities that originate from external systems (loaded via M4 connectors) carry an `externalIds JSON` column mapping source-system to identifier:

```json
{
  "usda-fdc": "11234",
  "wafoct": "TOM-001",
  "supplier-erp": "T-9921"
}
```

External IDs are queryable via `GET /api/v1/food-domain/ingredients?externalId=usda-fdc:11234`. They are not unique within Eks-Food (multiple Eks-Food `Ingredient` rows could map to the same USDA entry if the tenant has multiple ingredient rows for the same source); uniqueness is enforced within a single `source` value.

---

## 5. Lifecycle States

Every entity with a meaningful lifecycle carries a `state` column with a closed enum. The state machine is documented per entity in `DOMAIN_MODEL_REFERENCE.md` §3–§9. Common patterns:

### 5.1 The "onboarding → active → suspended → deactivated" pattern
Used by: `CookProfile`, `Restaurant`, `Supplier`, `Vendor`.

```
   ONBOARDING ──▶ ACTIVE ◀───▶ SUSPENDED
                    │
                    └──▶ DEACTIVATED (terminal)
```

- `ONBOARDING` — the entity is created but not yet ready for production use (e.g. a cook who hasn't completed verification).
- `ACTIVE` — the entity is live and participates in queries, matches, and transactions.
- `SUSPENDED` — the entity is temporarily disabled (policy violation, safety concern, payment failure). Suspended entities are excluded from default queries but remain in the database and the graph.
- `DEACTIVATED` — terminal. The entity is soft-deleted (`deletedAt` is set). Reactivation is possible only via a `RESTORE` operation that creates a new `EntityVersion` and resets `state` to `ACTIVE`.

### 5.2 The "draft → published → deprecated" pattern
Used by: `Recipe`, `Menu`.

```
   DRAFT ──publish──▶ PUBLISHED ──deprecate──▶ DEPRECATED (terminal)
```

### 5.3 The "active → maintenance → decommissioned" pattern
Used by: `Kitchen`.

```
   ACTIVE ◀──▶ MAINTENANCE ──▶ DECOMMISSIONED (terminal)
```

### 5.4 The "scheduled → in_progress → completed" pattern
Used by: `Inspection`.

```
   SCHEDULED ──▶ IN_PROGRESS ──▶ COMPLETED
        │              │
        │              └──▶ CANCELLED
        └──▶ CANCELLED
        └──▶ NO_SHOW (terminal)
```

### 5.5 The "open → investigating → resolved → closed" pattern
Used by: `FoodSafetyIncident`.

```
   OPEN ──▶ INVESTIGATING ──▶ RESOLVED ──▶ CLOSED (terminal)
```

### 5.6 State-transition validation
Every state transition is validated by the entity's domain service before the write. Invalid transitions (e.g. `DEACTIVATED → ACTIVE` without a `RESTORE`) throw a `StateTransitionError` (RFC 7807 `409`, `type: "https://docs.eks-food.com/errors/state-transition"`).

State transitions are audited as a distinct `EntityVersion` row with `operation = 'STATE_TRANSITION'` and `metadata = { from: 'ACTIVE', to: 'SUSPENDED', reason: '...' }`.

---

## 6. Tenant Isolation

### 6.1 The `organizationId` column
Every canonical entity carries `organizationId: UUID?`. The column is non-null for all tenant-scoped entities. The three documented exceptions are:

1. **`Country`** — tenant-shared global reference data.
2. **`Ingredient`** — tenant-shared global reference data (tenants extend via a separate `IngredientTenantExtension` join view).
3. **`Recipe` with `organizationId = null`** — platform-curated global recipes.

### 6.2 Tenant isolation at the repository layer
Every `@eks/food-domain` repository method takes an `organizationId` parameter (or accepts a `TenantContext` injected by the M2 middleware). The repository injects `WHERE organization_id = ?` (or `WHERE organization_id = ? OR organization_id IS NULL` for queries that include global data) into every SQL query. A query that omits the filter is rejected at the repository boundary with a `TenantIsolationError`.

### 6.3 Tenant isolation at the API layer
Every `/api/v1/food-domain/*` route handler runs the M2 `requireTenantContext` middleware, which extracts `organizationId` from the authenticated session and injects it into the request-scoped `TenantContext`. The handler passes the context to every repository call.

### 6.4 Tenant isolation at the graph layer
Every `GraphEngine` query accepts an optional `organizationId` filter. The `PostgresGraphEngine` injects the filter into every SQL query. Cross-tenant traversal is forbidden except via the documented global-node exception (see `GRAPH_ARCHITECTURE.md` §10).

### 6.5 Tenant isolation at the audit layer
Every write logs to the M2 `AuditLog` with `organizationId` set. The audit log is queryable by `organizationId` but never cross-tenant; a tenant admin cannot see another tenant's audit entries.

### 6.6 Cross-tenant references are forbidden
A reference from a tenant-scoped entity to a different tenant's entity is rejected at write time:

- The repository checks `organizationId` of the referenced entity before writing the FK.
- A mismatched reference throws a `CrossTenantViolationError` (RFC 7807 `403`, `type: "https://docs.eks-food.com/errors/cross-tenant-violation"`).
- The only exception is a reference to a global entity (`organizationId IS NULL`), which is always allowed.

---

## 7. Localization

### 7.1 The `LocalizedText` type
Human-readable strings are stored as JSON objects mapping BCP-47 language tags to strings:

```json
{
  "en": "Tomato",
  "sw": "Nyanya",
  "fr": "Tomate"
}
```

The TypeScript type is `LocalizedText = Record<string, string>` (a branded type from `@eks/food-domain/shared/value-objects`). The Prisma column is `Json`.

### 7.2 Required locales
Every `LocalizedText` MUST include at least the tenant's default locale (configured in `TenantConfiguration.defaultLocale`, defaulting to `"en"`). The repository validates this at write time.

### 7.3 Fallback chain
At read time, the API layer applies the tenant's fallback chain (configured in `TenantConfiguration.localeFallbackChain`, defaulting to `["en"]`):

1. Use the requested locale (from the `Accept-Language` header).
2. Fall back to the tenant's default locale.
3. Fall back to `"en"`.
4. If none of the above are present, return the first available locale's string.

### 7.4 Indexing
Localized text is indexed in the search engine via the `SearchIndexWorker`, which extracts every locale's string into a separate index field (`name.en`, `name.sw`, `name.fr`). See `SEARCH_ARCHITECTURE.md`.

### 7.5 Non-localized strings
Strings that are not user-facing (e.g. `InventoryBatch.batchCode`, `Vehicle.registration`, `Certification.certificateNumber`) are stored as plain `String`. The schema lint rule rejects `String` columns with names containing `name`, `title`, `description`, or `bio` — those must be `Json` (LocalizedText).

---

## 8. Extensible Metadata

### 8.1 The `metadata` JSON column
Every canonical entity carries `metadata: Json @default("{}")`. The column is for tenant-specific extensions that do not warrant a schema migration. Examples:

- `CookProfile.metadata = { "preferredPayoutMethod": "momo", "bankAccountLast4": "1234" }`
- `Recipe.metadata = { "sourceUrl": "https://...", "familyTradition": true }`
- `Supplier.metadata = { "erpSystem": "sap-b1", "erpCustomerId": "C-9921" }`

### 8.2 Schema validation
The `metadata` column is validated by a Zod schema. The platform provides a default schema (`z.record(z.unknown())` — permissive) and tenants can register a stricter schema via `TenantConfiguration.foodDomain.metadataSchemas.{entityType}`:

```json
{
  "foodDomain": {
    "metadataSchemas": {
      "CookProfile": {
        "preferredPayoutMethod": { "type": "string", "enum": ["momo", "bank", "cash"] },
        "bankAccountLast4": { "type": "string", "pattern": "^\\d{4}$" }
      }
    }
  }
}
```

Invalid metadata is rejected at write time with a `MetadataValidationError` (RFC 7807 `422`, `type: "https://docs.eks-food.com/errors/metadata-validation"`).

### 8.3 Reserved keys
The platform reserves no keys in `metadata`. Tenants may use any keys that conform to their schema. Future platform features that require new fields are added as Prisma columns, not as `metadata` keys, to avoid breaking tenant schemas.

### 8.4 Searchability
`metadata` keys can be marked as indexed in `TenantConfiguration.foodDomain.searchableMetadataKeys.{entityType}`. Indexed keys are extracted by the `SearchIndexWorker` into dedicated search-index fields (`metadata.preferredPayoutMethod`). Non-indexed keys are not searchable.

---

## 9. Permissions

### 9.1 RBAC
Permissions on canonical entities are enforced by the M2 `@eks/authorization` engine. The closed permission set per entity is:

| Action | Permission code |
|---|---|
| Read | `food-domain.{entity}.read` |
| Create | `food-domain.{entity}.create` |
| Update | `food-domain.{entity}.update` |
| Delete (soft) | `food-domain.{entity}.delete` |
| Restore | `food-domain.{entity}.restore` |
| Read version history | `food-domain.{entity}.read-versions` |
| Restore from version | `food-domain.{entity}.restore-version` |
| Transition state | `food-domain.{entity}.transition-state` |
| Manage metadata schema | `food-domain.{entity}.manage-metadata-schema` |

Example: `food-domain.recipe.read`, `food-domain.kitchen.transition-state`, `food-domain.certification.manage-metadata-schema`.

### 9.2 ABAC
Attribute-based checks are layered on top of RBAC:

- **Ownership check** — a `CookProfile` can be updated only by its owning `User` (the `userId` FK) or by a tenant admin.
- **Kitchen-scope check** — an `InventoryBatch` can be modified only by a `CookProfile` that `works_at` the `Kitchen` that `stocks` the `Inventory`.
- **Certification-scope check** — a `Certification` can be revoked only by an `issuerCountry`-scoped admin or by the issuing authority (via a scoped API token).

ABAC policies are defined in `@eks/food-domain/policies` and evaluated by the M2 `@eks/authorization` engine (see `docs/identity/AUTHORIZATION_POLICIES.md`).

### 9.3 API enforcement
Every `/api/v1/food-domain/*` route handler runs the M2 `requirePermission('food-domain.{entity}.{action}')` middleware. The middleware returns RFC 7807 `403` with `type: "https://docs.eks-food.com/errors/forbidden"` if the caller lacks the permission.

### 9.4 Audit
Every permission check (pass or fail) is logged to the M2 `AuditLog` with `action = 'food-domain.{entity}.authorize'`, `outcome = 'allow' | 'deny'`, and the evaluated policy IDs. Failed checks are alertable via the M1 `@eks/observability` stack.

---

## 10. Timestamps & Time Zones

### 10.1 Storage
All timestamps are stored as UTC `DateTime` (Prisma `DateTime` maps to Postgres `timestamptz`). The Prisma client returns JavaScript `Date` objects; the API layer serializes them as ISO-8601 strings with the `Z` suffix (e.g. `"2024-06-01T12:34:56.000Z"`).

### 10.2 Display
Display time zones are computed at the API layer from the entity's geographic context:
- For `Restaurant` / `Kitchen` / `Supplier` / `Vendor`, the time zone is derived from `Neighborhood → City → Country.timezone` (with optional `City.timezone` override).
- For `CookProfile` / `CustomerProfile`, the time zone is derived from the user's `UserPreference.timezone` (M2).

### 10.3 `validFrom` / `validUntil`
Temporal edges (in `Relationship` and `GraphEdge`) use `validFrom` and `validUntil` for as-of queries. Both are stored as UTC `DateTime`. `validUntil = null` means "open-ended". The `GraphEngine.traverseAsOf` operation filters edges to those where `validFrom <= asOf AND (validUntil IS NULL OR validUntil > asOf)`.

### 10.4 Scheduling
Scheduled events (e.g. `Inspection.scheduledFor`, `Certification.expiresAt`) are stored as UTC. The scheduling worker (M1 `@eks/workers`) evaluates them in UTC and emits events at the scheduled time. Display conversion to local time is the API/UI's responsibility.

---

## 11. Money & Quantities

### 11.1 Money
Money is stored as `Decimal` (Prisma `Decimal` maps to Postgres `numeric(18,4)`) plus a `currency: String` column (ISO 4217). The M1 `@eks/common/money` helper provides `Money` value-object operations (add, subtract, multiply, convert) with proper rounding.

Mixing currencies in a single column is forbidden — a `MenuItem.price` is in `MenuItem.currency`, not in a tenant-default currency. Currency conversion is performed at the API layer using the M4 exchange-rate connector (see `docs/integration/SYNCHRONIZATION_GUIDE.md`).

### 11.2 Quantities
Quantities are stored as `Decimal` (for `InventoryBatch.quantityOnHand`) or `Float` (for `RecipeIngredient.quantity`). The `unit: String` column carries the unit code (`"g"`, `"kg"`, `"ml"`, `"L"`, `"tbsp"`, `"clove"`, `"each"`). Unit conversions are performed by the `@eks/food-domain/units` helper, which uses the UCUM (Unified Code for Units of Measure) vocabulary.

---

## 12. JSON Conventions

### 12.1 Column type
All JSON columns use Prisma `Json`, which maps to Postgres `jsonb`. `jsonb` is preferred over `json` for indexing and query performance.

### 12.2 Validation
All JSON columns are validated by Zod schemas at the repository boundary:
- `metadata` — per-entity schema (§8.2).
- `properties` (on `Relationship` / `GraphEdge`) — per-edge-type schema (`ENTITY_RELATIONSHIPS.md` §11).
- `tags`, `allergens`, `cuisines` — `z.array(z.string())`.
- `nutrition.micronutrients` — `z.record(z.string(), z.number())`.
- `steps` (on `Recipe`) — `z.array(RecipeStepSchema)`.

Invalid JSON is rejected at write time with a `JsonValidationError` (RFC 7807 `422`).

### 12.3 Indexing
Specific JSON keys are indexed via Postgres GIN indexes for query performance:
- `GraphNode.tags` — `CREATE INDEX ... USING GIN (tags jsonb_path_ops)`.
- `Ingredient.allergenFlags` — `CREATE INDEX ... USING GIN (allergen_flags jsonb_path_ops)`.
- `Recipe.cuisine` — indexed as a plain `String` column (extracted from JSON for performance).

### 12.4 Null handling
JSON columns are never null. They default to `"{}"` (object) or `"[]"` (array). The schema lint rule rejects nullable JSON columns.

---

## 13. No Duplicated Concepts

The canonical model is the **single source of truth** for every food-domain concept. Downstream contexts that need derived data project from the canonical model:

| Concept | Canonical entity | Common confusions (avoided) |
|---|---|---|
| A person who cooks | `CookProfile` | Not `User` (M2), not `Cook` (M1; deprecated in favor of `CookProfile`). |
| A person who eats | `CustomerProfile` | Not `User`, not `Customer` (M1; deprecated). |
| A place where food is prepared | `Kitchen` | Not `Restaurant` (a restaurant *operates* kitchens). |
| A food-service business | `Restaurant` | Not `Vendor` (vendors sell goods; restaurants serve meals). |
| A raw food item | `Ingredient` | Not `InventoryBatch` (a batch is a lot of an ingredient in an inventory). |
| A recipe | `Recipe` | Not `MenuItem` (a menu item *derives from* a recipe). |
| A bookable / orderable item | `MenuItem` | Not `Recipe` (recipes are not directly bookable). |
| A supplier of raw ingredients | `Supplier` | Not `Vendor` (vendors sell finished goods). |
| A lot of an ingredient in a kitchen | `InventoryBatch` | Not `Inventory` (an inventory is a container that stocks batches). |
| A piece of kitchen equipment | `Equipment` | Not `Vehicle` (vehicles move; equipment stays). |
| A food-safety credential | `Certification` | Not `Inspection` (certifications are issued; inspections are performed). |
| A food-safety event of concern | `FoodSafetyIncident` | Not `Inspection` (an inspection is planned; an incident is reported). |

The M1 `Cook` and `Customer` tables remain in the schema for backward compatibility but are deprecated; new code must use `CookProfile` and `CustomerProfile`. A migration job (`CookProfileBackfillJob`) copies M1 `Cook` rows into M6 `CookProfile` rows with a `fork_from`-style `metadata.legacyCookId` reference. The M1 `Cook` table is scheduled for removal in M8.

---

## 14. Versioning

### 14.1 Entity versioning
Every write to a canonical entity increments `version` and creates an `EntityVersion` row (see `DOMAIN_MODEL_REFERENCE.md` §10.4). Versions are monotonic per entity; they never reset.

### 14.2 Schema versioning
The Prisma schema is versioned via Prisma migrations (`prisma/migrations/`). Each migration is a SQL file with a timestamped directory name. Migrations are forward-only; rollback is performed by writing a new migration that reverses the change, never by editing the migration history.

### 14.3 API versioning
The `/api/v1/food-domain/*` route prefix is the API contract version. Breaking changes (removed fields, changed semantics, new required fields) require a `/api/v2/food-domain/*` route. The old route is maintained for at least 12 months after the v2 release.

### 14.4 Event versioning
Domain events carry a `v{version}` suffix in their type string. A breaking change to the payload increments the suffix and the old event continues to be published for one minor release to allow consumer migration. See `docs/EVENT_CONVENTIONS.md`.

### 14.5 Package versioning
`@eks/food-domain` follows semver. Breaking changes (removed exports, changed function signatures) increment the major version. The current version is tracked in `src/packages/food-domain/package.json`.

---

## 15. Reserved Columns

The following column names are reserved across every canonical entity and may not be reused for entity-specific purposes:

`id`, `organizationId`, `version`, `createdAt`, `updatedAt`, `deletedAt`, `createdBy`, `updatedBy`, `deletedBy`, `metadata`, `state`, `externalIds`, `metadataSchemaVersion`.

Entities that do not have a `state` column (e.g. `Country`, `Region`, `City`, `Neighborhood`, `NutritionProfile`, `EntityVersion`, `GraphNode`, `GraphEdge`) are exempted from the `state` reservation.

---

## 16. See Also

- `DOMAIN_MODEL_REFERENCE.md` — per-entity field definitions and lifecycle states.
- `ENTITY_RELATIONSHIPS.md` — edge vocabulary and cardinality.
- `GRAPH_ARCHITECTURE.md` — graph storage and traversal.
- `API_DOCUMENTATION.md` — REST contract for canonical entities.
- `docs/CODING_STANDARDS.md` — general code conventions.
- `docs/identity/MULTI_TENANCY.md` — tenant isolation model.
- `docs/identity/AUTHORIZATION_POLICIES.md` — RBAC and ABAC.
- `docs/identity/AUDIT_AND_COMPLIANCE.md` — audit log retention and querying.
- `docs/EVENT_CONVENTIONS.md` — event envelope and versioning.
- `docs/API_CONVENTIONS.md` — REST API conventions.
