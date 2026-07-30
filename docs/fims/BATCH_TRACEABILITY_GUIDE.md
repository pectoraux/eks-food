# Eks-Food Food Intelligence Platform — Batch Traceability Guide

> **Audience:** Food safety officers, QA leads, supply-chain managers, compliance auditors, platform engineers. Read alongside `INVENTORY_GUIDE.md`, `CATALOG_ARCHITECTURE.md`, and the M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` (`FoodSafetyIncident` model).
>
> **Status:** Milestone 7. This document specifies the `@eks/fims` batch traceability subsystem: production batches, supplier batches, lot numbers, expiration, the `InventoryBatch.recallState` lifecycle, complete traceability from receipt to consumption, and the recall workflow that ties into the M6 `FoodSafetyIncident` model.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- Every gram of food in the system can be traced back to the supplier batch it came from and forward to every consumer that ate it.
- Trace queries complete in under 5 seconds for batches with up to 100 000 descendant movements.
- Recall workflow is one-click from a `FoodSafetyIncident` ticket to all affected stock being quarantined.
- Expiration is enforced: expired stock cannot be consumed by a recipe; it must be wasted or returned.
- Recall events emit domain events so downstream systems (point-of-sale, marketplace listings) can react within seconds.

### 1.2 Non-Goals

- Predictive shelf-life modeling (lives in M8 roadmap — currently we use the supplier-declared `expiresAt` plus optional Arrhenius adjustments for cold-chain violations).
- Customer-level consumer tracing (POS-level customer identification is out of scope for the inventory subsystem; we trace to the `SALES_ORDER` reference ID).

---

## 2. Batch Categories

A batch is a quantity of a single `FoodCatalog` item that shares a common origin (supplier lot or production run). Two batch categories:

| Category | Created by | Source of `expiresAt` | Example |
|---|---|---|---|
| **Supplier batch** | `POST /api/v1/fims/inventory/receiving` | Supplier declaration + Arrhenius adjustment | 50 kg of rice from AgriSupply, lot `SUP-LOT-77231` |
| **Production batch** | `RecipeFiringService` (cook workspace "fire" action) | Computed: `min(earliest ingredient expiresAt + recipe.extensionDays, productionDate + recipe.shelfLifeDays)` | A batch of house-made jollof base, lot `PROD-250730-0023` |

Both share the `InventoryBatch` table (see `INVENTORY_GUIDE.md` §3.2). The discriminator is `metadata.batchOrigin` (`SUPPLIER` or `PRODUCTION`).

---

## 3. Lot Numbering

### 3.1 Supplier batch lot format

`LOT-<YYMMDD>-<supplierCode>-<seq>` — see `INVENTORY_GUIDE.md` §3.3. Example: `LOT-250730-AGR-0007`.

### 3.2 Production batch lot format

`PROD-<YYMMDD>-<kitchenCode>-<seq>`:

- `YYMMDD` — production (fire) date.
- `kitchenCode` — 3-letter kitchen code (`OSU`, `CAN` for Cantonments).
- `seq` — zero-padded 4-digit sequence per kitchen per day.

Example: `PROD-250730-OSU-0023`.

### 3.3 Cross-reference integrity

The `InventoryBatch.supplierBatchNo` (for supplier batches) and `InventoryBatch.metadata.productionRecipeVersionId` (for production batches) preserve the link to the source-of-truth record outside the lot number itself. This means a lot number remains human-readable while the system resolves full context via the FK columns.

---

## 4. Expiration & Shelf Life

### 4.1 The four date fields

| Field | Meaning | Source |
|---|---|---|
| `productionDate` | When the batch was produced ( supplier-side for supplier batches, fire-time for production batches) | Supplier or `RecipeFiringService` |
| `receivedAt` | When the batch was received into an Eks-Food location | `RECEIVING` movement |
| `bestBeforeAt` | Quality date — past this, the product is safe but quality degrades | Supplier declaration |
| `expiresAt` | Safety date — past this, the product must not be consumed | Supplier declaration or computed for production batches |

### 4.2 Production batch expiration computation

For a production batch fired from recipe version `V`:

```
expiresAt = min(
  earliestIngredientExpiresAt + V.metadata.extensionDays,  // usually 0
  productionDate + V.metadata.shelfLifeDays
)
```

`V.metadata.shelfLifeDays` defaults to 3 for cooked foods, 1 for raw preparations, 7 for baked goods. It is set by the recipe author and validated by the nutrition engine at publish time (must be ≥ 1).

### 4.3 Arrhenius cold-chain adjustment

If a batch experiences a cold-chain violation (see `INVENTORY_GUIDE.md` §2.3), the `ColdChainAdjustmentJob` recomputes `expiresAt`:

- For violations under 30 minutes: no adjustment.
- For violations 30 minutes to 2 hours: `expiresAt` shortened by 25%.
- For violations over 2 hours: `expiresAt` set to `now()` (immediate disposal required) and an `fims.inventory.batch.condemned.v1` event emitted.

The original `expiresAt` is preserved in `metadata.originalExpiresAt` for audit.

### 4.4 Expiration enforcement

The `InventoryReservationService.reserve()` method refuses to reserve stock from a batch whose `expiresAt < now() + reservation.leadTimeMin`:

- `RECIPE_SCALE` reservations: lead time 30 min.
- `SALES_ORDER` reservations: lead time 24 h.
- `TRANSFER` reservations: lead time 4 h.

The `ExpirationScannerJob` (M1 cron, hourly) finds batches where `expiresAt < now()` and `status IN ('RECEIVED', 'IN_USE')` and transitions them to `EXPIRED`. A `WASTE` movement must be recorded within 24 h or an `fims.inventory.expired.not_wasted.v1` alert fires.

---

## 5. Movement History & Trace Queries

### 5.1 Backward trace (consumer → source)

Given a consumption event (e.g. a customer became ill after eating a dish served from `SALES_ORDER-2025-07-30-9912`), the backward trace walks the `InventoryMovement` graph from consumption back to receipt:

```typescript
async function backwardTrace(salesOrderId: string): Promise<TraceResult> {
  // 1. Find the consumption movement referencing the sales order
  const consumption = await prisma.inventoryMovement.findFirst({
    where: { referenceType: 'SALES_ORDER', referenceId: salesOrderId, movementType: 'CONSUMPTION' },
  });
  // 2. Walk back through PRODUCTION movements (recipe firings) → their CONSUMPTION movements → RECEIVING
  // 3. Collect every InventoryBatch touched, every supplier, every location
  return buildTraceResult(consumption);
}
```

The result is a tree:

```
SALES_ORDER-2025-07-30-9912 (customer dish)
└─ CONSUMPTION 2025-07-30 19:42 (loc_kit_osu_02)
   └─ Recipe "Jollof Rice" v3 fired as PROD-250730-OSU-0023
      ├─ CONSUMPTION 1.5 kg rice from LOT-250728-AGR-0012 (received from AgriSupply)
      ├─ CONSUMPTION 0.8 kg tomato from LOT-250729-AGR-0008
      └─ CONSUMPTION 0.3 L palm oil from LOT-250715-PAM-0021
