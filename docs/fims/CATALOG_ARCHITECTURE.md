# Eks-Food Food Intelligence Platform — Catalog Architecture

> **Audience:** Platform engineers, data engineers, catalog managers, procurement integrators. Read alongside `RECIPE_ENGINE_GUIDE.md`, `NUTRITION_ENGINE_GUIDE.md`, `MEASUREMENT_SYSTEM_GUIDE.md`, `IMPORT_EXPORT_GUIDE.md`, and the M6 `docs/food-domain/CANONICAL_DATA_STANDARDS.md`.
>
> **Status:** Milestone 7 (Food Catalog, Recipe, Menu, Inventory & Nutritional Intelligence Platform). This document specifies the target schema for the `@eks/fims` package and the `/api/v1/fims/catalog/*` route family. It extends the M6 canonical `Ingredient` model with a richer `FoodCatalog` aggregate that supports prepared foods, beverages, packaged products, meal kits, spices, condiments, additives, and allergens as first-class catalog citizens.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- One canonical catalog entry per physical food item, regardless of source (supplier, internal kitchen, third-party distributor, manufacturer).
- Eleven catalog item classes — `INGREDIENT`, `PREPARED_FOOD`, `BEVERAGE`, `PACKAGED_PRODUCT`, `MEAL_KIT`, `SPICE`, `CONDIMENT`, `ADDITIVE`, `ALLERGEN`, `PACKAGING`, `COMPOUND` — all stored in the same `FoodCatalog` table, discriminated by `itemType`.
- Stable global identifiers (GTIN-14/EAN-13/UPC-A barcodes, internal SKUs, supplier article numbers) coexisting without collision.
- Multilingual display names with a typed `LocalizedText` JSON column and a denormalized `IngredientAlias` table for free-text search.
- Extensibility without schema redesign: new attributes land in `metadata` JSONB validated by per-tenant Zod schemas registered with the M3 `@eks/registry`.
- Lifecycle state machine (`DRAFT` → `ACTIVE` → `DEPRECATED` → `RETired` → `ARCHIVED`) enforced server-side; transitions emit `fims.catalog.*.v1` events.
- Forward-compatibility with the M6 `Ingredient` model: each `FoodCatalog` row may carry a 1:1 back-reference to its legacy `Ingredient.id` for migration.

### 1.2 Non-Goals

- Supplier master data (lives in the M6 `Supplier` model and the M5 `@eks/connectors` procurement connector).
- Recipe authoring (see `RECIPE_ENGINE_GUIDE.md`).
- Inventory quantities and batches (see `INVENTORY_GUIDE.md`).
- Nutritional facts calculation (see `NUTRITION_ENGINE_GUIDE.md`); the catalog only stores the source nutrition payload per 100 g or per serving.
- Pricing (lives in the M1 `PricingRule` model + M5 merchant connector).

---

## 2. Catalog Item Classes

The `FoodCatalog.itemType` discriminator drives validation, default nutrition basis, search indexing, and UI affordances.

| `itemType` | Example | Default nutrition basis | Traceable by batch? | Has barcodes? |
|---|---|---|---|---|
| `INGREDIENT` | Long-grain rice, fresh tomatoes, chicken thigh | per 100 g | yes (supplier batch) | optional |
| `PREPARED_FOOD` | Boiled rice, chopped onions, house-made stock | per 100 g | yes (production batch) | no |
| `BEVERAGE` | Bottled water, palm wine, hibiscus drink | per 100 ml | yes | yes |
| `PACKAGED_PRODUCT` | Tin tomato, sardine can, milk carton | per serving | yes | yes (mandatory) |
| `MEAL_KIT` | Jollof kit for 4, fufu kit for 2 | per kit | yes (production batch) | yes |
| `SPICE` | Dried ginger, ground pepper, bay leaves | per 100 g | yes | optional |
| `CONDIMENT` | Soy sauce, shito paste, maggi cube | per 100 g or per piece | yes | yes |
| `ADDITIVE` | Citric acid, ascorbic acid, preservative E211 | per 100 g | yes | yes |
| `ALLERGEN` | Peanut, shellfish, gluten, egg (cross-reference rows) | n/a | n/a | n/a |
| `PACKAGING` | Take-out box, vacuum pouch, glass jar | n/a | yes | optional |
| `COMPOUND` | Spice blend "shito mix", mirepoix pre-cut | per 100 g | yes | optional |

