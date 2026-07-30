# Eks-Food Food Intelligence Platform — Inventory Guide

> **Audience:** Warehouse managers, kitchen operators, procurement, platform engineers. Read alongside `CATALOG_ARCHITECTURE.md`, `BATCH_TRACEABILITY_GUIDE.md`, `MEASUREMENT_SYSTEM_GUIDE.md`, and the M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` (source `Inventory` / `InventoryBatch` models).
>
> **Status:** Milestone 7. This document specifies the `@eks/fims` inventory platform: `InventoryLocation`, `InventoryMovement`, `InventoryReservation`, `InventoryAudit`, and `WasteRecord` Prisma models; storage topology (warehouses, kitchens, storage rooms, refrigerators, freezers, dry storage, mobile inventory); batched quantities, lot numbers, expiration; the movement taxonomy (receiving, transfers, consumption, adjustments, waste, spoilage, returns); reservations; and the audit guarantee that **every movement is auditable**.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- Real-time, per-location, per-batch stock levels with no eventual-consistency lag (reads after a write return the new value within the same transaction).
- Every stock change is a single `InventoryMovement` row — no in-place `UPDATE` of `quantity` columns. The current balance is a derived view: `SUM(movements)`.
- Reservations block consumption without reducing on-hand quantity (so a single stock pool serves sales, production, and transfers).
- Waste, spoilage, and returns are first-class movement types with their own attribution and reporting.
- Mobile inventory (tablets in walk-in coolers, handheld scanners at receiving) is supported via the same API surface as desktop.
- Every movement carries enough metadata (`actorUserId`, `reference`, `correlationId`, `lat`/`lng` for mobile) for forensic audit.

### 1.2 Non-Goals

- Supplier procurement orders (live in the M5 procurement connector).
- Recipe-level production planning (lives in the M8 planning module — the inventory system records production as a `PRODUCTION` movement but does not schedule it).
- Accounting / GL valuation (lives in the M1 `PricingRule` + finance system; the inventory module exposes cost via `IngredientVariant.defaultCost` snapshots per movement).

---

## 2. Storage Topology

### 2.1 `InventoryLocation` (M7 target)

```
model InventoryLocation {
  id              String   @id @default(cuid())
  organizationId  String
  parentId        String?                          // self-reference for hierarchy
  code            String   @unique                 // "WH-ACCRA-01", "KIT-OSU-02-DRY"
  name            String
  nameLocalized   String   @default("{}")
  locationType    String                            // WAREHOUSE|KITCHEN|STORAGE_ROOM|REFRIGERATOR|FREEZER|DRY_STORAGE|MOBILE|DISPLAY
  address         String?
  geoLat          Float?
  geoLng          Float?
  // Storage attributes
  temperatureMinC Float?                            // for cold chain
  temperatureMaxC Float?
  humidityMinPct  Float?
  humidityMaxPct  Float?
  capacityM3      Float?                            // physical capacity in cubic meters
  // Lifecycle
  status          String   @default("ACTIVE")       // ACTIVE|INACTIVE|DECOMMISSIONED
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  parent          InventoryLocation?  @relation("LocationHierarchy", fields: [parentId], references: [id])
  children        InventoryLocation[] @relation("LocationHierarchy")
  stocks          InventoryStock[]
  movements       InventoryMovement[]
  reservations    InventoryReservation[]
  audits          InventoryAudit[]
  wasteRecords    WasteRecord[]
  @@index([organizationId])
  @@index([parentId])
  @@index([locationType, status])
}
```

### 2.2 Location types

| `locationType` | Examples | Cold chain? | Mobile? |
|---|---|---|---|
| `WAREHOUSE` | Central Accra warehouse, Tema distribution center | optional | no |
| `KITCHEN` | Osu cook kitchen prep area | optional | no |
| `STORAGE_ROOM` | Dry goods pantry adjacent to a kitchen | no | no |
| `REFRIGERATOR` | Walk-in cooler 2–4°C | yes (2–4°C) | no |
| `FREEZER` | Walk-in freezer −18°C | yes (≤ −18°C) | no |
| `DRY_STORAGE` | Bulk dry storage at the warehouse | no | no |
| `MOBILE` | Tablet-equipped delivery van, market stall | optional | yes (`geoLat`/`geoLng` tracked) |
| `DISPLAY` | Front-of-house display case | optional | no |

Locations form a hierarchy: a `KITCHEN` typically has children `STORAGE_ROOM`, `REFRIGERATOR`, `FREEZER`. The hierarchy is used for roll-up reporting ("total stock in kitchen K") and for transfer routing (a transfer between two siblings under the same parent is intra-kitchen; between different parents is inter-kitchen).

### 2.3 Cold chain enforcement

When a movement places a batch into a `REFRIGERATOR` or `FREEZER`, the `InventoryMovement` carries `recordedTemperatureC`. If this value falls outside the location's `[temperatureMinC, temperatureMaxC]`, the movement is recorded but flagged in `metadata.coldChainViolation = true` and an `fims.inventory.cold_chain.violation.v1` event is emitted. The batch's shelf life is recalculated per Arrhenius rules if the violation duration exceeds 30 minutes.

---

## 3. Stock & Batches

### 3.1 `InventoryStock` (derived view, materialized)

```
model InventoryStock {
  id              String   @id @default(cuid())
  organizationId  String
  locationId      String                          // FK → InventoryLocation
  catalogId       String                          // FK → FoodCatalog
  variantId       String?                          // FK → IngredientVariant
  batchId         String?                          // FK → InventoryBatch (nullable for unbinned stock)
  // Quantities (all in the canonical unit `unit`)
  onHandQty       Float    @default(0)             // physical count
  reservedQty     Float    @default(0)             // soft-blocked by InventoryReservation
  availableQty    Float    @default(0)             // = onHandQty - reservedQty (derived)
  unit            String                            // FK → MeasurementUnit.code
  // Valuation
  averageCost     String   @default("{}")           // Money JSON, weighted-average per unit
  lastReceivedAt  DateTime?
  lastMovementAt  DateTime?
  @@unique([locationId, catalogId, variantId, batchId])
  @@index([organizationId, catalogId])
  @@index([locationId])
}
```

`InventoryStock` is a materialized view kept in sync by the `InventoryMovement` write path: every insert into `InventoryMovement` triggers an atomic `UPSERT` on `InventoryStock` adjusting `onHandQty`. The `availableQty` is computed via a generated column or trigger.

### 3.2 `InventoryBatch` (extended from M6)

The M6 `InventoryBatch` is extended in M7 with supplier references, lot numbers, and recall state:

```
model InventoryBatch {
  id              String   @id @default(cuid())
  organizationId  String
  batchNumber     String   @unique                 // internal lot number
  supplierBatchNo String?                           // supplier's lot
  catalogId       String                            // FK → FoodCatalog
  variantId       String?                           // FK → IngredientVariant
  supplierId      String?                           // FK → Supplier
  // Quantities
  initialQuantity Float
  currentQuantity Float                             // denormalized for fast queries
  unit            String
  // Dates
  receivedAt      DateTime @default(now())
  productionDate  DateTime?
  expiresAt       DateTime?
  bestBeforeAt    DateTime?                         // often > expiresAt for non-perishables
  // Storage conditions at receipt
  storageConditions String @default("{}")           // JSON
  // Recall
  recallState     String   @default("NOT_RECALLED") // NOT_RECALLED|QUARANTINED|RECALLED|RELEASED
  recallReason    String?
  recalledAt      DateTime?
  recalledBy      String?
  // Lifecycle
  status          String   @default("RECEIVED")     // RECEIVED|IN_USE|DEPLETED|EXPIRED|DISCARDED|QUARANTINED
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([organizationId, catalogId])
  @@index([expiresAt])
  @@index([recallState])
  @@index([supplierId, supplierBatchNo])
}
```

### 3.3 Lot numbering

The internal lot number format is `LOT-<YYMMDD>-<supplierCode>-<seq>`:

- `YYMMDD` — receipt date.
- `supplierCode` — 3-letter supplier code (e.g. `AGR` for AgriSupply Ltd).
- `seq` — zero-padded 4-digit sequence per supplier per day.

Example: `LOT-250730-AGR-0007`. The format is enforced by the `@eks/fims` ID minting service.

---

## 4. Movements

### 4.1 `InventoryMovement`

Every stock change is one row. There is no `UPDATE` on `InventoryStock.onHandQty` outside this insert path.

```
model InventoryMovement {
  id              String   @id @default(cuid())
  organizationId  String
  movementType    String                            // see §4.2
  // Subject
  locationId      String                            // FK → InventoryLocation (target for receiving/transfers-in)
  fromLocationId  String?                           // FK → InventoryLocation (source for transfers-out/consumption)
  catalogId       String                            // FK → FoodCatalog
  variantId       String?                           // FK → IngredientVariant
  batchId         String?                           // FK → InventoryBatch
  // Quantity
  quantity        Float                             // signed: + for inbound, − for outbound
  unit            String                            // FK → MeasurementUnit.code
  // Reference
  referenceType   String?                           // PURCHASE_ORDER|TRANSFER_ORDER|RECIPE_SCALE|WASTE_REPORT|ADJUSTMENT|RETURN
  referenceId     String?                           // external reference ID
  correlationId   String?                           // ties together a multi-leg transfer
  // Cost snapshot
  unitCost        String   @default("{}")            // Money JSON
  // Actor
  actorUserId     String?
  actorName       String?                            // denormalized for audit readability
  // Mobile / device
  deviceId        String?
  geoLat          Float?
  geoLng          Float?
  recordedTemperatureC Float?
  // Notes
  note            String?
  metadata        String   @default("{}")
  // Audit
  occurredAt      DateTime @default(now())          // when the physical event happened
  recordedAt      DateTime @default(now())          // when the system recorded it
  createdAt       DateTime @default(now())
  @@index([organizationId, locationId, occurredAt])
  @@index([catalogId, batchId])
  @@index([movementType, occurredAt])
  @@index([correlationId])
}
```

### 4.2 Movement taxonomy

| `movementType` | Sign | Description | Reference type |
|---|---|---|---|
| `RECEIVING` | + | Goods received from a supplier | `PURCHASE_ORDER` |
| `TRANSFER_IN` | + | Inbound leg of a location-to-location transfer | `TRANSFER_ORDER` |
| `TRANSFER_OUT` | − | Outbound leg of a transfer | `TRANSFER_ORDER` |
| `CONSUMPTION` | − | Used in a recipe production | `RECIPE_SCALE` |
| `PRODUCTION` | + | Output of a recipe (prepared food added to stock) | `RECIPE_SCALE` |
| `ADJUSTMENT_IN` | + | Positive stock count correction | `ADJUSTMENT` |
| `ADJUSTMENT_OUT` | − | Negative stock count correction | `ADJUSTMENT` |
| `WASTE` | − | Deliberate disposal (off-spec, expired) | `WASTE_REPORT` |
| `SPOILAGE` | − | Unplanned loss (theft, spoilage, breakage) | `WASTE_REPORT` |
| `RETURN` | − | Goods returned to supplier | `RETURN` |
| `SAMPLE` | − | Quality sample removed for testing | `ADJUSTMENT` |
| `DAMAGE` | − | Damaged in handling (separate from spoilage for tax) | `WASTE_REPORT` |

### 4.3 Atomicity guarantees

A transfer is a two-movement transaction:

1. `TRANSFER_OUT` at the source (quantity = −Q).
2. `TRANSFER_IN` at the destination (quantity = +Q).

Both rows share the same `correlationId` and are written inside a single Prisma `$transaction`. If either write fails, the entire transaction rolls back — no in-flight stock disappears. The `InventoryTransferService.executeTransfer()` orchestrates this and emits `fims.inventory.transfer.completed.v1` only after both legs commit.

### 4.4 Receiving

`POST /api/v1/fims/inventory/receiving`:

```json
{
  "locationId": "loc_wh_accra_01",
  "supplierId": "sup_001",
  "referenceType": "PURCHASE_ORDER",
  "referenceId": "PO-2025-07-30-0042",
  "lines": [
    {
      "catalogId": "clx...",
      "variantId": "clx_var_5kg",
      "quantity": 50,
      "unit": "kg",
      "supplierBatchNo": "SUP-LOT-77231",
      "productionDate": "2025-07-15",
      "expiresAt": "2026-01-15",
      "unitCost": { "amount": "1.85", "currency": "USD" },
      "recordedTemperatureC": 18.2
    }
  ]
}
```

The endpoint:

1. Validates that the location is `ACTIVE` and is a `WAREHOUSE` or `STORAGE_ROOM` (not a `DISPLAY`).
2. For each line, creates an `InventoryBatch` (or extends an existing one if `supplierBatchNo` matches and dates align).
3. Creates an `InventoryMovement` of type `RECEIVING`.
4. Upserts `InventoryStock` rows at `(locationId, catalogId, variantId, batchId)`.
5. Recomputes `averageCost` via weighted average: `newAvg = (oldQty×oldAvg + receivedQty×unitCost) / (oldQty + receivedQty)`.
6. Emits `fims.inventory.received.v1` and writes an `InventoryAudit` row.

### 4.5 Consumption

When the cook workspace scales a recipe and "fires" a cook ticket, the `RecipeFiringService` creates one `CONSUMPTION` movement per ingredient line and one `PRODUCTION` movement for the output (if the output is storable — e.g. for a "house stock" sub-recipe).

Consumption against a specific batch follows **FEFO** (First-Expired-First-Out) by default. The cook can override to FIFO or to a specific `batchId` via the cook UI. Reservation is required before consumption — see §5.

### 4.6 Adjustments

Stock counts diverge from system records. A count reconciliation creates an `ADJUSTMENT_IN` or `ADJUSTMENT_OUT` movement with `note` explaining the variance. Variances above `metadata.varianceThresholdPct` (default 5%) require a second user's approval (`food.inventory.adjust.approve` permission) before the adjustment commits.

---

## 5. Reservations

### 5.1 `InventoryReservation`

A reservation blocks stock without removing it from `onHandQty`. It increments `InventoryStock.reservedQty` and decrements the derived `availableQty`.

```
model InventoryReservation {
  id              String   @id @default(cuid())
  organizationId  String
  locationId      String                            // FK → InventoryLocation
  catalogId       String                            // FK → FoodCatalog
  variantId       String?                           // FK → IngredientVariant
  batchId         String?                           // FK → InventoryBatch (specific batch, or null for "any FEFO batch")
  quantity        Float
  unit            String
  reservationType String                            // RECIPE_SCALE|TRANSFER|SALES_ORDER|PRODUCTION_ORDER|QUALITY_HOLD
  referenceType   String?
  referenceId     String?
  // Lifecycle
  status          String   @default("HELD")         // HELD|CONSUMED|RELEASED|EXPIRED
  heldAt          DateTime @default(now())
  expiresAt       DateTime                          // auto-release after this time
  consumedAt      DateTime?
  releasedAt      DateTime?
  releasedReason  String?
  // Actor
  heldByUserId    String?
  metadata        String   @default("{}")
  @@index([organizationId, catalogId, status])
  @@index([expiresAt])
  @@index([referenceType, referenceId])
}
```

### 5.2 Reservation lifecycle

```
                    create
                ┌───────────────┐
                │               ▼
            ┌────────┐  consume  ┌──────────┐
            │  HELD  │ ─────────▶│ CONSUMED │
            └────────┘            └──────────┘
                │   ▲
       release  │   │ expire (cron)
                ▼   │
            ┌──────────┐
            │ RELEASED │
            └──────────┘