```

### 5.2 Forward trace (source → consumers)

Given a recalled supplier batch `LOT-250728-AGR-0012`, the forward trace finds every consumer:

```http
GET /api/v1/fims/inventory/batches/clx_batch_001/trace?direction=forward HTTP/1.1
```

```json
{
  "batchId": "clx_batch_001",
  "lotNumber": "LOT-250728-AGR-0012",
  "catalog": { "code": "FC-RICE-LG-001", "name": "Long-Grain Rice" },
  "receivedAt": "2025-07-28T08:00:00Z",
  "supplier": { "id": "sup_001", "name": "AgriSupply Ltd" },
  "descendants": [
    {
      "movementType": "CONSUMPTION",
      "occurredAt": "2025-07-30T15:30:00Z",
      "location": "loc_kit_osu_02",
      "reference": { "type": "RECIPE_SCALE", "id": "rs_8821" },
      "productionBatch": {
        "lotNumber": "PROD-250730-OSU-0023",
        "recipe": "Jollof Rice v3"
      },
      "furtherDescendants": [
        {
          "movementType": "CONSUMPTION",
          "occurredAt": "2025-07-30T19:42:00Z",
          "reference": { "type": "SALES_ORDER", "id": "SALES_ORDER-2025-07-30-9912" }
        },
        {
          "movementType": "CONSUMPTION",
          "occurredAt": "2025-07-30T20:15:00Z",
          "reference": { "type": "SALES_ORDER", "id": "SALES_ORDER-2025-07-30-9947" }
        }
      ]
    },
    {
      "movementType": "TRANSFER_OUT",
      "occurredAt": "2025-07-29T10:00:00Z",
      "toLocation": "loc_kit_can_03",
      "furtherDescendants": [ ... ]
    }
  ],
  "remainingStock": {
    "onHandQty": 8.2,
    "unit": "kg",
    "locations": ["loc_wh_accra_01 (5.0 kg)", "loc_kit_can_03 (3.2 kg)"]
  }
}
```

### 5.3 Performance

The trace query is implemented as a recursive CTE on `InventoryMovement` joined to `InventoryBatch`. Key indexes:

- `InventoryMovement(catalogId, batchId, occurredAt)` — backward trace entry point.
- `InventoryMovement(referenceType, referenceId)` — link from `RECIPE_SCALE` to `PRODUCTION` to `SALES_ORDER`.
- `InventoryBatch(supplierId, supplierBatchNo)` — supplier-batch lookup.

For batches with > 100 000 descendant movements, the trace is paginated (depth-first, 500 nodes per page) and the caller can request `?summarize=true` to receive only counts per location/recipe rather than the full tree.

---

## 6. Recall Workflow

### 6.1 Triggering a recall

A recall is triggered from one of three sources:

1. **Supplier-initiated**: The M5 procurement connector receives a recall notice from the supplier. The connector calls `POST /api/v1/fims/inventory/recalls` with the supplier batch number(s).
2. **Internal QA**: A QA lead identifies an issue (e.g. foreign body found in a sample) and triggers via the QA console.
3. **Regulatory**: A government food safety authority (via the M5 government connector) issues a mandatory recall.

### 6.2 Recall state machine

```
                 trigger
             ┌──────────────┐
             │              ▼
        ┌──────────────┐  quarantine  ┌──────────────┐  release (false alarm)  ┌─────────┐
        │ NOT_RECALLED │ ────────────▶│ QUARANTINED  │ ───────────────────────▶│ RELEASED│
        └──────────────┘               └──────────────┘                          └─────────┘
                                            │
                                            │ confirm recall
                                            ▼
                                       ┌──────────┐  destroy  ┌──────────┐
                                       │ RECALLED │ ─────────▶│ DESTROYED│
                                       └──────────┘            └──────────┘