`ALLERGEN` rows are special catalog entries that exist only so they can be referenced by `FoodCatalog.allergenIds`, `RecipeVersion.allergenIds`, and `NutritionFact.allergenIds`. They have no nutrition facts and never appear in inventory valuation.

---

## 3. Data Model

### 3.1 `FoodCatalog` (M7 target)

```
model FoodCatalog {
  id                 String   @id @default(cuid())
  organizationId     String
  itemType           String   // one of the 11 classes above
  // Stable identifiers — at least one of these must be set
  code               String   @unique            // internal SKU, e.g. FC-RICE-LG-001
  barcode            String?                     // EAN-13 / UPC-A / GTIN-14
  supplierArticleNo  String?                     // supplier's own article code
  // Display
  name               String                       // canonical English name
  nameLocalized      String   @default("{}")      // LocalizedText JSON
  description        String?
  // Taxonomy
  categoryId         String?                      // FK → FoodCategory
  taxonomyPath       String   @default("[]")      // materialized ["food/grain/rice/long-grain"]
  tags               String   @default("[]")      // free-form tags ["gluten-free","kosher"]
  // Media
  images             String   @default("[]")      // JSON array of {url, kind, locale}
  // Supplier linkage
  supplierIds        String   @default("[]")      // JSON array of Supplier.id
  defaultSupplierId  String?
  // Lifecycle
  status             String   @default("DRAFT")    // DRAFT|ACTIVE|DEPRECATED|RETired|ARCHIVED
  publishedAt        DateTime?
  deprecatedAt       DateTime?
  // Versioning
  version            Int      @default(1)
  currentVersionId   String?                      // FK → FoodCatalogVersion (immutable snapshot)
  // Migration
  legacyIngredientId String?                      // M6 Ingredient.id back-ref
  // Standard audit block (see M6 CANONICAL_DATA_STANDARDS §3)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  deletedAt          DateTime?
  createdBy          String?
  updatedBy          String?
  metadata           String   @default("{}")      // tenant-validated JSONB
  // Relations
  category           FoodCategory?  @relation(fields: [categoryId], references: [id])
  variants           IngredientVariant[]
  aliases            IngredientAlias[]
  catalogImports     CatalogImport[]
  catalogExports     CatalogExport[]
  @@index([organizationId])
  @@index([itemType, status])
  @@index([categoryId])
  @@index([barcode])
  @@index([supplierArticleNo])
}
```

### 3.2 `FoodCategory` (taxonomy)

```
model FoodCategory {
  id              String   @id @default(cuid())
  organizationId  String?
  parentId        String?                       // self-reference for hierarchy
  code            String   @unique              // e.g. "food.grain.rice"
  name            String
  nameLocalized   String   @default("{}")
  description     String?
  sortOrder       Int      @default(0)
  // Lifecycle
  status          String   @default("ACTIVE")   // ACTIVE|DEPRECATED
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  parent          FoodCategory?  @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children        FoodCategory[] @relation("CategoryHierarchy")
  items           FoodCatalog[]
  @@index([organizationId])
  @@index([parentId])
}
```

Categories form a directed acyclic graph (enforced server-side: cycle detection on every `create`/`update`). The M7 taxonomy ships with a seed rooted at `food` → `{grain, vegetable, fruit, dairy, meat, poultry, seafood, beverage, spice, condiment, additive, packaging}` and two further levels (~280 leaf categories).

### 3.3 `IngredientVariant`

A catalog item may have multiple purchasing variants: same identity, different pack sizes, brands, or grades.

