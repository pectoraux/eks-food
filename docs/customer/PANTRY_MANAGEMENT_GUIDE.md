# Eks-Food Customer Platform — Pantry Management Guide

> **Audience:** Platform engineers, full-stack engineers, data engineers, inventory integrators. Read alongside `PLATFORM_ARCHITECTURE.md`, `HOUSEHOLD_MODEL_GUIDE.md`, `SHOPPING_LIST_GUIDE.md`, and the M7 `docs/fims/INVENTORY_GUIDE.md` (the `InventoryLocation`, `InventoryStock`, `InventoryBatch` models referenced here).
>
> **Status:** Milestone 8 (Customer Platform). This document specifies the target pantry model: `Pantry` and `PantryItem` Prisma models. M8 builds household-level pantry tracking with expiration scanning, low-stock detection, preferred brands, and consumption history. It does **not** perform automated procurement — that's an M10+ concern that will consume M8 pantry data.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- **Two Prisma models** — `Pantry` (per-household or per-member pantry aggregate) and `PantryItem` (one row per stocked item).
- **Household or member scope** — a household may have one shared pantry (most common), one pantry per member (for households with strict personal-food rules), or both (a shared pantry plus personal stashes for items like snacks).
- **Expiration tracking** — every `PantryItem` carries `expiresAt` (from M7 `InventoryBatch.expiresAt` when linked, or manually entered). The daily `PantryExpirationScannerJob` flags items expiring within 48 hours and notifies the household.
- **Low-stock detection** — `PantryItem.reorderLevel` and `PantryItem.reorderQuantity` per item, with `GET /api/v1/customer/pantries/:householdId/low-stock` returning items at or below reorder level.
- **Preferred brands** — `PantryItem.preferredBrandId` (M7 `Supplier.id` or a tenant-configurable brand registry) for shopping list auto-suggestion.
- **Consumption history** — JSON array on `PantryItem.consumptionHistory` linking each consumption event to a `MealHistory` row, enabling implicit preference derivation (see `PREFERENCE_INTELLIGENCE_GUIDE.md` §4.2).
- **Integration with M7 Inventory Platform** — `Pantry.inventoryLocationId` optionally references an M7 `InventoryLocation` of `locationType=HOUSEHOLD`. When set, `PantryItem` rows project from M7 `InventoryStock` and movements (RECEIVE/CONSUME/WASTE) are mirrored. When not set, `PantryItem` is the system of record (customer-managed only).
- **Common-stock detection** — the `Pantry.commonlyStockedItems` denormalized array lists catalog item IDs that are routinely kept on hand, used for "shopping list starter" suggestions.

### 1.2 Non-Goals

- **Automated procurement** — M8 does not place orders, generate purchase orders, or trigger M5 `ProcurementConnection` for customer-side replenishment. The M10+ `AutomatedProcurementService` will consume pantry low-stock signals to suggest (not place) orders.
- **Cook-side inventory management** — the M7 `InventoryService` remains the system of record for cook/kitchen inventory. Pantry is the customer-facing projection.
- **Recipe scaling for pantry optimization** — M8 stores pantry state; M9+ `MealPlanOptimizer` will use pantry stock to suggest recipes that use what's on hand.
- **Smart fridge / IoT integration** — out of scope for M8.
- **Valuation** — pantry items do not carry cost data on the customer side (cost is a cook/supplier concern via M7 `InventoryBatch.unitCost`).

---

## 2. Pantry Scope

### 2.1 Shared vs. personal pantries

| `Pantry.scopeType` | Description | Default for new households? |
|---|---|:---:|
| `HOUSEHOLD_SHARED` | One pantry for the whole household; any member with `household.pantry.write` can modify. | yes |
| `MEMBER_PERSONAL` | One pantry per member; only the owning member (and ADMIN/GUARDIAN for dependents) can modify. | opt-in |
| `BOTH` | A shared household pantry plus personal stashes. Items can be moved between them via `POST /api/v1/customer/pantries/:id/transfer`. | opt-in |