```

| From | To | Permission | Side effects |
|---|---|---|---|
| `NOT_RECALLED` | `QUARANTINED` | `food.batch.recall.quarantine` | All `InventoryStock` rows for the batch have `reservedQty` set to `onHandQty` (full hold). All open `InventoryReservation`s with `status=HELD` against this batch transition to `RELEASED` with `releasedReason="BATCH_QUARANTINED"`. |
| `QUARANTINED` | `RECALLED` | `food.batch.recall.confirm` | Recall is officially logged. Forward trace is generated and stored. |
| `QUARANTINED` | `RELEASED` | `food.batch.recall.release` | Stock returns to normal availability. A `BatchReleased.v1` event is emitted; the original incident ticket is closed as false alarm. |
| `RECALLED` | `DESTROYED` | `food.batch.recall.destroy` | All stock is wasted via `WASTE` movements with `disposalMethod=DESTRUCTION`. Destruction evidence photos uploaded. |

### 6.3 The `RecallService`

Located at `packages/fims/src/inventory/recall.ts`:

```typescript
export class RecallService {
  constructor(
    private readonly batchRepo: BatchRepository,
    private readonly stockRepo: StockRepository,
    private readonly movementRepo: MovementRepository,
    private readonly incidentRepo: FoodSafetyIncidentRepository,
    private readonly eventBus: EventBus,
  ) {}

  async initiateRecall(input: {
    batchId?: string;
    supplierBatchNo?: string;
    reason: string;
    sourceType: 'SUPPLIER' | 'INTERNAL_QA' | 'REGULATORY';
    sourceReferenceId: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }): Promise<RecallRecord>;

  async generateForwardTrace(recallId: string): Promise<TraceResult>;

  async confirmRecall(recallId: string, confirmedBy: string): Promise<void>;

