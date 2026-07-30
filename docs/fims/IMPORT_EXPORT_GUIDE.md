# Eks-Food Food Intelligence Platform — Import / Export Guide

> **Audience:** Data engineers, catalog managers, supplier-integration teams, platform engineers. Read alongside `CATALOG_ARCHITECTURE.md`, `MEASUREMENT_SYSTEM_GUIDE.md`, `RECIPE_ENGINE_GUIDE.md`, and the M4 `docs/integration/TRANSFORMATION_GUIDE.md`.
>
> **Status:** Milestone 7. This document specifies the `@eks/fims` import/export subsystem: `CatalogImport` and `CatalogExport` Prisma models, supported formats (CSV, Excel, JSON), supplier catalog ingestion, recipe imports, barcode imports, the validation / preview / commit workflow, rollback, and import monitoring.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- One import / export subsystem serves all bulk data flows: supplier catalogs, recipe libraries, barcode lists, inventory counts, nutrition databases.
- Imports are **idempotent**: re-running the same import file produces the same end-state, no duplicates.
- Imports are **previewable**: a dry-run returns the diff (creates, updates, no-ops, errors) before any data is committed.
- Imports are **rollback-able**: every committed import creates a reversible batch. Rollback restores the pre-import state, even for partial failures.
- Imports are **observable**: progress, throughput, error rate, and per-row outcomes are visible in real time.
- Exports are **streaming**: large exports (1 M+ rows) do not load the entire result set into memory.

### 1.2 Non-Goals

- Real-time sync (lives in the M4 `@eks/integration` sync engine — this subsystem is for file-based bulk flows).
- Supplier master data maintenance (lives in the M5 procurement connector; this subsystem ingests supplier-provided CSV/Excel exports).
- Customer PII exports (live in the M2 identity platform).

---

## 2. Data Model

### 2.1 `CatalogImport`

```
model CatalogImport {
  id              String   @id @default(cuid())
  organizationId  String
  importType      String                            // CATALOG|RECIPE|NUTRITION|BARCODE|INVENTORY_COUNT|CATEGORY|ALIAS
  format          String                            // CSV|XLSX|JSON|JSONL
  source          String                            // "supplier:sup_001" | "manual" | "m6-migration" | "system:reindex"
  sourceReference String?                           // e.g. supplier PO number, file URL
  // File
  fileUrl         String                            // signed object-store URL of the uploaded file
  fileSha256      String                            // for dedup + idempotency
  fileSizeBytes   Int
  rowCount        Int?                              // populated after parse
  // Configuration
  options         String   @default("{}")           // JSON: { mode, mapping, defaults, validation }
  // Progress
  status          String   @default("UPLOADED")     // see §3.1
  startedAt       DateTime?
  completedAt     DateTime?
  rowsProcessed   Int      @default(0)
  rowsSucceeded   Int      @default(0)
  rowsFailed      Int      @default(0)
  rowsSkipped     Int      @default(0)
  // Outcome
  createdCount    Int      @default(0)
  updatedCount    Int      @default(0)
  unchangedCount  Int      @default(0)
  // Rollback
  rollbackable    Boolean  @default(true)
  rolledBackAt    DateTime?
  rolledBackBy    String?
  // Audit
  initiatedByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([organizationId, status, createdAt])
  @@index([importType, source])
  @@index([fileSha256])
}
```

### 2.2 `CatalogImportRow`

Per-row outcome, retained for the import's retention window (default 90 days).

```
model CatalogImportRow {
  id              String   @id @default(cuid())
  importId        String                            // FK → CatalogImport
  rowNumber       Int                               // 1-based, source file line
  outcome         String                            // CREATED|UPDATED|UNCHANGED|SKIPPED|ERROR
  entityType      String                            // FoodCatalog|RecipeVersion|NutritionFact|...
  entityId        String?                           // the created/updated entity ID
  error           String?                           // RFC 7807 error code if outcome=ERROR
  errorDetail     String?                           // human-readable
  rawData         String                            // JSON of the parsed row (truncated to 4 KB)
  createdAt       DateTime @default(now())
  @@index([importId, outcome])
  @@index([importId, rowNumber])
}
```

### 2.3 `CatalogExport`

