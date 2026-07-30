# Eks-Food Customer Platform — Shopping List Guide

> **Audience:** Platform engineers, full-stack engineers, mobile engineers, real-time systems engineers. Read alongside `PLATFORM_ARCHITECTURE.md`, `HOUSEHOLD_MODEL_GUIDE.md`, `MEAL_PLANNING_GUIDE.md`, `PANTRY_MANAGEMENT_GUIDE.md`, and the M7 `docs/fims/CATALOG_ARCHITECTURE.md` (the `FoodCatalog` substitution model referenced here).
>
> **Status:** Milestone 8 (Customer Platform). This document specifies the target shopping list model: `ShoppingList` and `ShoppingListItem` Prisma models. M8 supports collaborative household lists with multi-device synchronization, recipe-generated items, recurring lists, completion tracking, and substitutions. Conflict resolution is Last-Writer-Wins on item fields with additive merging on item addition.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- **Two Prisma models** — `ShoppingList` (per-household, per-trip list aggregate) and `ShoppingListItem` (one row per item to buy).
- **Four trip types** — `WEEKLY_GROCERY`, `TOP_UP`, `EVENT`, `RECIPE_GENERATED` — each with distinct default state and UI affordances.
- **Four item sources** — `MANUAL` (customer-added), `RECIPE_GENERATED` (from `MealPlan` via M7 `RecipeScaler`), `RECURRING` (from a template), `SUBSTITUTION` (replaced an unavailable item).
- **Collaborative editing** — multiple household members can add/edit/check off items simultaneously. Changes are propagated in real-time via Server-Sent Events (SSE).
- **Multi-device synchronization** — a customer with two devices (phone + web) sees the same list state. Conflict resolution is deterministic (§7).
- **Completion tracking** — items progress through `PENDING` → `IN_CART` → `PURCHASED` (or `UNAVAILABLE`) with audit trail.
- **Substitutions** — when an item is unavailable at the store, the customer can substitute it with an alternative from the M7 `FoodCatalog.substitutions` array, preserving the link to the original item.
- **Recurring lists** — templated lists that auto-create on a schedule (weekly, monthly, before holidays) for households with predictable shopping patterns.
- **Pantry-aware generation** — `POST /api/v1/customer/shopping-lists/:id/generate-from-plan` accepts a `MealPlan.id`, computes ingredient quantities via M7 `RecipeScaler`, and subtracts on-hand pantry stock before writing items.

### 1.2 Non-Goals