```
model IngredientVariant {
  id              String   @id @default(cuid())
  catalogId       String                          // FK → FoodCatalog
  organizationId  String
  code            String   @unique               // e.g. FC-RICE-LG-001-5KG
  label           String                          // "5 kg sack"
  packSize        Float                           // numeric pack size in packUnit
  packUnit        String                          // "kg" — must exist in MeasurementUnit
  piecesPerPack   Int?
  // Cost
  defaultCost     String   @default("{}")         // Money JSON {amount, currency}
  // Supplier-specific
  supplierId      String?
  supplierSku     String?
  // Quality / grade
  grade           String?                         // "Grade A", "Premium", "Industrial"
  originCountry   String?                         // ISO-3166 alpha-2
  // Lifecycle
  status          String   @default("ACTIVE")
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  catalog         FoodCatalog @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  @@index([catalogId])
  @@index([supplierId, supplierSku])
}
```

### 3.4 `IngredientAlias`

Free-text alias table powering `LIKE`/trigram autocomplete and the M6 `SearchEngine`. Aliases are scoped per locale and per alias-kind.

```
model IngredientAlias {
  id              String   @id @default(cuid())
  catalogId       String
  alias           String                          // "tomato", "tomate", "nyanya"
  aliasKind       String   @default("COMMON_NAME") // COMMON_NAME|BRAND|SCIENTIFIC|LOCAL|BARCODE
  locale          String   @default("en")
  confidence      Float    @default(1.0)          // 0..1, used by the alias resolver
  isPreferred     Boolean  @default(false)
  source          String?                          // "manual" | "supplier-import" | "gs1-sync"
  createdAt       DateTime @default(now())
  catalog         FoodCatalog @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  @@index([catalogId])
  @@index([alias])           // supports prefix scans
  @@index([alias, locale])   // supports localized autocomplete
}
```

`aliasKind` enum drives the resolver's disambiguation order: `BARCODE` → `SCIENTIFIC` → `COMMON_NAME` → `BRAND` → `LOCAL`.

---

## 4. Identifiers

### 4.1 The four identifier layers

| Layer | Field | Uniqueness | Source | Example |
|---|---|---|---|---|
| Internal SKU | `FoodCatalog.code` | global, system-enforced | `@eks/fims` ID minting | `FC-RICE-LG-001` |
| Variant SKU | `IngredientVariant.code` | global | `@eks/fims` ID minting | `FC-RICE-LG-001-5KG` |
| Barcode | `FoodCatalog.barcode` | global, GS1-issued | supplier / GS1 Data Sync | `5012345678900` |
| Supplier article | `FoodCatalog.supplierArticleNo` | per-supplier | supplier catalogue | `SUP-AGRI-99231` |

The `/api/v1/fims/catalog/resolve` endpoint resolves any of the four identifiers to a single `FoodCatalog` row. Resolution order is barcode → internal SKU → variant SKU → supplier article (with the `supplierId` query param).

### 4.2 Internal SKU format

```
FC-<FAMILY>-<SUB>-<SEQ>
```

- `FAMILY`: 3-letter family code (`RICE`, `TOM`, `OIL`, `CHK`, …) registered in `metadata.familyCode`.
- `SUB`: 2-letter sub-family (`LG` for long grain, `MT` for cherry tomato, …).
- `SEQ`: zero-padded 3-digit sequence per family+sub, allocated atomically by `FoodCatalogSequence` (a counter table per family).

This yields stable, sortable, human-readable SKUs without leaking organization IDs.

### 4.3 Barcode validation

The `@eks/fims` `BarcodeValidator` checks:

- Length 8 (EAN-8), 12 (UPC-A), 13 (EAN-13), or 14 (GTIN-14).
- Modulo-10 check digit.
- GS1 prefix ranges (e.g. `0-1` USA, `30-37` France, `40-44` Germany, `60-69` Ghana & other GS1 MoU signatories, `620` Senegal, `621` Mali).

Invalid barcodes are rejected at the API layer with `400 fims.catalog.barcode.invalid`.

---

## 5. Multilingual Names & Aliases

### 5.1 `LocalizedText` shape

Reuses the M6 `LocalizedText` type (see `docs/food-domain/CANONICAL_DATA_STANDARDS.md` §12):