For `ROOMMATES` households, `MEMBER_PERSONAL` is the recommended default (roommates typically don't share groceries). For `FAMILY` and `APARTMENT` households, `HOUSEHOLD_SHARED` is the default. The default can be overridden at household creation time via `Household.metadata.defaultPantryScope`.

### 2.2 Multiple pantries per household

A household may have multiple pantries (e.g. a shared dry-storage pantry plus a shared refrigerator pantry plus a shared freezer pantry). Each pantry references a different M7 `InventoryLocation` (or is a standalone logical pantry if not linked). The `Pantry.locationLabel` field ("Dry storage", "Fridge", "Freezer", "Pantry cupboard") drives UI grouping.

---

## 3. Data Model

### 3.1 `Pantry`

```
model Pantry {
  id              String   @id @default(cuid())
  organizationId  String
  householdId     String                     // FK → Household
  scopeType       String   @default("HOUSEHOLD_SHARED") // HOUSEHOLD_SHARED|MEMBER_PERSONAL|BOTH
  ownerId         String?                    // FK → HouseholdMember (required for MEMBER_PERSONAL scope; NULL for HOUSEHOLD_SHARED)
  // Location
  locationLabel   String   @default("Pantry")  // "Dry storage", "Fridge", "Freezer", etc.
  inventoryLocationId String?                // FK → InventoryLocation (M7, locationType=HOUSEHOLD); NULL for standalone
  // Denormalized state (computed by PantryService on every write)
  itemCount       Int      @default(0)
  totalValueEstimate Float @default(0)       // sum of PantryItem.estimatedCost * quantity (optional, from M7)
  commonlyStockedItems String @default("[]") // JSON array of FoodCatalog.id routinely kept on hand
  lowStockCount   Int      @default(0)       // count of PantryItem rows at or below reorderLevel
  expiringCount   Int      @default(0)       // count of PantryItem rows expiring within 48h
  // Lifecycle
  status          String   @default("ACTIVE") // ACTIVE|INACTIVE|ARCHIVED
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  household       Household        @relation(fields: [householdId], references: [id])
  owner           HouseholdMember? @relation(fields: [ownerId], references: [id])
  inventoryLocation InventoryLocation? @relation(fields: [inventoryLocationId], references: [id])
  items           PantryItem[]

  @@unique([householdId, scopeType, ownerId, locationLabel])
  @@index([organizationId])
  @@index([householdId, status])
  @@index([ownerId, status])
}
```

### 3.2 `PantryItem`

```
model PantryItem {
  id              String   @id @default(cuid())
  organizationId  String
  pantryId        String                     // FK → Pantry
  catalogItemId   String                     // FK → FoodCatalog (M7, itemType=INGREDIENT or PACKAGED_PRODUCT)
  // Quantity
  quantity        Float
  unit            String                     // FK → MeasurementUnit.code (M7)
  // Batch / expiration
  batchNumber     String?                    // supplier or production batch (from M7 InventoryBatch when linked)
  expiresAt       DateTime?                  // from M7 InventoryBatch.expiresAt when linked, or manual entry
  receivedAt      DateTime  @default(now())  // when the item was added to the pantry
  storageConditions String?                  // "room temperature", "refrigerated", "frozen"
  // Reorder
  reorderLevel    Float    @default(0)       // when quantity drops to/below this, item appears in low-stock list
  reorderQuantity Float    @default(1)       // suggested reorder amount
  // Brand
  preferredBrandId String?                   // tenant-configurable brand code or Supplier.id
  // Consumption history (JSON; capped at last 50 events)
  consumptionHistory String @default("[]")   // [{ date, quantity, unit, mealHistoryId, consumedByMemberId }]
  // Lifecycle
  status          String   @default("IN_STOCK") // IN_STOCK|LOW|EXPIRING|EXPIRED|DEPLETED|REMOVED
  depletedAt      DateTime?
  removedAt       DateTime?
  removedReason   String?                    // CONSUMED|EXPIRED|WASTED|DISCARDED|LOST|OTHER
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  pantry          Pantry       @relation(fields: [pantryId], references: [id])
  catalogItem     FoodCatalog  @relation(fields: [catalogItemId], references: [id])

  @@unique([pantryId, catalogItemId, batchNumber])
  @@index([organizationId])
  @@index([pantryId, status])
  @@index([catalogItemId, status])
  @@index([expiresAt])
  @@index([status, expiresAt])
}
```

---

## 4. Lifecycle & Status Transitions

```
                  ┌───────────────────────────────┐
   add to pantry  │  IN_STOCK                     │
  ───────────────▶│  (quantity > reorderLevel,    │
                  │   not expiring within 48h)    │
                  └──────────────┬────────────────┘
                                 │ quantity drops to ≤ reorderLevel (via consume)
                                 ▼
                  ┌───────────────────────────────┐
                  │  LOW                          │
                  │  (quantity ≤ reorderLevel,    │
                  │   not expiring)               │
                  └──────────────┬────────────────┘
                                 │ expiration scanner: expiresAt within 48h
                                 ▼
                  ┌───────────────────────────────┐
                  │  EXPIRING                     │
                  │  (expiresAt within 48h)       │
                  └──────────────┬────────────────┘
                                 │ expiresAt passed
                                 ▼
                  ┌───────────────────────────────┐
                  │  EXPIRED                      │
                  │  (expiresAt < now;            │
                  │   no further consumption)     │
                  └──────────────┬────────────────┘
                                 │ customer marks as discarded (waste)
                                 ▼
                  ┌───────────────────────────────┐
                  │  REMOVED (reason=WASTED)      │
                  └───────────────────────────────┘

  Alternate from IN_STOCK/LOW:
                                 │ quantity reaches 0 via consume
                                 ▼
                  ┌───────────────────────────────┐
                  │  DEPLETED                     │
                  └──────────────┬────────────────┘
                                 │ customer confirms removal (or auto after 7 days)
                                 ▼
                  ┌───────────────────────────────┐
                  │  REMOVED (reason=CONSUMED)    │
                  └───────────────────────────────┘
```

### 4.1 Status transitions

| From | To | Trigger | Side effects |
|---|---|---|---|
| (new) | `IN_STOCK` | `POST /api/v1/customer/pantries/:id/items` | Pantry.itemCount++, Pantry.totalValueEstimate updated |
| `IN_STOCK` | `LOW` | `PATCH .../items/:id` reduces `quantity` to ≤ `reorderLevel` | Pantry.lowStockCount++; emits `PantryItem.Updated` event |
| `IN_STOCK`/`LOW` | `EXPIRING` | `PantryExpirationScannerJob` detects `expiresAt` within 48h | Pantry.expiringCount++; notification sent to household |
| `EXPIRING` | `EXPIRED` | `PantryExpirationScannerJob` detects `expiresAt` < now | Pantry.expiringCount--; customer notified; item excluded from recipe matching |
| `EXPIRED` | `REMOVED` (wasted) | `DELETE /api/v1/customer/pantries/:id/items/:itemId` with `reason=WASTED` | Pantry.itemCount--; waste record created; implicit preference signal (negative) |
| `IN_STOCK`/`LOW` | `DEPLETED` | consume reduces quantity to 0 | Pantry.itemCount-- (or decrement if reorder planned); customer prompted to confirm removal |
| `DEPLETED` | `REMOVED` (consumed) | Customer confirmation or 7-day auto | Pantry.itemCount--; implicit preference signal (positive if consumed quickly) |
| any | `REMOVED` | `DELETE` with reason | Audit action `CUSTOMER_PANTRY_ITEM_REMOVED` |

---

## 5. Consumption Tracking & Implicit Preferences

Every consumption event — `PATCH /api/v1/customer/pantries/:id/items/:itemId` with `consumeQuantity` — appends to `PantryItem.consumptionHistory`:

```json
{
  "date": "2025-01-15T19:30:00Z",
  "quantity": 0.5,
  "unit": "kg",
  "mealHistoryId": "mh-jollof-jan15-001",
  "consumedByMemberId": "hm-kwame"
}
```

The history is capped at the last 50 events (older events are archived to `PantryItem.metadata.archivedHistory` for a 2-year retention window).

### 5.1 Implicit preference derivation

The nightly `PreferenceDerivationJob` (see `PREFERENCE_INTELLIGENCE_GUIDE.md` §4.2) reads `PantryItem.consumptionHistory`:

- An item consumed ≥3 times in 30 days → writes a `CustomerPreference` row with `provenance=IMPLICIT_PANTRY`, `score=+50`, `confidence=0.7`.
- An item that expired unconsumed (`status=EXPIRED` → `REMOVED` with `reason=WASTED`) → writes a `CustomerPreference` row with `provenance=IMPLICIT_PANTRY`, `score=-25`, `confidence=0.5`.

These preferences feed the household-level resolve endpoint and are visible to the M9+ recommendation engine.

### 5.2 Meal history linkage

When `consumptionHistory[].mealHistoryId` is set (i.e. the consumption was recorded as part of a served `MealCalendar` entry), the implicit preference signal is stronger — `confidence` is bumped to 0.8 because the consumption is verified against a meal that was actually planned and served.

---

## 6. M7 Inventory Platform Integration

### 6.1 The two integration modes

| Mode | `Pantry.inventoryLocationId` | `PantryItem` source | Who writes? |
|---|:---:|---|---|
| **Linked** | set (FK to M7 `InventoryLocation` of `locationType=HOUSEHOLD`) | Projects from M7 `InventoryStock` at that location | Cook/kitchen side writes via M7 `InventoryService`; customer side reads + adds metadata (preferredBrandId, reorderLevel) |
| **Standalone** | NULL | `PantryItem` is the system of record | Customer writes via `POST/PATCH /api/v1/customer/pantries/:id/items` |

The linked mode is used when a household is also a cook-side kitchen (e.g. a shared commercial kitchen where cooks prepare meals and household members also keep personal stock). The standalone mode is the default for typical family/roommate households.

### 6.2 Linked mode sync

In linked mode, the M1 `@eks/workers` consumer listens for M7 `Inventory.StockMovement.Recorded` events on the linked `InventoryLocation`:

| M7 movement type | Pantry side effect |
|---|---|
| `RECEIVING` | New `PantryItem` row created (or quantity increased if same batch); `receivedAt` set from movement `occurredAt` |
| `CONSUMPTION` | `PantryItem.quantity` decreased; `consumptionHistory` appended (linked to the movement's `metadata.mealHistoryId` if set) |
| `TRANSFER_IN` | New `PantryItem` row from the transferring location |
| `TRANSFER_OUT` | `PantryItem` row marked `REMOVED` with `reason=CONSUMED` (transferred to another location) |
| `WASTE` / `SPOILAGE` | `PantryItem` row marked `REMOVED` with `reason=WASTED` |
| `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` | `PantryItem.quantity` adjusted; `metadata.lastAdjustment` records the variance |

In linked mode, the customer-side API cannot directly modify `quantity` or `expiresAt` — those fields are read-only projections. The customer can still modify `preferredBrandId`, `reorderLevel`, `reorderQuantity`, and `consumptionHistory` (the latter is appended on consume via the linked M7 movement).

### 6.3 Standalone mode

In standalone mode, the customer has full write access to `PantryItem` fields. The M8 `PantryService` is the system of record — no M7 events are emitted (pantry data is customer-domain, not cook-domain). The customer is responsible for entering accurate `expiresAt` values; the M8 UI provides default shelf-life suggestions from the M7 `FoodCatalog.shelfLifeDays` field.

---

## 7. Common-Stock Detection

`Pantry.commonlyStockedItems` is a denormalized JSON array of `FoodCatalog.id` values that the household routinely keeps on hand. It's recomputed nightly by the `PantryCommonStockJob`:

1. Scan all `PantryItem` rows for the household over the last 90 days.
2. Group by `catalogItemId`; count distinct batches received.
3. Items received ≥3 times in 90 days → added to `commonlyStockedItems`.
4. Items not received in 90 days → removed from `commonlyStockedItems`.

The `commonlyStockedItems` array powers:

- **Shopping list starter** — `POST /api/v1/customer/shopping-lists` with `body.prepopulateCommonStock=true` creates a shopping list pre-populated with `commonlyStockedItems` (at `reorderQuantity` each) that the customer can edit before saving.
- **Pantry dashboard** — the UI shows "Common items" as a quick-add row when the customer adds a new item manually.
- **M9+ recommendation engine** — common-stock items are excluded from "you might like to try" suggestions (the customer already knows about them).

---

## 8. Expiration Scanner

The `PantryExpirationScannerJob` (M1 cron, runs every 6 hours) scans all `PantryItem` rows where `expiresAt IS NOT NULL` and `status IN ('IN_STOCK', 'LOW', 'EXPIRING')`:

```
FOR each PantryItem:
  hours_to_expiry = (expiresAt - NOW()) / 1h
  IF hours_to_expiry <= 0 AND status != 'EXPIRED':
    UPDATE PantryItem SET status='EXPIRED'
    UPDATE Pantry.expiringCount--
    Emit PantryItem.Expired event
    Send "Item expired" notification to household (M5 NotificationConnector)
    Write CUSTOMER_PANTRY_ITEM_EXPIRED audit action
  ELIF hours_to_expiry <= 48 AND status != 'EXPIRING':
    UPDATE PantryItem SET status='EXPIRING'
    UPDATE Pantry.expiringCount++
    Emit PantryItem.Updated event (with field expiry_warning=true)
    Send "Item expiring soon" notification (suppressed if already sent in last 24h)
  ELIF hours_to_expiry > 48 AND status = 'EXPIRING':
    UPDATE PantryItem SET status='IN_STOCK' or 'LOW' (based on quantity vs reorderLevel)
    UPDATE Pantry.expiringCount--
    (no notification — false alarm, e.g. customer extended expiresAt)
```

### 8.1 Notification suppression

To avoid notification spam, the job tracks the last notification timestamp in `PantryItem.metadata.lastExpiryNotification`. Notifications are sent at most once per 24-hour window per item.

### 8.2 Timezone handling

`expiresAt` is stored in UTC. The scanner computes "today" in the household's timezone (from `Household.metadata.timezone`, default `Africa/Accra`) so that "expiring tomorrow" notifications arrive at a sensible local time (e.g. morning, not 23:00).

---

## 9. Low-Stock Detection

`GET /api/v1/customer/pantries/:householdId/low-stock` returns all `PantryItem` rows where `quantity <= reorderLevel` and `status IN ('IN_STOCK', 'LOW')`:

```json
{
  "householdId": "hh-mensah-01",
  "pantryId": "pantry-shared-01",
  "lowStockItems": [
    {
      "id": "pi-rice-001",
      "catalogItemId": "fc-rice-lg-001",
      "catalogItemName": "Long-grain rice",
      "quantity": 0.3,
      "unit": "kg",
      "reorderLevel": 0.5,
      "reorderQuantity": 2.0,
      "preferredBrandId": "perfetto-jasmine",
      "status": "LOW"
    }
  ],
  "totalCount": 1
}
```

The endpoint is called by:
- The household dashboard UI (every 5 min while open).
- The M9+ recommendation engine (when generating shopping list suggestions).
- The weekly "Pantry restock reminder" notification (sent Sunday evening via M5 `NotificationConnector`).

---

## 10. API Examples

### 10.1 Add an item to the pantry

```http
POST /api/v1/customer/pantries/pantry-shared-01/items
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01

{
  "catalogItemId": "fc-rice-lg-001",
  "quantity": 2.0,
  "unit": "kg",
  "batchNumber": "LOT-250115-PERFETTO-001",
  "expiresAt": "2025-07-15",
  "storageConditions": "room temperature",
  "reorderLevel": 0.5,
  "reorderQuantity": 2.0,
  "preferredBrandId": "perfetto-jasmine"
}
```

Response `201 Created`:
```json
{
  "id": "pi-rice-001",
  "pantryId": "pantry-shared-01",
  "catalogItemId": "fc-rice-lg-001",
  "quantity": 2.0,
  "unit": "kg",
  "expiresAt": "2025-07-15T00:00:00Z",
  "status": "IN_STOCK",
  "consumptionHistory": []
}
```

### 10.2 Consume from a pantry item

```http
PATCH /api/v1/customer/pantries/pantry-shared-01/items/pi-rice-001
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01

{
  "consumeQuantity": 0.5,
  "unit": "kg",
  "mealHistoryId": "mh-jollof-jan15-001",
  "consumedByMemberId": "hm-kwame"
}
```

Response `200 OK`:
```json
{
  "id": "pi-rice-001",
  "quantity": 1.5,
  "unit": "kg",
  "status": "IN_STOCK",
  "consumptionHistory": [
    { "date": "2025-01-15T19:30:00Z", "quantity": 0.5, "unit": "kg", "mealHistoryId": "mh-jollof-jan15-001", "consumedByMemberId": "hm-kwame" }
  ]
}
```

### 10.3 List expiring items

```http
GET /api/v1/customer/pantries/hh-mensah-01/expiring?withinHours=48
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01
```

Response `200 OK`:
```json
{
  "householdId": "hh-mensah-01",
  "withinHours": 48,
  "expiringItems": [
    {
      "id": "pi-tomato-001",
      "catalogItemId": "fc-tomato-fresh-001",
      "catalogItemName": "Fresh tomatoes",
      "quantity": 0.4,
      "unit": "kg",
      "expiresAt": "2025-01-17T06:00:00Z",
      "hoursToExpiry": 33.5,
      "status": "EXPIRING"
    }
  ],
  "totalCount": 1
}
```

---

## 11. Cross-References

- `PLATFORM_ARCHITECTURE.md` §3.6 — pantry bounded context overview.
- `HOUSEHOLD_MODEL_GUIDE.md` §4 — member roles that drive pantry permission checks.
- `SHOPPING_LIST_GUIDE.md` §6.4 — low-stock items feeding shopping list generation.
- `PREFERENCE_INTELLIGENCE_GUIDE.md` §4.2 — pantry consumption feeding implicit preference derivation.
- `MEAL_PLANNING_GUIDE.md` §6 — meal calendar entries consuming pantry items (the SHOPPED state).
- `PRIVACY_PERMISSIONS_GUIDE.md` §4 — dependent-scoped pantries (child-safety gating on pantry writes for personal stashes).
- M7 `docs/fims/INVENTORY_GUIDE.md` — `InventoryLocation` (locationType=HOUSEHOLD), `InventoryStock`, `InventoryBatch` definitions.
- M7 `docs/fims/INVENTORY_GUIDE.md` §4 — `InventoryService` movement types that mirror to pantry in linked mode.
- M7 `docs/fims/CATALOG_ARCHITECTURE.md` — `FoodCatalog` referenced by `PantryItem.catalogItemId`.
- M7 `docs/fims/CATALOG_ARCHITECTURE.md` §3.6 — `FoodCatalog.shelfLifeDays` used for default expiration suggestions.
- M7 `docs/fims/MEASUREMENT_SYSTEM_GUIDE.md` — `MeasurementUnit` codes referenced by `PantryItem.unit`.
- M5 `docs/connectors/NOTIFICATIONS_GUIDE.md` — expiration and low-stock notification delivery.