- **Price comparison** — M8 stores `ShoppingListItem.estimatedCost` (from the M5 merchant connector catalog, if available) but does not compare across merchants or recommend the cheapest store.
- **Automated ordering** — the M10+ `AutomatedProcurementService` will consume shopping list data to suggest orders; M8 does not place orders.
- **In-store navigation** — out of scope.
- **Loyalty program integration** — out of scope (M5 merchant connector captures loyalty IDs but doesn't apply them at checkout).
- **Coupon clipping** — out of scope.

---

## 2. Trip Types

| `tripType` | Description | Default `dueAt` | Default assignedTo | Pre-population source |
|---|---|:---:|---|---|
| `WEEKLY_GROCERY` | The household's weekly shopping trip | Sunday 18:00 (configurable per household) | All `ACTIVE` members | `Pantry.commonlyStockedItems` at `reorderQuantity` each (low-stock items only by default) |
| `TOP_UP` | A mid-week top-up for forgotten items | Within 24h | The creator | Empty (manual entry) |
| `EVENT` | A special-occasion shopping trip (birthday, dinner party) | The day before the event | The event organizer | From the `MealPlan` of `planType=SPECIAL_OCCASION` |
| `RECIPE_GENERATED` | Items needed for a specific `MealPlan` | The day before the plan's `startDate` | All `ACTIVE` members | From the `MealPlan` (recipe ingredients scaled by servings, pantry-aware) |

---

## 3. Data Model

### 3.1 `ShoppingList`

```
model ShoppingList {
  id              String   @id @default(cuid())
  organizationId  String
  householdId     String                     // FK → Household
  // Trip metadata
  tripType        String                     // WEEKLY_GROCERY|TOP_UP|EVENT|RECIPE_GENERATED
  title           String                     // e.g. "Week of Jan 15 groceries"
  description     String?
  dueAt           DateTime?                  // when the trip should happen
  storePreference String?                    // tenant-configurable store code (e.g. "shoprite-east-legon")
  // Assignment
  assignedTo      String   @default("[]")    // JSON array of HouseholdMember.id
  // Source linkage
  mealPlanId      String?                    // FK → MealPlan (for RECIPE_GENERATED tripType)
  recurringTemplateId String?                // FK → ShoppingListRecurringTemplate (M8, defined below)
  // Denormalized state (computed by ShoppingListService on every item write)
  itemCount       Int      @default(0)
  pendingCount    Int      @default(0)
  inCartCount     Int      @default(0)
  purchasedCount  Int      @default(0)
  unavailableCount Int     @default(0)
  estimatedTotalCost Float @default(0)
  // Lifecycle
  status          String   @default("OPEN")  // OPEN|COMPLETED|ARCHIVED|CANCELLED
  completedAt     DateTime?
  completedByMemberId String?
  archivedAt      DateTime?
  cancelledAt     DateTime?
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  household       Household       @relation(fields: [householdId], references: [id])
  mealPlan        MealPlan?       @relation(fields: [mealPlanId], references: [id])
  items           ShoppingListItem[]

  @@index([organizationId])
  @@index([householdId, status])
  @@index([dueAt, status])
  @@index([tripType, status])
}
```

### 3.2 `ShoppingListItem`

```
model ShoppingListItem {
  id              String   @id @default(cuid())
  organizationId  String
  shoppingListId  String                     // FK → ShoppingList
  // Item
  catalogItemId   String?                    // FK → FoodCatalog (M7); NULL for free-text items
  freeTextName    String?                    // required when catalogItemId is NULL
  freeTextNotes   String?
  // Quantity
  quantity        Float
  unit            String                     // FK → MeasurementUnit.code (M7)
  // Source
  source          String   @default("MANUAL") // MANUAL|RECIPE_GENERATED|RECURRING|SUBSTITUTION
  sourceRef       String?                    // JSON: { mealPlanId?, recipeId?, recurringTemplateId?, substitutedForItemId? }
  // Brand
  preferredBrandId String?
  // Cost
  estimatedCost   Float?                     // per-unit cost from M5 merchant connector (optional)
  actualCost      Float?                     // filled at PURCHASED time
  // Assignment
  assignedToMemberId String?                 // FK → HouseholdMember
  // Completion
  status          String   @default("PENDING") // PENDING|IN_CART|PURCHASED|UNAVAILABLE
  statusChangedAt DateTime?
  statusChangedByMemberId String?
  purchasedAt     DateTime?
  // Substitution
  substitutedForItemId String?               // self-FK: this item was a substitution for another (now-UNAVAILABLE) item
  substitutionReason String?                // OUT_OF_STOCK|WRONG_BRAND|BETTER_PRICE|OTHER
  // Co-shopping (which device added/last edited)
  addedByMemberId String
  addedAt         DateTime  @default(now())
  lastEditedByMemberId String?
  lastEditedAt    DateTime?
  // Conflict resolution
  version         Int      @default(1)       // optimistic concurrency token
  // Standard audit block
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  shoppingList    ShoppingList     @relation(fields: [shoppingListId], references: [id])
  catalogItem     FoodCatalog?     @relation(fields: [catalogItemId], references: [id])
  assignedTo      HouseholdMember? @relation(fields: [assignedToMemberId], references: [id])
  substitutedFor  ShoppingListItem? @relation("ShoppingListItem_SubstitutedFor", fields: [substitutedForItemId], references: [id])
  substitutions   ShoppingListItem[] @relation("ShoppingListItem_SubstitutedFor")

  @@unique([shoppingListId, catalogItemId, freeTextName, substitutedForItemId])
  @@index([organizationId])
  @@index([shoppingListId, status])
  @@index([catalogItemId])
  @@index([status, shoppingListId])
}
```

### 3.3 `ShoppingListRecurringTemplate` (supporting model)

```
model ShoppingListRecurringTemplate {
  id              String   @id @default(cuid())
  organizationId  String
  householdId     String
  name            String                     // e.g. "Weekly restock"
  // Schedule (cron-like)
  cronExpression  String                     // e.g. "0 18 * * 0" = every Sunday 18:00
  nextRunAt       DateTime
  timezone        String   @default("Africa/Accra")
  // Template items (JSON: [{ catalogItemId, quantity, unit, preferredBrandId? }])
  templateItems   String   @default("[]")
  // Lifecycle
  status          String   @default("ACTIVE") // ACTIVE|PAUSED|ARCHIVED
  lastRunAt       DateTime?
  lastRunListId   String?                    // FK → ShoppingList (the most recent list generated)
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  household       Household         @relation(fields: [householdId], references: [id])
  generatedLists  ShoppingList[]

  @@index([organizationId])
  @@index([householdId, status])
  @@index([nextRunAt, status])
}
```

---

## 4. Item Sources

### 4.1 `MANUAL`

Customer adds the item directly via the UI. `catalogItemId` may be set (customer picked from the M7 `FoodCatalog` search results) or NULL (free-text entry). Free-text items are NOT linked to the catalog and therefore don't contribute to preference derivation or pantry restock suggestions — they're one-off purchases.

### 4.2 `RECIPE_GENERATED`

Generated by `POST /api/v1/customer/shopping-lists/:id/generate-from-plan` with a `mealPlanId`. The `ShoppingListService.generateFromPlan` algorithm:

1. Load the `MealPlan` and all its `MealCalendar` entries (status in `PLANNED`, `SHOPPED`, `COOKING`).
2. For each entry with a `recipeId`, call M7 `RecipeScaler.scaleToServings(recipeVersion, scaledServings)` to get per-ingredient quantities.
3. Aggregate quantities across all entries by `catalogItemId` (summing same-unit quantities).
4. Subtract on-hand pantry stock: for each `catalogItemId`, query `PantryItem` rows where `status IN ('IN_STOCK', 'LOW')` and `expiresAt > plan.endDate`. Subtract the available quantity from the required quantity; if remainder ≤ 0, skip the item.
5. For each remaining item, write a `ShoppingListItem` with `source=RECIPE_GENERATED`, `sourceRef={ mealPlanId, recipeIds: [...] }`, `quantity=remainder`, `unit=canonical unit` (converted via M7 `MeasurementConverter` if the recipe uses a different unit than the catalog's default).
6. Emit `ShoppingListItem.Added` events for each new item.
7. Update `ShoppingList.itemCount`, `pendingCount`, `estimatedTotalCost` (using M5 merchant connector catalog if available).

### 4.3 `RECURRING`

Generated by the `ShoppingListRecurringJob` (M1 cron, runs every 5 min). For each `ShoppingListRecurringTemplate` where `nextRunAt <= NOW()` and `status=ACTIVE`:

1. Create a new `ShoppingList` with `tripType=WEEKLY_GROCERY` (or per template), `dueAt = nextRunAt + 24h`, `recurringTemplateId = template.id`.
2. For each item in `template.templateItems`, write a `ShoppingListItem` with `source=RECURRING`, `sourceRef={ recurringTemplateId }`.
3. Update `template.lastRunAt = now()`, `template.lastRunListId = newList.id`, `template.nextRunAt = next cron occurrence`.
4. Send a "New shopping list created" notification to the household.

### 4.4 `SUBSTITUTION`

When a customer marks an item as `UNAVAILABLE` at the store, they may substitute it with an alternative. The substitution flow:

1. `PATCH /api/v1/customer/shopping-lists/:id/items/:itemId` with `{ status: 'UNAVAILABLE' }`.
2. `POST /api/v1/customer/shopping-lists/:id/items` with the substitute item, `source=SUBSTITUTION`, `substitutedForItemId = originalItem.id`, `substitutionReason = 'OUT_OF_STOCK'`.
3. The original item remains in the list with `status=UNAVAILABLE` (audit trail); the substitute is a new item that progresses normally.
4. The M7 `FoodCatalog.substitutions` array provides suggestions: if the customer is substituting "long-grain rice", the UI shows "basmati rice", "jasmine rice", "short-grain rice" as quick-pick options.

---

## 5. Collaborative Editing & Multi-Device Sync

### 5.1 Real-time updates via SSE

Each shopping list has a dedicated SSE endpoint: `GET /api/v1/customer/shopping-lists/:id/events` (long-lived connection, M1 `@eks/api/sse` helper). When any item is added, updated, or status-changed, the `ShoppingListService` emits an event to all active SSE subscribers for that list.

Event types:

| Event | Payload | Trigger |
|---|---|---|
| `item.added` | `{ item: ShoppingListItem }` | New item created |
| `item.updated` | `{ itemId, changes: {...}, version: n }` | Item fields changed |
| `item.status_changed` | `{ itemId, oldStatus, newStatus, changedBy, changedAt }` | Item status transition |
| `item.removed` | `{ itemId, removedBy, removedAt }` | Item deleted |
| `list.updated` | `{ changes: {...} }` | List-level fields changed (title, dueAt, assignedTo) |
| `list.completed` | `{ completedAt, completedBy }` | List marked COMPLETED |
| `presence` | `{ memberId, deviceId, action: 'join'/'leave' }` | A member opened/closed the list |

The SSE connection authenticates via the M2 session token in the `Authorization` header (or a short-lived SSE-specific token minted by `POST /api/v1/customer/shopping-lists/:id/sse-token` to avoid sending the long-lived session token over the wire).

### 5.2 Multi-device semantics

A customer with two devices (phone + web) may have both open simultaneously. Both devices connect to the same SSE stream. When device A makes a change, device B receives the SSE event and updates its local view. When device B makes a change, the API writes it, increments the `version` on the item, and emits the event to device A.

If both devices make conflicting changes within the same `version` window (rare — requires near-simultaneous edits), the conflict resolution algorithm (§7) applies.

### 5.3 Offline mode

The mobile app caches the shopping list locally (M1 `@eks/cache` persistent variant). When offline:
- Item additions are queued locally with a client-generated `clientId` (UUID).
- Status changes (PENDING → IN_CART → PURCHASED) are queued locally.
- On reconnect, the queue is flushed: each operation is sent with the `clientId` for idempotency. If the server has already processed an operation with that `clientId` (e.g. the user's other device already added the item), the server returns the existing item and the client reconciles.

---

## 6. Completion Tracking

### 6.1 Item status state machine

```
                  ┌─────────────────────────────┐
   add item       │  PENDING                    │
  ───────────────▶│  (not yet in cart)          │
                  └──────────────┬──────────────┘
                                 │ customer adds to cart at store
                                 ▼
                  ┌─────────────────────────────┐
                  │  IN_CART                    │
                  │  (in the physical cart)     │
                  └──────────────┬──────────────┘
                                 │ checkout
                                 ▼
                  ┌─────────────────────────────┐
                  │  PURCHASED                  │
                  │  (paid for; triggers pantry │
                  │   receive on list complete) │
                  └─────────────────────────────┘

  Alternate from PENDING or IN_CART:
                                 │ item not available
                                 ▼
                  ┌─────────────────────────────┐
                  │  UNAVAILABLE                │
                  │  (not in stock; may be      │
                  │   substituted)              │
                  └─────────────────────────────┘
```

### 6.2 List-level completion

`POST /api/v1/customer/shopping-lists/:id/complete` marks the list as `COMPLETED`:

1. All `PENDING` and `IN_CART` items are automatically transitioned to `PURCHASED` (the customer confirms the cart at checkout).
2. `UNAVAILABLE` items remain in that status (audit trail).
3. The list `status=COMPLETED`, `completedAt=now`, `completedByMemberId=caller`.
4. **Pantry receive**: for each `PURCHASED` item with a `catalogItemId`, a new `PantryItem` row is created (or quantity increased if same batch) via `POST /api/v1/customer/pantries/:id/items`. This links the shopping list completion to pantry restocking automatically.
5. **Meal plan update**: for each `RECIPE_GENERATED` item, the corresponding `MealCalendar` entries are transitioned from `PLANNED` to `SHOPPED` (the ingredients are now on hand).
6. **Implicit preferences**: items marked `UNAVAILABLE` and not substituted don't contribute to preferences; items `PURCHASED` contribute a `+25` implicit preference signal (the customer bought it).
7. Emit `ShoppingList.Completed` event and `CUSTOMER_SHOPPING_LIST_COMPLETED` audit action.

### 6.3 Estimated vs. actual cost

`estimatedTotalCost` is computed at item-add time from the M5 merchant connector catalog (if `storePreference` is set and the merchant exposes a price feed). `actualCost` is filled at `PURCHASED` time (the customer enters the receipt total per item, or scans the receipt via the M5 merchant connector OCR — M9+ feature). The household dashboard tracks `actualCost` over time for budget insights.

---

## 7. Conflict Resolution

### 7.1 The three conflict scenarios

| Scenario | Example | Resolution |
|---|---|---|
| **Add-Add** | Two devices add the same item simultaneously | Server deduplicates: the second add returns the existing item (matched by `catalogItemId` + `freeTextName`); both clients reconcile to the same `itemId` |
| **Update-Update** | Two devices edit different fields of the same item | Merge: both edits apply (field-level merge) |
| **Update-Update (same field)** | Two devices edit the `quantity` of the same item to different values | Last-Writer-Wins: the edit with the later `lastEditedAt` wins; the losing client receives an `item.updated` SSE event with the winning value and reconciles |
| **Update-Delete** | One device edits an item while another deletes it | Delete wins: the edit is rejected with `CUSTOMER_ITEM_ALREADY_REMOVED`; the editing client receives an `item.removed` SSE event |
| **Status-Status** | Two devices transition the same item to different statuses | Last-Writer-Wins on `statusChangedAt` |

### 7.2 The merge algorithm

The `ShoppingListService.mergeItem(existing, incoming)` algorithm:

```
1. IF incoming.version < existing.version:
   RETURN { conflict: true, reason: "STALE_VERSION", serverItem: existing }
2. IF incoming.version > existing.version:
   RETURN { conflict: true, reason: "FUTURE_VERSION", serverItem: existing }  // shouldn't happen
3. // versions equal — apply field-level merge
   merged = { ...existing }
   FOR each (field, value) in incoming.changes:
     IF field is in MULTIPLE_FIELD_SET (e.g. metadata.tags):
       merged[field] = mergeArrays(existing[field], value)
     ELSE IF incoming.lastEditedAt > existing.lastEditedAt OR incoming.lastEditedByMemberId != existing.lastEditedByMemberId:
       merged[field] = value
       merged.lastEditedAt = incoming.lastEditedAt
       merged.lastEditedByMemberId = incoming.lastEditedByMemberId
   merged.version = existing.version + 1
   RETURN { conflict: false, merged }
```

### 7.3 Client-side reconciliation

When a client receives an `item.updated` SSE event with a `version` higher than its local copy:

1. If the local copy has unsaved changes (the user is typing), the client shows a "Conflict — server has newer version" toast.
2. The user can choose: "Keep mine" (re-apply local changes with a new `PATCH` request) or "Use server" (discard local changes).
3. If the local copy has no unsaved changes, the client silently updates to the server version.

The M8 mobile SDK (`@eks/customer/shopping-list-client`) implements this reconciliation automatically; web clients use the same SSE stream with a React hook (`useShoppingListItem(itemId)`).

---

## 8. Recurring Lists

### 8.1 Template creation

```http
POST /api/v1/customer/shopping-lists/recurring-templates
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01

{
  "householdId": "hh-mensah-01",
  "name": "Weekly restock",
  "cronExpression": "0 18 * * 0",
  "timezone": "Africa/Accra",
  "templateItems": [
    { "catalogItemId": "fc-rice-lg-001", "quantity": 2.0, "unit": "kg", "preferredBrandId": "perfetto-jasmine" },
    { "catalogItemId": "fc-tomato-fresh-001", "quantity": 1.0, "unit": "kg" },
    { "catalogItemId": "fc-onion-fresh-001", "quantity": 0.5, "unit": "kg" }
  ]
}
```

### 8.2 Template lifecycle

- `ACTIVE`: The template runs on schedule; new lists are generated automatically.
- `PAUSED`: The template is paused (e.g. the household is on vacation); no new lists are generated. The `nextRunAt` is not advanced while paused; on resume, the next run is the next cron occurrence after `NOW()`.
- `ARCHIVED`: The template is no longer needed. Existing generated lists are retained; no new lists are generated.

### 8.3 Customization after generation

When a recurring template generates a new list, the list is a fresh copy of the template — not a reference. The customer can add, edit, or remove items without affecting the template. If the customer wants to update the template (e.g. "we're out of onions, add them to the weekly template"), they edit the template directly via `PATCH /api/v1/customer/shopping-lists/recurring-templates/:id`.

---

## 9. API Examples

### 9.1 Create a shopping list

```http
POST /api/v1/customer/shopping-lists
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01
Idempotency-Key: sl-week-jan15-001

{
  "householdId": "hh-mensah-01",
  "tripType": "WEEKLY_GROCERY",
  "title": "Week of Jan 15 groceries",
  "dueAt": "2025-01-19T18:00:00Z",
  "assignedTo": ["hm-kwame", "hm-akosua"]
}
```

Response `201 Created`:
```json
{
  "id": "sl-week-jan15-001",
  "status": "OPEN",
  "tripType": "WEEKLY_GROCERY",
  "title": "Week of Jan 15 groceries",
  "dueAt": "2025-01-19T18:00:00Z",
  "assignedTo": ["hm-kwame", "hm-akosua"],
  "itemCount": 0,
  "estimatedTotalCost": 0
}
```

### 9.2 Add an item manually

```http
POST /api/v1/customer/shopping-lists/sl-week-jan15-001/items
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01

{
  "catalogItemId": "fc-rice-lg-001",
  "quantity": 2.0,
  "unit": "kg",
  "source": "MANUAL",
  "preferredBrandId": "perfetto-jasmine"
}
```

Response `201 Created`:
```json
{
  "id": "sli-rice-001",
  "shoppingListId": "sl-week-jan15-001",
  "catalogItemId": "fc-rice-lg-001",
  "quantity": 2.0,
  "unit": "kg",
  "source": "MANUAL",
  "status": "PENDING",
  "addedByMemberId": "hm-kwame",
  "addedAt": "2025-01-15T19:00:00Z",
  "version": 1
}
```

### 9.3 Generate items from a meal plan

```http
POST /api/v1/customer/shopping-lists/sl-week-jan15-001/generate-from-plan
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01

{
  "mealPlanId": "mp-week-jan15-001",
  "subtractPantryStock": true
}
```

Response `200 OK`:
```json
{
  "shoppingListId": "sl-week-jan15-001",
  "generatedFromMealPlanId": "mp-week-jan15-001",
  "itemsAdded": 12,
  "itemsSkippedDueToPantryStock": 3,
  "itemsAddedIds": ["sli-001", "sli-002", "..."],
  "totalEstimatedCost": 145.50
}
```

### 9.4 Mark item as purchased

```http
PATCH /api/v1/customer/shopping-lists/sl-week-jan15-001/items/sli-rice-001
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01

{
  "status": "PURCHASED",
  "actualCost": 28.50,
  "version": 1
}
```

Response `200 OK`:
```json
{
  "id": "sli-rice-001",
  "status": "PURCHASED",
  "statusChangedAt": "2025-01-19T16:30:00Z",
  "statusChangedByMemberId": "hm-kwame",
  "purchasedAt": "2025-01-19T16:30:00Z",
  "actualCost": 28.50,
  "version": 2
}
```

### 9.5 Complete the list

```http
POST /api/v1/customer/shopping-lists/sl-week-jan15-001/complete
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01
```

Response `200 OK` (with side-effect summary):
```json
{
  "id": "sl-week-jan15-001",
  "status": "COMPLETED",
  "completedAt": "2025-01-19T17:00:00Z",
  "completedByMemberId": "hm-kwame",
  "sideEffects": {
    "pantryItemsAdded": 9,
    "pantryItemsUpdated": 2,
    "mealCalendarEntriesShopped": 14,
    "implicitPreferencesRecorded": 9
  }
}
```

---

## 10. Cross-References

- `PLATFORM_ARCHITECTURE.md` §3.7 — shopping bounded context overview.
- `HOUSEHOLD_MODEL_GUIDE.md` §4 — member roles that drive list permission checks.
- `MEAL_PLANNING_GUIDE.md` §6.4 — recipe-generated shopping list items derived from meal plans.
- `PANTRY_MANAGEMENT_GUIDE.md` §5 — pantry receive on list completion.
- `PREFERENCE_INTELLIGENCE_GUIDE.md` §4.2 — purchased items feeding implicit preferences.
- `PRIVACY_PERMISSIONS_GUIDE.md` §4 — dependent-scoped shopping (child-safety gating on purchasing age-restricted items).
- M1 `docs/API_CONVENTIONS.md` — SSE conventions, idempotency, RFC 7807 errors.
- M5 `docs/connectors/MERCHANT_GUIDE.md` — merchant catalog price feed (for `estimatedCost`).
- M7 `docs/fims/CATALOG_ARCHITECTURE.md` — `FoodCatalog.substitutions` array for substitution suggestions.
- M7 `docs/fims/RECIPE_ENGINE_GUIDE.md` — `RecipeScaler.scaleToServings` used in `generate-from-plan`.
- M7 `docs/fims/MEASUREMENT_SYSTEM_GUIDE.md` — `MeasurementConverter` for unit normalization during plan-to-list generation.