```typescript
type LocalizedText = {
  en: string;            // required canonical
  tw?: string;           // Twi
  ha?: string;           // Hausa
  ga?: string;           // Ga
  yor?: string;          // Yoruba
  igbo?: string;         // Igbo
  fr?: string;           // French (regional fallback for West Africa)
  ar?: string;           // Arabic (for imported Middle-Eastern spices)
  _fallback?: string[];  // ordered locale fallback chain, default ["en"]
};
```

Stored as JSONB in `FoodCatalog.nameLocalized`. Reads without a locale param return the `en` value. Reads with `?locale=tw` return the Twi value, falling back through `_fallback` to `en`.

### 5.2 Alias ingest pipeline

When a `CatalogImport` (see `IMPORT_EXPORT_GUIDE.md`) ingests a supplier CSV, the importer:

1. Reads each row's `name`, `local_name_*`, `brand`, `scientific_name` columns.
2. Normalizes to lowercase, trims, strips diacritics (NFKD).
3. Inserts one `IngredientAlias` per non-empty field with the appropriate `aliasKind`.
4. Sets `confidence = 0.85` for supplier-imported aliases (so manual `confidence = 1.0` aliases win ties).
5. Emits `fims.catalog.alias.added.v1` for the M6 `SearchIndexWorker` to reindex.

### 5.3 Alias resolution example

```http
GET /api/v1/fims/catalog/resolve?q=nyanya&locale=ga
→ 200 OK
{
  "catalogId": "clx7y...",
  "code": "FC-TOM-CH-001",
  "matchedAlias": { "alias": "nyanya", "locale": "ga", "kind": "LOCAL" },
  "name": { "en": "Tomato", "ga": "Nyanya", "tw": "Tomati" },
  ...
}
```

---

## 6. Categories & Taxonomy

### 6.1 Why a separate `FoodCategory` table (not just JSON tags)

- Categories carry their own lifecycle, localization, and ordering — values that need editing without touching the catalog row.
- The hierarchy supports up to 5 levels deep (`food/grain/rice/long-grain/parboiled`).
- The M6 `GraphEngine` projects each category as a `GraphNode` with `parent_of` edges, enabling traversal queries like "all leaf categories under `food/spice`".

### 6.2 `taxonomyPath` materialization

For performance, every `FoodCatalog` row carries a denormalized `taxonomyPath` array of category codes from root to assigned leaf. The `CatalogTaxonomyWorker` (an M1 `@eks/workers` consumer) keeps this in sync whenever a category is moved or renamed.

### 6.3 Tags vs categories

- **Categories**: curated, hierarchical, governed by `food.category.manage` permission.
- **Tags**: free-form, per-tenant, governed by `food.catalog.update` permission. Examples: `kosher`, `halal`, `gluten-free`, `seasonal-q4`. Tags feed the M6 `SearchEngine` faceted filter.

---

## 7. Images

`FoodCatalog.images` is a JSON array of objects:

```typescript
type CatalogImage = {
  url: string;                  // signed CDN URL or OSS path
  kind: "PRIMARY" | "THUMBNAIL" | "NUTRITION_LABEL" | "INGREDIENT_LIST" | "PACKAGING";
  locale?: string;              // if the image is locale-specific (e.g. local-language label)
  width: number;
  height: number;
  sha256: string;               // for deduplication
  uploadedAt: string;           // ISO 8601
  uploadedBy: string;
};
```

The `@eks/fims` `CatalogImageService`:

- Validates MIME type (only `image/jpeg`, `image/png`, `image/webp`).
- Computes SHA-256 and rejects duplicates within the same `organizationId`.
- Generates a 256×256 thumbnail using the M1 image utilities.
- Uploads originals and thumbnails to the configured object store (S3-compatible; path: `fims/<orgId>/catalog/<catalogId>/<sha256>.<ext>`).

---

## 8. Lifecycle State Machine