```
model CatalogExport {
  id              String   @id @default(cuid())
  organizationId  String
  exportType      String                            // CATALOG|RECIPE|NUTRITION|INVENTORY|WASTE|MOVEMENTS|AUDIT
  format          String                            // CSV|XLSX|JSON|JSONL
  // Query
  filter          String   @default("{}")           // JSON: filter spec applied
  // Output
  fileUrl         String?                           // set when status=COMPLETED
  fileSha256      String?
  fileSizeBytes   Int?
  rowCount        Int?
  // Progress
  status          String   @default("QUEUED")       // QUEUED|RUNNING|COMPLETED|FAILED|CANCELLED
  startedAt       DateTime?
  completedAt     DateTime?
  rowsExported    Int      @default(0)
  // Audit
  initiatedByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([organizationId, status, createdAt])
  @@index([exportType])
}
```

---

## 3. Import Workflow

### 3.1 Import state machine

```
           upload
        ┌───────────┐
        │           ▼
    ┌──────────┐  parse  ┌─────────┐  preview  ┌──────────┐  commit  ┌──────────┐
    │ UPLOADED │ ───────▶│ PARSED  │ ─────────▶│ PREVIEWED│ ────────▶│ COMMITTED│
    └──────────┘         └─────────┘            └──────────┘          └──────────┘
        │                    │                       │                     │
        │                    │ parse_failed          │ discard             │ rollback
        ▼                    ▼                       ▼                     ▼
    ┌──────────┐        ┌──────────┐            ┌──────────┐          ┌──────────┐
    │ CANCELLED│        │  FAILED  │            │ CANCELLED│          │ROLLED_BACK│
    └──────────┘        └──────────┘            └──────────┘          └──────────┘
```

| Transition | Trigger | Side effects |
|---|---|---|
| `UPLOADED` → `PARSED` | `POST /imports/{id}/parse` | File fetched, parsed, schema-validated. `rowCount` populated. `CatalogImportRow` rows created with `outcome=SKIPPED` (default). |
| `PARSED` → `PREVIEWED` | `POST /imports/{id}/preview` | Dry-run: each row is matched against existing data; outcomes updated to `CREATED`/`UPDATED`/`UNCHANGED`/`ERROR`. No data is written. |
| `PREVIEWED` → `COMMITTED` | `POST /imports/{id}/commit` | All non-ERROR rows are written in a single transaction (or batched if > 1 000 rows). `createdCount`/`updatedCount`/`unchangedCount` populated. |
| `COMMITTED` → `ROLLED_BACK` | `POST /imports/{id}/rollback` | All writes from this import are reversed (deletes created entities, restores previous versions of updated entities). |

### 3.2 Idempotency

Every import is keyed on `fileSha256 + options + organizationId`. If a second import with the same key is committed:

1. The system detects the duplicate at `parse` time.
2. Returns `409 fims.import.duplicate` with the previous import's ID.
3. The caller may either accept the duplicate (the previous import's outcome is reused) or force a re-import with `options.force=true` (which creates a new import row, but the `commit` step is a no-op if all rows resolve to `UNCHANGED`).

### 3.3 Modes

The `options.mode` field controls write behavior:

| Mode | Behavior |
|---|---|
| `UPSERT` (default) | Match by primary identifier (barcode / SKU / supplier article); create if new, update if existing. |
| `CREATE_ONLY` | Skip rows that match an existing entity (outcome = `SKIPPED`). Used for initial loads. |
| `REPLACE` | Delete all existing entities in the import's scope, then create from the file. Used for full catalog refreshes. **Rollback restores the deleted entities.** |
| `VALIDATE_ONLY` | Run validation and preview, but `commit` is refused. Used for data-quality checks. |

---

## 4. Formats

### 4.1 CSV

- Encoding: UTF-8 (with BOM optional; the parser strips it).
- Delimiter: comma by default; configurable via `options.delimiter` (semicolon for European supplier files).
- Header row: required. Column names must match the import template (see `packages/fims/src/import/templates/`).
- Quoting: RFC 4180 (double-quote escaping).
- Row limit: 1 000 000 rows per file. Larger files must be split or use JSONL streaming.

### 4.2 Excel (`.xlsx`)

- Sheet 1 is the data sheet; additional sheets are ignored.
- Header row: row 1.
- Cell types: strings, numbers, booleans, dates (ISO 8601).
- Formulas: evaluated via the `exceljs` library; the resulting value is imported, not the formula.
- Macros: forbidden (file is rejected with `400 fims.import.xlsx.macros_forbidden`).

### 4.3 JSON

- Single JSON array of objects, or a single object with `items` array.
- Each object's keys match the import template's field names.
- Nested objects allowed (e.g. `nameLocalized: { en: "...", tw: "..." }`).
- File size limit: 500 MB. Larger files must use JSONL.

### 4.4 JSONL (JSON Lines)

- One JSON object per line.
- Streaming-friendly: the parser reads line-by-line without loading the full file.
- Recommended for files > 500 MB or > 1 M rows.
- No file size limit beyond object-store quotas.

---

## 5. Import Templates

Each `importType` has a documented template:

### 5.1 `CATALOG` template

| Column | Required | Type | Notes |
|---|---|---|---|
| `code` | yes | string | Internal SKU; must match `FC-<FAMILY>-<SUB>-<SEQ>` or be auto-generated |
| `barcode` | no | string | EAN-13/UPC-A; validated |
| `supplierArticleNo` | no | string | |
| `itemType` | yes | enum | One of the 11 catalog item classes |
| `name` | yes | string | Canonical English name |
| `nameLocalized` | no | JSON | LocalizedText JSON |
| `categoryId` | no | string | Existing `FoodCategory.code` |
| `tags` | no | JSON | Array of strings |
| `defaultSupplierId` | no | string | Existing `Supplier.id` |
| `metadata` | no | JSON | Tenant-validated payload |
| `density` | no | JSON | `{ "value": 0.92, "unit": "g/ml" }` |
| `shelfLifeDays` | no | int | |
| `status` | no | enum | Defaults to `DRAFT` for new, unchanged for existing |

### 5.2 `RECIPE` template

| Column | Required | Type | Notes |
|---|---|---|---|
| `recipeId` | no | string | If absent, a new logical recipe is created |
| `title` | yes | string | |
| `cuisine` | no | string | |
| `baseServings` | yes | int | |
| `prepTimeMin`, `cookTimeMin`, ... | no | int | |
| `ingredients` | yes | JSON | Array of `{ catalogCode, quantity, unit, preparation }` |
| `stages` | no | JSON | Array of `{ name, timeMin, instructions: [...] }` |
| `metadata` | no | JSON | |

Recipe import runs the full publish workflow: cycle detection, nutrition computation, dietary classification. If any check fails, the row is marked `ERROR` with the specific failure code.

### 5.3 `BARCODE` template

A simple two-column format for bulk-associating barcodes with existing catalog items:

| Column | Required | Type |
|---|---|---|
| `code` | yes | string (existing `FoodCatalog.code`) |
| `barcode` | yes | string (EAN-13/UPC-A) |

### 5.4 `NUTRITION` template

| Column | Required | Type |
|---|---|---|
| `catalogCode` | yes | string |
| `source` | yes | enum (USDA/WAFCT/supplier/manual) |
| `sourceId` | no | string |
| `energyKcal` | yes | float |
| `proteinG` | yes | float |
| `carbohydrateG` | yes | float |
| `fatG` | yes | float |
| `fibreG` | no | float |
| `sodiumMg` | no | float |
| ... (all `NutritionFact` fields) | | |

### 5.5 `INVENTORY_COUNT` template

| Column | Required | Type |
|---|---|---|
| `locationCode` | yes | string |
| `catalogCode` | yes | string |
| `batchNumber` | no | string |
| `countedQty` | yes | float |
| `unit` | yes | string |

Triggers an `InventoryAudit` with the count, then creates `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` movements.

---

## 6. Validation

### 6.1 Validation pipeline

Each row passes through these stages (any failure marks the row `ERROR` and skips subsequent stages):

1. **Schema validation**: row matches the import template's Zod schema.
2. **Reference validation**: foreign keys (e.g. `categoryId`, `defaultSupplierId`) exist in the tenant.
3. **Business rule validation**: e.g. `itemType=PACKAGED_PRODUCT` requires `barcode` non-null; `barcodes` pass GS1 check-digit.
4. **Conflict detection**: barcode collisions across tenants; SKU collisions within tenant.
5. **Metadata validation**: tenant Zod schema (see `CATALOG_ARCHITECTURE.md` §9).
6. **Dry-run write**: the entity is constructed in memory and validated by the domain service's `validate()` method (e.g. `RecipeVersion` cycle detection).

### 6.2 Error reporting

Each `CatalogImportRow` with `outcome=ERROR` carries:

- `error`: RFC 7807-style code (e.g. `fims.import.row.barcode.invalid`).
- `errorDetail`: human-readable message including the offending field and value.
- `rawData`: the parsed row (truncated).

The `GET /api/v1/fims/imports/{id}/errors` endpoint returns a paginated list of error rows, plus an aggregate count by error code. A "fix and re-upload" workflow is supported: the caller can download the error rows as a CSV with the error columns appended, fix them offline, and re-upload.

---

## 7. Preview

`POST /api/v1/fims/imports/{id}/preview` runs the dry-run:

1. Each row is matched against existing data by primary identifier.
2. The diff is computed (new fields, changed fields, unchanged fields).
3. `CatalogImportRow.outcome` is updated to `CREATED`/`UPDATED`/`UNCHANGED`/`ERROR`.
4. A summary is returned:

```json
{
  "importId": "imp_8f3a...",
  "rowCount": 1542,
  "outcomes": {
    "CREATED": 412,
    "UPDATED": 891,
    "UNCHANGED": 207,
    "ERROR": 32
  },
  "errorBreakdown": {
    "fims.import.row.barcode.invalid": 18,
    "fims.import.row.categoryId.not_found": 8,
    "fims.import.row.metadata.invalid": 6
  },
  "previewUrl": "https://object-store/fims/imports/imp_8f3a/preview.csv"
}
```

The preview CSV contains one row per source row with three added columns: `_outcome`, `_entityId`, `_error`.

---

## 8. Commit & Rollback

### 8.1 Commit

`POST /api/v1/fims/imports/{id}/commit`:

1. Re-loads all `CatalogImportRow` rows with `outcome IN ('CREATED', 'UPDATED')`.
2. For batches ≤ 1 000 rows: writes in a single Prisma `$transaction`. Atomic — either all succeed or all roll back.
3. For batches > 1 000 rows: writes in batches of 1 000, each in its own transaction. Failures are recorded per-row; the import transitions to `COMMITTED` with `partialFailure=true` if any batch fails.
4. For each created entity, the import stores a `CatalogImportRowWrite` record (FK to `CatalogImportRow`, the entity ID, and a JSON snapshot of the previous state for updates).
5. Emits `fims.import.committed.v1` with the final counts.

### 8.2 Rollback

`POST /api/v1/fims/imports/{id}/rollback`:

1. Verifies `rollbackable=true` (some imports, like `REPLACE` mode after partial failures, may not be rollbackable).
2. Loads all `CatalogImportRowWrite` records in reverse order.
3. For each `CREATED` write: soft-deletes the entity (sets `deletedAt`, `deletedBy="import-rollback:{importId}"`).
4. For each `UPDATED` write: restores the previous-state JSON snapshot.
5. Marks the import as `ROLLED_BACK`.
6. Emits `fims.import.rolled_back.v1`.

Rollback is **not** a hard undo — soft-deleted entities remain in the audit trail. A second rollback of the same import is refused (`409 fims.import.already_rolled_back`).

### 8.3 Rollback window

Imports are rollbackable for 7 days after commit. After 7 days, `rollbackable` is set to `false` by the `ImportRollbackExpiryJob` (M1 cron, daily). This prevents indefinite rollback windows from accumulating snapshots.

---

## 9. Exports

### 9.1 Export workflow

1. `POST /api/v1/fims/exports` with `{ exportType, format, filter }`.
2. The export is queued (status `QUEUED`).
3. The `ExportRunner` worker (M1 `@eks/workers` consumer) picks up the job:
   - Status → `RUNNING`, `startedAt = now()`.
   - Streams matching rows from the DB (cursor-based pagination, 1 000 rows per batch).
   - Writes to a temp file in the configured object store.
   - Status → `COMPLETED`, `fileUrl` populated, `rowCount` and `fileSizeBytes` set.
4. The caller receives a signed URL to download the file (24-hour TTL).

### 9.2 Large exports

Exports > 1 M rows are streamed in JSONL format by default. For CSV/XLSX, the worker writes the file in chunks and concatenates at the end. Memory usage is bounded at ~50 MB regardless of export size.

### 9.3 Filter spec

The `filter` JSON supports:

```json
{
  "itemType": ["INGREDIENT", "SPICE"],
  "categoryId": "clx_cat_001",
  "status": ["ACTIVE"],
  "supplierId": "sup_001",
  "updatedSince": "2025-07-01T00:00:00Z",
  "tags": { "includes": ["kosher"] },
  "limit": 50000
}
```

Filters are validated against a Zod schema per `exportType`. Invalid filters return `422 fims.export.filter.invalid`.

### 9.4 Scheduled exports

Tenants can schedule recurring exports via the M1 `@eks/workers` scheduler:

```http
POST /api/v1/fims/exports/schedules
{
  "exportType": "INVENTORY",
  "format": "CSV",
  "filter": { "locationId": "loc_wh_accra_01" },
  "cronExpression": "0 2 * * *",
  "retentionDays": 30
}
```

The scheduler creates a new `CatalogExport` row at each cron tick. Old export files are deleted by the `ExportRetentionJob` after `retentionDays`.

---

## 10. Supplier Catalog Ingestion

### 10.1 The connector integration

Supplier catalogs are typically delivered as CSV or XLSX files via:

- Email attachment (parsed by the M5 communications connector).
- Supplier portal download (fetched by the M5 procurement connector on a schedule).
- SFTP drop (polled by the M4 `@eks/integration` polling engine).

The connector hands the file off to the FIMS import subsystem by calling `POST /api/v1/fims/imports` with `source="supplier:sup_001"`.

### 10.2 Field mapping

Supplier file column names rarely match the FIMS template. The `options.mapping` field provides a per-supplier column-to-field map:

```json
{
  "mapping": {
    "ArtikelNr": "supplierArticleNo",
    "Bezeichnung": "name",
    "GTIN": "barcode",
    "VK-Preis": "metadata.unitCost",
    "Bestand": "metadata.supplierStockQty"
  }
}
```

Mappings are stored per supplier in the M4 `MappingTemplate` model (see `docs/integration/TRANSFORMATION_GUIDE.md`). The FIMS importer resolves the mapping template by `source` and applies it before validation.

### 10.3 Supplier delta detection

For recurring supplier imports, the importer tracks the previous file's SHA-256 (via `CatalogImport.fileSha256`):

- If the SHA-256 matches the previous import, the import is auto-marked `UNCHANGED` and skipped.
- If the SHA-256 differs, the importer runs a row-level diff (by `supplierArticleNo`) and only commits rows that changed.

This minimizes write load for daily supplier syncs.

---

## 11. API Surface

All routes under `/api/v1/fims/imports/*` and `/api/v1/fims/exports/*`.

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `POST` | `/api/v1/fims/imports` | Upload + create import (multipart or pre-signed URL) | `food.import.create` |
| `GET` | `/api/v1/fims/imports` | List (filter by `status`, `importType`, `source`) | `food.import.read` |
| `GET` | `/api/v1/fims/imports/{id}` | Get one with progress | `food.import.read` |
| `POST` | `/api/v1/fims/imports/{id}/parse` | `UPLOADED` → `PARSED` | `food.import.parse` |
| `POST` | `/api/v1/fims/imports/{id}/preview` | `PARSED` → `PREVIEWED` | `food.import.preview` |
| `GET` | `/api/v1/fims/imports/{id}/rows` | Paginated row outcomes | `food.import.read` |
| `GET` | `/api/v1/fims/imports/{id}/errors` | Error rows only | `food.import.read` |
| `GET` | `/api/v1/fims/imports/{id}/preview-download` | Download preview CSV | `food.import.read` |
| `POST` | `/api/v1/fims/imports/{id}/commit` | `PREVIEWED` → `COMMITTED` | `food.import.commit` |
| `POST` | `/api/v1/fims/imports/{id}/rollback` | `COMMITTED` → `ROLLED_BACK` | `food.import.rollback` |
| `POST` | `/api/v1/fims/imports/{id}/cancel` | Cancel before commit | `food.import.cancel` |
| `POST` | `/api/v1/fims/exports` | Create export | `food.export.create` |
| `GET` | `/api/v1/fims/exports` | List | `food.export.read` |
| `GET` | `/api/v1/fims/exports/{id}` | Get one with progress | `food.export.read` |
| `GET` | `/api/v1/fims/exports/{id}/download` | Download file (signed URL redirect) | `food.export.read` |
| `POST` | `/api/v1/fims/exports/{id}/cancel` | Cancel a queued/running export | `food.export.cancel` |
| `POST` | `/api/v1/fims/exports/schedules` | Create scheduled export | `food.export.schedule` |
| `GET` | `/api/v1/fims/exports/schedules` | List schedules | `food.export.read` |
| `DELETE` | `/api/v1/fims/exports/schedules/{id}` | Delete schedule | `food.export.schedule` |
| `GET` | `/api/v1/fims/import-templates/{importType}` | Download blank template (CSV/XLSX) | `food.import.read` |

### 11.1 Example: upload + parse

```http
POST /api/v1/fims/imports HTTP/1.1
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="file"; filename="supplier-catalog.csv"
Content-Type: text/csv

<file bytes>
--boundary
Content-Disposition: form-data; name="meta"

{ "importType": "CATALOG", "format": "CSV", "source": "supplier:sup_001", "options": { "mode": "UPSERT", "mapping": { ... } } }
--boundary--

HTTP/1.1 201 Created
{ "importId": "imp_8f3a...", "status": "UPLOADED", "fileSizeBytes": 248312 }

POST /api/v1/fims/imports/imp_8f3a.../parse
→ 200 OK { "status": "PARSED", "rowCount": 1542 }
```

### 11.2 Error catalog

| Code | HTTP | Meaning |
|---|---|---|
| `fims.import.duplicate` | 409 | File SHA-256 + options already imported |
| `fims.import.file.too_large` | 413 | File exceeds size limit |
| `fims.import.format.unsupported` | 415 | Format not in {CSV, XLSX, JSON, JSONL} |
| `fims.import.parse.failed` | 422 | File could not be parsed (malformed CSV, invalid JSON) |
| `fims.import.xlsx.macros_forbidden` | 400 | XLSX file contains macros |
| `fims.import.row.barcode.invalid` | 422 | Row-level: barcode failed GS1 check |
| `fims.import.row.categoryId.not_found` | 422 | Row-level: referenced category does not exist |
| `fims.import.row.metadata.invalid` | 422 | Row-level: metadata payload failed tenant schema |
| `fims.import.row.recipe.cycle` | 422 | Row-level: recipe would create a sub-recipe cycle |
| `fims.import.already_rolled_back` | 409 | Rollback attempted on already-rolled-back import |
| `fims.import.not_rollbackable` | 409 | Import past rollback window or mode is non-rollbackable |
| `fims.export.filter.invalid` | 422 | Export filter failed schema validation |

---

## 12. Monitoring

### 12.1 Per-import metrics

Visible at `GET /api/v1/fims/imports/{id}`:

```json
{
  "id": "imp_8f3a...",
  "status": "COMMITTED",
  "progress": {
    "rowsProcessed": 1542,
    "rowsSucceeded": 1510,
    "rowsFailed": 32,
    "rowsSkipped": 0,
    "throughputRowsPerSec": 187.3,
    "etaSeconds": 0
  },
  "outcome": {
    "createdCount": 412,
    "updatedCount": 891,
    "unchangedCount": 207
  },
  "timings": {
    "uploadedAt": "2025-07-30T09:00:00Z",
    "parsedAt": "2025-07-30T09:00:12Z",
    "previewedAt": "2025-07-30T09:00:18Z",
    "committedAt": "2025-07-30T09:01:32Z"
  }
}
```

### 12.2 Aggregate metrics

Emitted to the M1 `@eks/observability` metrics module:

| Metric | Type | Labels |
|---|---|---|
| `fims.import.started` | counter | `importType`, `format`, `source` |
| `fims.import.completed` | counter | `importType`, `outcome` |
| `fims.import.row.outcome` | counter | `importType`, `outcome` |
| `fims.import.duration_ms` | histogram | `importType`, `format` |
| `fims.import.throughput_rows_per_sec` | gauge | `importType` |
| `fims.import.error.rate` | gauge | `importType`, `errorCode` |
| `fims.export.started` | counter | `exportType`, `format` |
| `fims.export.completed` | counter | `exportType`, `outcome` |
| `fims.export.duration_ms` | histogram | `exportType`, `format` |

These feed the `FIMS Imports` and `FIMS Exports` Grafana dashboards (see `OPERATIONAL_RUNBOOKS.md`).

---

## 13. References

- `CATALOG_ARCHITECTURE.md` — `FoodCatalog`, `IngredientVariant`, `IngredientAlias` creation via import.
- `RECIPE_ENGINE_GUIDE.md` — recipe publish workflow invoked during recipe import.
- `NUTRITION_ENGINE_GUIDE.md` — `NutritionFact` import.
- `INVENTORY_GUIDE.md` — `INVENTORY_COUNT` import → `InventoryAudit`.
- `MEASUREMENT_SYSTEM_GUIDE.md` — unit validation in catalog import.
- `OPERATIONAL_RUNBOOKS.md` — import throughput monitoring, error-rate runbook.
- M4 `docs/integration/TRANSFORMATION_GUIDE.md` — `MappingTemplate` for supplier field mapping.
- M4 `docs/integration/SYNCHRONIZATION_GUIDE.md` — when to use sync vs. import.
- M5 `docs/connectors/PROCUREMENT_GUIDE.md` — supplier file ingestion.
- M1 `docs/OPERATIONS_RUNBOOK.md`, `docs/EVENT_CONVENTIONS.md`.