```

- **Held**: `reservedQty` incremented. Visible to other consumers as unavailable.
- **Consumed**: A `CONSUMPTION` movement with the same `referenceId` was recorded. `reservedQty` decremented, `onHandQty` decremented.
- **Released**: Explicit release by the holder (e.g. cancelled order). `reservedQty` decremented, `onHandQty` unchanged.
- **Expired**: The `InventoryReservationExpiryJob` (M1 cron, runs every 60 seconds) finds `HELD` reservations past `expiresAt` and transitions them to `EXPIRED` (same effect as `RELEASED`).

### 5.3 Default expiry durations

| `reservationType` | Default `expiresAt` |
|---|---|
| `RECIPE_SCALE` | 30 minutes (cook must fire within 30 min of scaling) |
| `TRANSFER` | 4 hours (transfer must be picked up) |
| `SALES_ORDER` | 24 hours |
| `PRODUCTION_ORDER` | 8 hours |
| `QUALITY_HOLD` | 72 hours (until QA releases or condemns) |

---

## 6. Waste

### 6.1 `WasteRecord`

Every `WASTE`, `SPOILAGE`, and `DAMAGE` movement has a linked `WasteRecord`:

```
model WasteRecord {
  id              String   @id @default(cuid())
  organizationId  String
  movementId      String                            // FK → InventoryMovement
  catalogId       String
  batchId         String?
  quantity        Float
  unit            String
  wasteCategory   String                            // EXPIRED|SPOILED|DAMAGED|OFF_SPEC|CONTAMINATED|OVERPRODUCTION|COSMETIC
  wasteReason     String?                           // free-text
  disposalMethod  String                            // COMPOSTED|DONATED|LANDFILL|ANIMAL_FEED|DESTRUCTION|RECYCLED
  costImpact      String   @default("{}")            // Money JSON = quantity × averageCost
  // Optional root cause
  rootCauseCategory String?                         // RECEIVING_DAMAGE|STORAGE_TEMP|HANDLING|MISPLANNING|SUPPLIER_QUALITY
  rootCauseNote   String?
  // Approval (for high-value waste)
  approvedByUserId String?
  approvedAt      DateTime?
  // Photos
  evidenceUrls    String   @default("[]")
  // Audit
  reportedByUserId String?
  reportedAt      DateTime @default(now())
  createdAt       DateTime @default(now())
  @@index([organizationId, wasteCategory, reportedAt])
  @@index([catalogId])
}
```

### 6.2 Waste categories

- `EXPIRED` — Past `expiresAt`, no longer safe.
- `SPOILED` — Microbiological spoilage before `expiresAt`.
- `DAMAGED` — Physical damage (dropped, crushed).
- `OFF_SPEC` — Production output that didn't meet recipe spec (e.g. burnt batch).
- `CONTAMINATED` — Cross-contamination with allergen or foreign body.
- `OVERPRODUCTION` — Cooked more than consumed; disposed at end of service.
- `COSMETIC` — Visually imperfect but safe; often downgraded rather than wasted.

### 6.3 Disposal methods

Each disposal method has different regulatory implications (e.g. `DONATED` requires a food donation receipt in many jurisdictions; `DESTRUCTION` is mandatory for recalled stock). The `WasteRecord.disposalMethod` is validated against the organization's licensed disposal methods.

### 6.4 Cost impact

`costImpact = quantity × InventoryStock.averageCost` at the time of the waste. This is a snapshot — it does not change if `averageCost` later updates. The cost impact feeds the M1 `PricingRule` margin analysis and the M8 waste-reduction dashboard.

---

## 7. Audits

### 7.1 `InventoryAudit`

```
model InventoryAudit {
  id              String   @id @default(cuid())
  organizationId  String
  auditType       String                            // PERIODIC_COUNT|SPOT_CHECK|REGULATORY|RECALL|INVESTIGATION
  locationId      String?                           // FK → InventoryLocation (null for org-wide)
  catalogId       String?                           // FK → FoodCatalog (null for full count)
  batchId         String?                           // FK → InventoryBatch
  // Scope
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  auditorUserId   String
  auditorName     String
  // Result
  expectedQty     Float?
  countedQty      Float?
  varianceQty     Float?
  variancePct     Float?
  // Outcome
  outcome         String                            // MATCH|VARIANCE_ACCEPTED|VARIANCE_INVESTIGATED|DISCREPANCY_REPORTED
  notes           String?
  // Snapshot of movements during audit
  movementsDuringAudit String @default("[]")        // JSON array of InventoryMovement.id
  @@index([organizationId, auditType, startedAt])
  @@index([locationId])
}
```

### 7.2 Audit flow

1. Auditor creates an `InventoryAudit` with `auditType` and scope.
2. The system snapshots all `InventoryStock` rows in scope as `expectedQty`.
3. Auditor counts physical stock, enters `countedQty` per row via the mobile UI.
4. Variance is computed: `varianceQty = countedQty - expectedQty`, `variancePct = varianceQty / expectedQty × 100`.
5. If `|variancePct| > threshold` (default 5%), the audit transitions to `VARIANCE_INVESTIGATED` and an `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` movement is created (pending second-user approval per §4.6).
6. On completion, `outcome` is set and `completedAt` recorded.
7. An `InventoryAudit.completed.v1` event is emitted.

### 7.3 Why every movement is auditable

The append-only `InventoryMovement` table means the entire history of a batch (or location, or catalog item) is reconstructable from a single SQL query:

```sql
SELECT occurredAt, movementType, quantity, unit, locationId, fromLocationId,
       actorUserId, referenceType, referenceId, note