```
                  create
            ┌────────────────────┐
            │                    ▼
        ┌───────┐  publish  ┌────────┐  deprecate  ┌────────────┐  retire  ┌──────────┐
        │ DRAFT │ ─────────▶│ ACTIVE │ ───────────▶│ DEPRECATED │ ────────▶│ RETIRED  │
        └───────┘            └────────┘             └────────────┘           └──────────┘
            │                    │ ▲                       │                      │
            │ discard            │ │ republish             │ reactivate           │ archive
            ▼                    │ │ (revert)              ▼                      ▼
        ┌──────────┐         ┌───┴───┴──┐            ┌──────────┐            ┌──────────┐
        │ ARCHIVED │         │ (active) │            │ ARCHIVED │            │ ARCHIVED │
        └──────────┘         └──────────┘            └──────────┘            └──────────┘
```

**Allowed transitions** (enforced by `FoodCatalogStateMachine`):

| From | To | Permission | Event emitted |
|---|---|---|---|
| `DRAFT` | `ACTIVE` | `food.catalog.publish` | `fims.catalog.published.v1` |
| `ACTIVE` | `DEPRECATED` | `food.catalog.deprecate` | `fims.catalog.deprecated.v1` |
| `DEPRECATED` | `ACTIVE` | `food.catalog.republish` | `fims.catalog.republished.v1` |
| `DEPRECATED` | `RETIRED` | `food.catalog.retire` | `fims.catalog.retired.v1` |
| `RETIRED` | `ARCHIVED` | `food.catalog.archive` | `fims.catalog.archived.v1` |
| `DRAFT` | `ARCHIVED` | `food.catalog.discard` | `fims.catalog.discarded.v1` |

Transitions out of `ARCHIVED` are forbidden. To "revive" an archived item, create a new `FoodCatalog` row with `legacyIngredientId` pointing to the original.

**Inventory impact:** `ACTIVE` items may receive stock; `DEPRECATED` items may sell through existing inventory but cannot receive new stock; `RETIRED` and `ARCHIVED` items cannot receive stock or be ordered against existing stock.

---

## 9. Extensibility Without Schema Redesign

### 9.1 The `metadata` JSONB column

Every `FoodCatalog` row carries a `metadata` JSONB column. Per-tenant schemas are registered with the M3 `@eks/registry`:

```typescript
// packages/fims/src/catalog/metadata-schema.ts
export const CoffeeMetadataSchema = z.object({
  roastLevel: z.enum(["light", "medium", "dark"]),
  altitudeMasl: z.number().int().min(0).max(6000).optional(),
  process: z.enum(["washed", "natural", "honey", "wet-hulled"]),
  cupScore: z.number().min(0).max(100).optional(),
});
```

The `FoodCatalog.metadata` write path:

1. Looks up the registered schema by `(organizationId, itemType, categoryCode)` tuple.
2. Validates the payload.
3. On success, writes the JSONB; on failure, returns `422 fims.catalog.metadata.invalid` with the Zod issue path.

### 9.2 When to add a column vs use `metadata`

| Situation | Approach |
|---|---|
| The attribute is queried in 80%+ of catalog reads, has a fixed primitive type, and needs a database index | Add a column (requires schema migration) |
| The attribute is tenant-specific, queried only via JSONB operators, or has variable shape | Use `metadata` |
| The attribute is universal but rarely queried | Use a typed JSON column (e.g. `nutrition` on `Ingredient`) |

### 9.3 Forward compatibility

Older clients that do not know about a new `metadata` field continue to work — the field is simply ignored on read and rejected on write if the schema validator disallows extra keys. Schemas are versioned (`SchemaVersion` from M4) and old versions remain queryable for the retention window.

---

## 10. API Surface