  async destroyQuarantinedStock(recallId: string, evidenceUrls: string[]): Promise<void>;
}
```

### 6.4 Side effects across the platform

When a batch transitions to `QUARANTINED`:

1. All `InventoryStock` rows for the batch become unavailable (`availableQty = 0`).
2. The M6 `SearchEngine` is notified — catalog items that relied solely on this batch show "out of stock" on the marketplace.
3. Active `MenuItem`s that depend on recipes containing the recalled catalog item are flagged for review (the M1 `WorkflowEngine` creates a review task).
4. Active bookings (`Booking` model from M1) that include the affected menu items generate customer notification drafts (sent only after operator approval).
5. The M6 `FoodSafetyIncident` model is updated with a link to the `RecallRecord`.

When a batch transitions to `RECALLED`:

1. A forward trace is generated and stored as an immutable artifact (for regulatory submission).
2. The `RecallNotificationsJob` (M1 cron, immediate trigger) sends notifications to:
   - All locations that received the batch.
   - All kitchen leads whose recipes consumed the batch.
   - The M2 `@eks/notifications` customer-communications channel (for customer-facing notices, pending operator approval).

### 6.5 Destruction evidence

Destruction of recalled stock is regulated. The `RecallService.destroyQuarantinedStock()` requires:

- At least 2 evidence photos (`evidenceUrls.length >= 2`).
- A destruction witness (`metadata.witnessUserId`).
- The destruction location (`metadata.destructionLocationId`), which must be a licensed destruction facility or a witnessed on-site destruction.

A `WASTE` movement is created for each affected `InventoryStock` row, with:

- `wasteCategory = CONTAMINATED` or `OFF_SPEC` (recall-specific).
- `disposalMethod = DESTRUCTION`.
- `referenceType = RECALL`, `referenceId = recallId`.
- `metadata.destructionWitness = witnessUserId`.

---

## 7. Linking to `FoodSafetyIncident`

The M6 `FoodSafetyIncident` model (see `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` §9.3) is the source-of-truth for incident tracking. A recall creates or links to a `FoodSafetyIncident`:

```typescript
type FoodSafetyIncident = {
  id: string;
  incidentType: 'BACTERIAL_CONTAMINATION' | 'FOREIGN_BODY' | 'ALLERGEN_UNDECLARED' | 'CHEMICAL_CONTAMINATION' | 'PACKAGING_DEFECT' | 'TEMPERATURE_ABUSE' | 'OTHER';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'INVESTIGATING' | 'CONTAINED' | 'RESOLVED' | 'CLOSED';
  reportedAt: ISODateString;
  reportedBy: string;
  affectedBatchIds: string[];
  affectedCatalogIds: string[];
  recallId?: string;            // set when a recall was initiated
  rootCauseAnalysis?: string;
  correctiveActions: string[];  // JSON array of action items
  regulatoryNotificationId?: string;
};
```

The recall workflow updates `FoodSafetyIncident.status` as follows:

| Recall action | Incident status transition |
|---|---|
| Recall initiated (QUARANTINED) | `OPEN` → `INVESTIGATING` |
| Recall confirmed (RECALLED) | `INVESTIGATING` → `CONTAINED` |
| Stock destroyed (DESTROYED) | `CONTAINED` → `RESOLVED` (after operator confirms no further affected stock) |
| Recall released (RELEASED, false alarm) | `OPEN`/`INVESTIGATING` → `CLOSED` with `metadata.closedReason="false_alarm"` |

---

## 8. Regulatory Reporting

### 8.1 Standard reports

The `@eks/fims` recall subsystem can generate:

- **FDA Recall Report** (US format): 21 CFR Part 7 compliant, includes the firm, product, reason, code (lot) information, and quantity.
- **EU RASFF notification** (EU format): Rapid Alert System for Food and Feed format.
- **Ghana FDA notification**: Local format with required fields (product, batch, supplier, distribution channels).

Each report is generated as a PDF via the M1 PDF utilities and stored as an immutable artifact linked to the `RecallRecord`.

### 8.2 Audit retention

Recall records, forward traces, destruction evidence, and regulatory reports are retained for **10 years** (regulated retention). The M1 `RetentionSweepJob` is configured to skip these records regardless of organization retention policy. See `OPERATIONAL_RUNBOOKS.md` §10.

---

## 9. API Surface

All routes under `/api/v1/fims/inventory/batches/*` and `/api/v1/fims/inventory/recalls/*`.

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/fims/inventory/batches` | List (filter by `catalogId`, `supplierId`, `recallState`, `status`) | `food.inventory.read` |
| `GET` | `/api/v1/fims/inventory/batches/{id}` | Get one | `food.inventory.read` |
| `PATCH` | `/api/v1/fims/inventory/batches/{id}` | Update (only `storageConditions`, `note`) | `food.inventory.batch.update` |
| `GET` | `/api/v1/fims/inventory/batches/{id}/trace` | Forward / backward trace (`?direction=forward\|backward`) | `food.inventory.read` |
| `GET` | `/api/v1/fims/inventory/batches/{id}/movements` | Movement history | `food.inventory.read` |
| `POST` | `/api/v1/fims/inventory/recalls` | Initiate recall | `food.batch.recall.quarantine` |
| `GET` | `/api/v1/fims/inventory/recalls` | List recalls | `food.inventory.read` |
| `GET` | `/api/v1/fims/inventory/recalls/{id}` | Get recall detail | `food.inventory.read` |
| `POST` | `/api/v1/fims/inventory/recalls/{id}/confirm` | Confirm (QUARANTINED → RECALLED) | `food.batch.recall.confirm` |
| `POST` | `/api/v1/fims/inventory/recalls/{id}/release` | Release false alarm (QUARANTINED → RELEASED) | `food.batch.recall.release` |
| `POST` | `/api/v1/fims/inventory/recalls/{id}/destroy` | Destroy stock (RECALLED → DESTROYED) | `food.batch.recall.destroy` |
| `GET` | `/api/v1/fims/inventory/recalls/{id}/forward-trace` | Get precomputed forward trace | `food.inventory.read` |
| `GET` | `/api/v1/fims/inventory/recalls/{id}/report?format=fda-us` | Regulatory report PDF | `food.inventory.read` |

### 9.1 Example: initiate recall

```http
POST /api/v1/fims/inventory/recalls HTTP/1.1
Content-Type: application/json

{
  "supplierBatchNo": "SUP-LOT-77231",
  "reason": "Foreign body (metal shaving) detected in supplier quality control",
  "sourceType": "SUPPLIER",
  "sourceReferenceId": "procurement-alert-9231",
  "severity": "HIGH"
}

HTTP/1.1 201 Created
{
  "recallId": "rec_8f3a...",
  "status": "QUARANTINED",
  "affectedBatches": ["clx_batch_001", "clx_batch_002"],
  "affectedStockLocations": 4,
  "totalQuantityQuarantined": { "quantity": 32.5, "unit": "kg" }
}
```

### 9.2 Example: forward trace

```http
GET /api/v1/fims/inventory/batches/clx_batch_001/trace?direction=forward HTTP/1.1
```

Returns the tree shown in §5.2.

---

## 10. Traceability Matrix

| Trace question | Endpoint | Notes |
|---|---|---|
| "Where did this batch come from?" | `GET /batches/{id}` + `GET /batches/{id}/movements?movementType=RECEIVING` | Returns supplier, receipt date, PO |
| "Where is this batch now?" | `GET /stocks?batchId={id}` | Returns current on-hand per location |
| "Who has consumed this batch?" | `GET /batches/{id}/trace?direction=forward` | Returns tree of all consumers |
| "What's in this dish I served?" | `GET /batches/{id}/trace?direction=backward` from a `SALES_ORDER` reference | Walks production → consumption → receipt |
| "What batches of this ingredient do I have?" | `GET /stocks?catalogId={id}` + filter `batchId != null` | Lists all batches in inventory |
| "What's expiring soon?" | `GET /batches?expiresBefore={date}&status=RECEIVED,IN_USE` | Drives the FEFO reservation logic |
| "What was recalled and when?" | `GET /recalls` | Lists all recalls with timeline |

---

## 11. References

- `INVENTORY_GUIDE.md` — `InventoryBatch`, `InventoryMovement`, `InventoryStock`, `InventoryLocation`, `WasteRecord`.
- `CATALOG_ARCHITECTURE.md` — `FoodCatalog` link per batch.
- `NUTRITION_ENGINE_GUIDE.md` — `FacilityAllergenDeclaration` (recall reason: undeclared allergen).
- `OPERATIONAL_RUNBOOKS.md` — recall procedure runbook, batch expiration monitoring.
- M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` — `FoodSafetyIncident`, `Supplier`, `FoodCertification`.
- M5 `docs/connectors/PROCUREMENT_GUIDE.md` — supplier-side recall notifications.
- M5 `docs/connectors/GOVERNMENT_INTEGRATION.md` — regulatory recall notifications.
- M1 `docs/EVENT_CONVENTIONS.md`, `docs/OPERATIONS_RUNBOOK.md`.