FROM InventoryMovement
WHERE batchId = 'clx_batch_001'
ORDER BY occurredAt;
```

This is the foundation for:

- **Recall traceability** (see `BATCH_TRACEABILITY_GUIDE.md`): forward-trace from a recalled batch to every consumer.
- **Cost roll-back**: if a `RECEIVING` is later found to have used the wrong unit cost, the `ADJUSTMENT_IN` movement corrects it without rewriting history.
- **Variance analysis**: comparing two audits over time, the intervening movements explain the variance.
- **Forensic investigation**: in a food safety incident, the M6 `FoodSafetyIncident` model links to specific `InventoryMovement` rows.

---

## 8. API Surface

All routes under `/api/v1/fims/inventory/*`.

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `POST` | `/api/v1/fims/inventory/locations` | Create location | `food.inventory.location.create` |
| `GET` | `/api/v1/fims/inventory/locations` | List (filter by `locationType`, `status`) | `food.inventory.location.read` |
| `GET` | `/api/v1/fims/inventory/locations/{id}` | Get one | `food.inventory.location.read` |
| `PATCH` | `/api/v1/fims/inventory/locations/{id}` | Update (not temperature bounds — those need decommission + recreate) | `food.inventory.location.update` |
| `POST` | `/api/v1/fims/inventory/locations/{id}/decommission` | Decommission | `food.inventory.location.decommission` |
| `POST` | `/api/v1/fims/inventory/receiving` | Receive goods | `food.inventory.receive` |
| `POST` | `/api/v1/fims/inventory/transfers` | Initiate transfer | `food.inventory.transfer` |
| `GET` | `/api/v1/fims/inventory/transfers/{correlationId}` | Transfer status | `food.inventory.read` |
| `POST` | `/api/v1/fims/inventory/consumptions` | Consume (recipe firing) | `food.inventory.consume` |
| `POST` | `/api/v1/fims/inventory/adjustments` | Adjustment (count correction) | `food.inventory.adjust` |
| `POST` | `/api/v1/fims/inventory/adjustments/{id}/approve` | Approve pending adjustment | `food.inventory.adjust.approve` |
| `POST` | `/api/v1/fims/inventory/waste` | Record waste | `food.inventory.waste.report` |
| `POST` | `/api/v1/fims/inventory/waste/{id}/approve` | Approve high-value waste | `food.inventory.waste.approve` |
| `POST` | `/api/v1/fims/inventory/returns` | Return to supplier | `food.inventory.return` |
| `POST` | `/api/v1/fims/inventory/reservations` | Create reservation | `food.inventory.reserve` |
| `POST` | `/api/v1/fims/inventory/reservations/{id}/release` | Release | `food.inventory.reserve` |
| `GET` | `/api/v1/fims/inventory/stocks` | List stock (filter by `locationId`, `catalogId`, `batchId`) | `food.inventory.read` |
| `GET` | `/api/v1/fims/inventory/stocks/{id}/movements` | Movement history for one stock row | `food.inventory.read` |
| `GET` | `/api/v1/fims/inventory/movements` | List movements (filter by `movementType`, `catalogId`, `batchId`, date range) | `food.inventory.read` |
| `GET` | `/api/v1/fims/inventory/batches/{batchId}/trace` | Forward + backward trace | `food.inventory.read` |
| `POST` | `/api/v1/fims/inventory/audits` | Start audit | `food.inventory.audit.start` |
| `POST` | `/api/v1/fims/inventory/audits/{id}/counts` | Submit count line | `food.inventory.audit.count` |
| `POST` | `/api/v1/fims/inventory/audits/{id}/complete` | Complete audit | `food.inventory.audit.complete` |

### 8.1 Example: transfer

```http
POST /api/v1/fims/inventory/transfers HTTP/1.1
Content-Type: application/json

{
  "fromLocationId": "loc_wh_accra_01",
  "toLocationId": "loc_kit_osu_02_dry",
  "lines": [
    { "catalogId": "clx...", "variantId": "clx_var_5kg", "batchId": "clx_batch_001", "quantity": 10, "unit": "kg" }
  ],
  "referenceType": "TRANSFER_ORDER",
  "referenceId": "TO-2025-07-30-011"
}

HTTP/1.1 201 Created
{ "correlationId": "corr_8f3a...", "status": "COMPLETED", "legCount": 2 }
```

### 8.2 Example: stock query

```http
GET /api/v1/fims/inventory/stocks?locationId=loc_kit_osu_02_dry&catalogId=clx... HTTP/1.1

HTTP/1.1 200 OK
{
  "items": [
    {
      "locationId": "loc_kit_osu_02_dry",
      "catalogId": "clx...",
      "variantId": "clx_var_5kg",
      "batchId": "clx_batch_001",
      "onHandQty": 12.5,
      "reservedQty": 2.0,
      "availableQty": 10.5,
      "unit": "kg",
      "averageCost": { "amount": "1.92", "currency": "USD" },
      "expiresAt": "2026-01-15T00:00:00Z"
    }
  ]
}
```

---

## 9. Mobile Inventory

Mobile workers use the same `/api/v1/fims/inventory/*` routes with `deviceId` and `geoLat`/`geoLng` set on every movement. The mobile UI is optimized for:

- **Barcode-first input**: scanning a `FoodCatalog.barcode` or `InventoryBatch.batchNumber` pre-fills the form.
- **Offline capture**: movements are queued locally and synced when connectivity returns. Each movement carries `occurredAt` (when the physical event happened) distinct from `recordedAt` (when it hit the server) — the audit trail reflects both.
- **Conflict resolution**: if a movement arrives after a count audit has been completed for that stock row, the audit's variance is automatically recomputed and a `POST_AUDIT_VARIANCE` event is emitted for review.

---

## 10. References

- `CATALOG_ARCHITECTURE.md` — `FoodCatalog`, `IngredientVariant`.
- `BATCH_TRACEABILITY_GUIDE.md` — batch forward/backward tracing and recall.
- `MEASUREMENT_SYSTEM_GUIDE.md` — `MeasurementUnit` for `InventoryStock.unit`.
- `RECIPE_ENGINE_GUIDE.md` — `CONSUMPTION` and `PRODUCTION` movements from recipe firings.
- `OPERATIONAL_RUNBOOKS.md` — inventory turnover, waste, audit runbooks.
- M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` — source `Inventory`, `InventoryBatch`.
- M5 `docs/connectors/PROCUREMENT_GUIDE.md` — supplier PO integration with `RECEIVING`.
- M1 `docs/EVENT_CONVENTIONS.md`, `docs/OPERATIONS_RUNBOOK.md`.