All routes under `/api/v1/fims/catalog/*`. Standard envelope: see M1 `docs/API_CONVENTIONS.md`. Pagination defaults to `limit=50, cursor=<opaque>`.

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `POST` | `/api/v1/fims/catalog` | Create catalog item | `food.catalog.create` |
| `GET` | `/api/v1/fims/catalog` | List (filter by `itemType`, `categoryId`, `status`, `supplierId`, `barcode`) | `food.catalog.read` |
| `GET` | `/api/v1/fims/catalog/{id}` | Get one | `food.catalog.read` |
| `PATCH` | `/api/v1/fims/catalog/{id}` | Update mutable fields | `food.catalog.update` |
| `DELETE` | `/api/v1/fims/catalog/{id}` | Soft-delete (sets `deletedAt`) | `food.catalog.delete` |
| `POST` | `/api/v1/fims/catalog/{id}/publish` | `DRAFT` → `ACTIVE` | `food.catalog.publish` |
| `POST` | `/api/v1/fims/catalog/{id}/deprecate` | `ACTIVE` → `DEPRECATED` | `food.catalog.deprecate` |
| `POST` | `/api/v1/fims/catalog/{id}/republish` | `DEPRECATED` → `ACTIVE` | `food.catalog.republish` |
| `POST` | `/api/v1/fims/catalog/{id}/retire` | `DEPRECATED` → `RETIRED` | `food.catalog.retire` |
| `POST` | `/api/v1/fims/catalog/{id}/archive` | `RETIRED` → `ARCHIVED` | `food.catalog.archive` |
| `GET` | `/api/v1/fims/catalog/{id}/versions` | Version history (M6 `EntityVersion`) | `food.catalog.read` |
| `POST` | `/api/v1/fims/catalog/{id}/variants` | Add `IngredientVariant` | `food.catalog.variant.create` |
| `GET` | `/api/v1/fims/catalog/{id}/variants` | List variants | `food.catalog.read` |
| `POST` | `/api/v1/fims/catalog/{id}/aliases` | Add `IngredientAlias` | `food.catalog.alias.create` |
| `GET` | `/api/v1/fims/catalog/resolve` | Resolve by barcode / SKU / supplier article | `food.catalog.read` |
| `GET` | `/api/v1/fims/catalog/search` | Full-text search (delegates to M6 `SearchEngine`) | `food.catalog.read` |
| `GET` | `/api/v1/fims/categories` | List / tree of categories | `food.category.read` |
| `POST` | `/api/v1/fims/categories` | Create category | `food.category.create` |
| `PATCH` | `/api/v1/fims/categories/{id}` | Update category | `food.category.update` |
| `POST` | `/api/v1/fims/categories/{id}/move` | Move category (re-parent) | `food.category.move` |

### 10.1 Example: create

```http
POST /api/v1/fims/catalog HTTP/1.1
Content-Type: application/json
Authorization: Bearer <token>
Idempotency-Key: 7e2a1c...

{
  "itemType": "INGREDIENT",
  "code": "FC-RICE-LG-001",
  "barcode": "5012345678900",
  "name": "Long-Grain Rice",
  "nameLocalized": { "en": "Long-Grain Rice", "tw": "Mmoa Kyɛ Long", "fr": "Riz Long Grain" },
  "categoryId": "clx7y...",
  "supplierArticleNo": "SUP-AGRI-99231",
  "defaultSupplierId": "sup_001",
  "metadata": { "originCountry": "GH" }
}

HTTP/1.1 201 Created
{
  "id": "clx8a1...",
  "status": "DRAFT",
  "version": 1,
  "createdAt": "2025-07-30T09:12:00Z"
}
```

### 10.2 Example: resolve

```http
GET /api/v1/fims/catalog/resolve?barcode=5012345678900 HTTP/1.1

HTTP/1.1 200 OK
{
  "catalogId": "clx8a1...",
  "code": "FC-RICE-LG-001",
  "resolvedBy": "barcode",
  "itemType": "INGREDIENT",
  "name": { "en": "Long-Grain Rice", ... },
  "status": "ACTIVE"
}
```

### 10.3 Error catalog

| Code | HTTP | Meaning |
|---|---|---|
| `fims.catalog.barcode.invalid` | 400 | Barcode failed GS1 check-digit / length validation |
| `fims.catalog.code.duplicate` | 409 | Internal SKU already exists |
| `fims.catalog.category.cycle` | 422 | Category move would create a cycle |
| `fims.catalog.metadata.invalid` | 422 | Metadata payload failed tenant schema validation |
| `fims.catalog.transition.invalid` | 409 | Requested lifecycle transition not allowed from current state |
| `fims.catalog.variant.unit.unknown` | 422 | `packUnit` not in `MeasurementUnit` table |
| `fims.catalog.not_found` | 404 | Catalog item not found in this tenant |

---

## 11. Migration from M6 `Ingredient`

The M7 rollout migrates the existing M6 `Ingredient` rows into `FoodCatalog`:

1. For each `Ingredient` row, create a `FoodCatalog` with `itemType=INGREDIENT`, `legacyIngredientId=Ingredient.id`, `code` derived from `Ingredient.code`, `name`/`nameLocalized` copied verbatim.
2. Migrate `Ingredient.categories` JSON array → set `categoryId` to the first matching `FoodCategory.code`; remaining categories become tags.
3. Migrate `Ingredient.nutrition` JSON → a `NutritionFact` row (see `NUTRITION_ENGINE_GUIDE.md`).
4. Migrate `Ingredient.allergens` JSON → join rows on `FoodCatalog` ↔ `Allergen`.
5. Mark the original `Ingredient.status=ACTIVE` row as `DEPRECATED` with `note="migrated to FoodCatalog"`. Read APIs on `/api/v1/food-domain/ingredients/*` continue to work via a view that reads through to `FoodCatalog`.

The migration is idempotent and tracked in `CatalogImport` rows with `sourceSystem="m6-migration"`.

---

## 12. Security & Tenant Isolation

- Every query is scoped by `organizationId` extracted from the M2 session token (see `docs/identity/MULTI_TENANCY.md`). Cross-tenant reads return 404, not 403, to avoid leaking existence.
- Barcodes are global (GS1-issued), so barcode uniqueness is enforced across tenants — but resolution still scopes the response to the caller's `organizationId`. A barcode that matches in another tenant returns `404 fims.catalog.not_found`.
- `metadata` write access requires the `food.catalog.metadata.write` permission in addition to `food.catalog.update`.
- Soft delete (`deletedAt`) is preserved indefinitely for audit; hard delete is reserved for the GDPR purge job (see `OPERATIONAL_RUNBOOKS.md` §10).

---

## 13. Observability

| Metric | Type | Source |
|---|---|---|
| `fims.catalog.items` | counter (per `itemType`, `status`) | `SELECT itemType, status, COUNT(*) FROM FoodCatalog GROUP BY 1,2` |
| `fims.catalog.create.latency_ms` | histogram | API middleware |
| `fims.catalog.resolve.latency_ms` | histogram | API middleware |
| `fims.catalog.search.latency_ms` | histogram | SearchEngine |
| `fims.catalog.alias.count` | gauge | `SELECT COUNT(*) FROM IngredientAlias` |
| `fims.catalog.transition.count` | counter (per transition) | FoodCatalogStateMachine |

All metrics are emitted through the M1 `@eks/observability` metrics module and visible on the `FIMS Catalog` Grafana dashboard.

---

## 14. References

- M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` — `Ingredient`, `Recipe`, `Menu`, `Inventory`, `NutritionProfile` source models.
- M6 `docs/food-domain/CANONICAL_DATA_STANDARDS.md` — `LocalizedText`, audit metadata, lifecycle patterns.
- `RECIPE_ENGINE_GUIDE.md` — how `FoodCatalog` rows are referenced from `RecipeVersion` ingredient lines.
- `NUTRITION_ENGINE_GUIDE.md` — `NutritionFact` rows attached to `FoodCatalog`.
- `MEASUREMENT_SYSTEM_GUIDE.md` — `MeasurementUnit` validation for `IngredientVariant.packUnit`.
- `IMPORT_EXPORT_GUIDE.md` — `CatalogImport` / `CatalogExport` flows that bulk-create catalog rows.
- M1 `docs/API_CONVENTIONS.md`, `docs/EVENT_CONVENTIONS.md`, `docs/OPERATIONS_RUNBOOK.md`.
- M2 `docs/identity/MULTI_TENANCY.md`, `docs/identity/AUTHORIZATION_POLICIES.md`.
- M3 `docs/developer/EXTENSION_AUTHORING.md` for `metadata` schema registration.
