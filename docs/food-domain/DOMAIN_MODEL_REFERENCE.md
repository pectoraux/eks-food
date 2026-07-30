# Eks-Food Canonical Domain Model Reference

> **Audience:** Platform engineers, application architects, data engineers, on-call maintainers. Read alongside `CANONICAL_DATA_STANDARDS.md`, `ENTITY_RELATIONSHIPS.md`, `GRAPH_ARCHITECTURE.md`, `API_DOCUMENTATION.md`, and `OPERATIONAL_RUNBOOKS.md`.
>
> **Status:** Milestone 6 — the Core Food Domain, Canonical Data Model & Food Intelligence Graph Foundation. This document describes the **canonical target M6 schema**: the `@eks/food-domain` package (a layer above the M1 `@eks/domain` kernel that owns bounded contexts such as `cook`, `customer`, `restaurant`, `inventory`, `vendor`, `supplier`, `safety`, `procurement`, `foodgraph`), the extended Prisma schema (`Country`, `Region`, `City`, `Neighborhood`, `Household`, `CustomerProfile`, `CookProfile`, `Restaurant`, `Kitchen`, `Ingredient`, `Recipe`, `RecipeIngredient`, `Menu`, `MenuItem`, `Inventory`, `InventoryBatch`, `Equipment`, `Vehicle`, `Supplier`, `Vendor`, `Certification`, `Inspection`, `FoodSafetyIncident`, `NutritionProfile`, `Relationship`, `GraphNode`, `GraphEdge`, `EntityVersion`), and the `/api/v1/food-domain/*` route surface. It builds on the M1 foundation (`@eks/common`, `@eks/events`, `@eks/observability`, `@eks/cache`, `@eks/security`, `@eks/api`, `@eks/workers`, `@eks/domain`), the M2 IAM stack (`@eks/auth`, `@eks/authorization`, `@eks/organizations`), the M3 developer platform (`@eks/sdk`, `@eks/connector-sdk`, `@eks/runtime`, `@eks/registry`, `@eks/workflow`), and the M4 Universal Connector Platform (`@eks/integration`).

---

## 1. Goals & Non-Goals

### Goals
- Establish **one canonical domain model** for every food-domain concept in Eks-Food: the people who cook, the people who eat, the places food is prepared, the food itself (ingredients, recipes, menus), the logistics that move it (inventory, equipment, vehicles), the businesses that supply it (suppliers, vendors), and the safety & nutrition knowledge graph around all of it.
- Make **every canonical entity** globally identifiable (UUID v4), tenant-isolated (`organizationId`), lifecycle-tracked (state machines), audited (`createdAt`, `updatedAt`, `deletedAt`, `createdBy`, `updatedBy`), and version-tracked (via the `EntityVersion` table).
- Make **every cross-entity connection** explicit through the `Relationship` table and the `GraphNode` / `GraphEdge` Food Intelligence Graph projection, so that no domain relationship is hidden in ad-hoc JSON columns or application code.
- Make **every canonical entity** addressable via a stable `/api/v1/food-domain/{entity}/{id}` REST route, indexed for full-text and faceted search, and exportable/importable as JSON-LD for federated data exchange with the M4 connector platform.
- Make the canonical model **migration-safe**: the schema is normalized to 3NF in Prisma, with a thin graph projection (`GraphNode` / `GraphEdge`) that can later be promoted to a native graph database (Neo4j, ArangoDB) without rewriting domain logic.

### Non-Goals
- **Replacing the M1 `@eks/domain` bounded contexts.** The `cook`, `customer`, `restaurant`, `inventory`, `vendor`, `supplier`, `safety`, `procurement`, `foodgraph` contexts remain the source of truth for aggregate-root invariants. The M6 `@eks/food-domain` package adds the *canonical persistence* layer, the *graph projection*, and the *search index* on top.
- **Re-implementing IAM.** All `createdBy` / `updatedBy` fields reference M2 `User` rows; all `organizationId` fields reference M2 `Organization` rows; all permission checks delegate to the M2 `@eks/authorization` engine (see `docs/identity/AUTHORIZATION_POLICIES.md`).
- **Re-implementing payments, scheduling, or webhooks.** Food-domain transactions continue to flow through Payswap (`docs/PAYMENTS.md`); supply-chain webhooks continue to flow through the M4 `WebhookEndpoint` / `WebhookDelivery` tables; cross-system sync continues to flow through the M4 `SynchronizationJob`.
- **A fully-normalized nutrition database.** The `NutritionProfile` entity captures *per-entity* nutrition snapshots (per ingredient, per recipe, per menu item); it is not a food-composition database. Reference food-composition data (USDA, West African Food Composition Table) is loaded via M4 connectors into `Ingredient` rows.

---

## 2. Entity Inventory

The canonical M6 schema adds **26 Prisma models** in the `food-domain` namespace. They are grouped into seven clusters:

| # | Cluster | Entities |
|---|---|---|
| 1 | **Geography** | `Country`, `Region`, `City`, `Neighborhood` |
| 2 | **People & Households** | `Household`, `CustomerProfile`, `CookProfile` |
| 3 | **Food Service Outlets** | `Restaurant`, `Kitchen` |
| 4 | **Food Knowledge** | `Ingredient`, `Recipe`, `RecipeIngredient`, `Menu`, `MenuItem`, `NutritionProfile` |
| 5 | **Inventory & Logistics** | `Inventory`, `InventoryBatch`, `Equipment`, `Vehicle` |
| 6 | **Supply Chain** | `Supplier`, `Vendor` |
| 7 | **Safety & Compliance** | `Certification`, `Inspection`, `FoodSafetyIncident` |
| 8 | **Graph & Versioning (cross-cutting)** | `Relationship`, `GraphNode`, `GraphEdge`, `EntityVersion` |

All entities are multi-tenant (the `organizationId` column is non-null except for the global `Country` and `Ingredient` reference data, which are tenant-shared). All entities use UUID primary keys (`String @id @default(uuid())` in Prisma). All entities carry the canonical audit metadata block (see `CANONICAL_DATA_STANDARDS.md` §3).

---

## 3. Geography Cluster

### 3.1 Country
The top-level geopolitical unit. **Tenant-shared** (no `organizationId`) — countries are global reference data seeded from ISO 3166-1.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `iso2` | `String` | ISO 3166-1 alpha-2 (e.g. `"GH"`). Unique. |
| `iso3` | `String` | ISO 3166-1 alpha-3 (e.g. `"GHA"`). Unique. |
| `name` | `JSON` | Localized name (`{ "en": "Ghana", "fr": "Ghana", "sw": "Ghana" }`). |
| `currency` | `String` | ISO 4217 code (`"GHS"`). |
| `phonePrefix` | `String` | E.164 prefix (`"+233"`). |
| `timezone` | `String` | IANA zone (`"Africa/Accra"`). |
| `active` | `Boolean` | Soft-disable without deletion. |
| `metadata` | `JSON` | Extensible. |

**Lifecycle:** `DRAFT` → `ACTIVE` → `DEPRECATED`. Transitions are audited. Countries are never hard-deleted; deprecated countries remain referenceable from existing regions and addresses.

**Relationships:** A country `contains` many `Region`s (1:N). The `contains` edge is mirrored in `Relationship` (type `"contains"`, fromType `"Country"`, toType `"Region"`).

### 3.2 Region
First-level administrative subdivision (state, province, region).

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `countryId` | `UUID` | FK → `Country.id`. |
| `code` | `String` | ISO 3166-2 (e.g. `"GH-AH"` for Ashanti). |
| `name` | `JSON` | Localized. |
| `center` | `JSON` | `{ lat, lng }` centroid. |
| `active` | `Boolean` | |
| `metadata` | `JSON` | |

**Lifecycle:** Same as `Country`. **Relationships:** `member_of` `Country` (N:1); `contains` `City` (1:N).

### 3.3 City
Second-level administrative subdivision.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `regionId` | `UUID` | FK → `Region.id`. |
| `name` | `JSON` | Localized. |
| `population` | `Int?` | Latest census estimate. |
| `center` | `JSON` | `{ lat, lng }`. |
| `timezone` | `String?` | Overrides country default. |
| `active` | `Boolean` | |
| `metadata` | `JSON` | |

**Lifecycle:** `DRAFT` → `ACTIVE` → `DEPRECATED`. **Relationships:** `member_of` `Region`; `contains` `Neighborhood`.

### 3.4 Neighborhood
The finest geographic unit used for matching, dispatch, and demand signals.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `cityId` | `UUID` | FK → `City.id`. |
| `name` | `JSON` | Localized. |
| `boundary` | `JSON` | GeoJSON Polygon (WGS84). |
| `center` | `JSON` | `{ lat, lng }`. |
| `postalCode` | `String?` | |
| `active` | `Boolean` | |
| `metadata` | `JSON` | |

**Relationships:** `member_of` `City`. Neighborhoods are the unit at which `DemandSignal` (M1) is aggregated, and at which `CookAvailability` and `Booking` dispatch zones are computed.

---

## 4. People & Households Cluster

### 4.1 Household
A group of one or more people who eat together regularly. Households are the unit for meal planning, shared favorites, and family-style bookings.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `name` | `String` | Display name (e.g. `"The Boateng Family"`). |
| `size` | `Int` | Number of members (denormalized from `Relationship`). |
| `primaryContactId` | `UUID?` | FK → `User.id` (M2). |
| `preferredCuisines` | `JSON` | `["west-african", "levantine"]`. |
| `dietaryRestrictions` | `JSON` | `["halal", "vegetarian"]`. |
| `defaultAddressId` | `UUID?` | FK → `Address.id` (M1). |
| `state` | `Enum` | `ACTIVE`, `SUSPENDED`, `DISSOLVED`. |
| `metadata` | `JSON` | |

**Lifecycle:**
```
                ┌──────────┐
                │  (none)  │
                └────┬─────┘
                     │ create (operator or self-serve)
                     ▼
                ┌──────────┐  suspend (policy violation, audit)
                │  ACTIVE  │◀─────────────┐
                └────┬─────┘              │
                     │ dissolve           │ reinstate
                     ▼                    │
                ┌──────────┐──────────────┘
                │ DISSOLVED│   (terminal; soft-deleted via deletedAt)
                └──────────┘
```
**Relationships:** `member_of` `CustomerProfile` (1:N, each member has a `householdId`). `Household` `located_in` `Neighborhood` (N:1).

### 4.2 CustomerProfile
The canonical profile of an eater. Wraps and extends the M1 `Customer` table.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `userId` | `UUID` | FK → `User.id` (M2). Unique per tenant. |
| `organizationId` | `UUID` | Tenant. |
| `displayName` | `String` | |
| `avatarUrl` | `String?` | |
| `householdId` | `UUID?` | FK → `Household.id`. |
| `defaultAddressId` | `UUID?` | FK → `Address.id`. |
| `preferredLanguage` | `String` | BCP-47 (`"en-GH"`). |
| `allergens` | `JSON` | `["peanut", "shellfish"]`. |
| `dietaryRestrictions` | `JSON` | `["halal", "vegetarian"]`. |
| `favoriteCuisine` | `String?` | `CuisineCode`. |
| `loyaltyTier` | `String?` | `"bronze"`, `"silver"`, `"gold"`. |
| `state` | `Enum` | `ACTIVE`, `SUSPENDED`, `DEACTIVATED`. |
| `metadata` | `JSON` | |

**Relationships:** `member_of` `Household` (N:1, optional). `follows` `CookProfile` (N:M, modeled via `Relationship` with type `"follows"`). `lives_in` `Neighborhood` (N:1). `books` `Booking` (M1).

### 4.3 CookProfile
The canonical profile of a cook. Wraps and extends the M1 `Cook` table; adds M6 graph projection.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `userId` | `UUID` | FK → `User.id`. |
| `organizationId` | `UUID` | Tenant. |
| `displayName` | `String` | |
| `bio` | `JSON` | Localized short biography. |
| `avatarUrl` | `String?` | |
| `cuisines` | `JSON` | `CuisineCode[]`. |
| `specialties` | `JSON` | `Recipe.id[]` or free-text. |
| `yearsExperience` | `Int` | |
| `verifiedAt` | `DateTime?` | Set by M2 `VerificationRequest`. |
| `ratingAverage` | `Float` | Denormalized; updated by event subscriber. |
| `ratingCount` | `Int` | |
| `defaultKitchenId` | `UUID?` | FK → `Kitchen.id`. |
| `state` | `Enum` | `ONBOARDING`, `ACTIVE`, `SUSPENDED`, `DEACTIVATED`. |
| `metadata` | `JSON` | |

**Lifecycle:**
```
            ┌─────────────┐
            │  ONBOARDING │  (profile created, documents pending)
            └──────┬──────┘
                   │ verification complete + first kitchen assigned
                   ▼
            ┌─────────────┐  suspend (policy/safety violation)
            │   ACTIVE    │◀─────────────┐
            └──────┬──────┘              │ reinstate (after review)
                   │ deactivate (self/ops)
                   ▼                     │
            ┌─────────────┐──────────────┘
            │ DEACTIVATED │  (terminal; soft-deleted)
            └─────────────┘
```
**Relationships:** `works_at` `Kitchen` (N:M, modeled via `Relationship`). `certified_by` `Certification` (1:N). `inspected_by` `Inspection` (1:N, via `subjectType = "CookProfile"`). `authors` `Recipe` (1:N). `operates` `Restaurant` (N:M, owner/chef).

---

## 5. Food Service Outlets Cluster

### 5.1 Restaurant
A food-service business. May operate one or more `Kitchen`s.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `name` | `JSON` | Localized. |
| `legalName` | `String` | Registered name. |
| `taxId` | `String?` | |
| `cuisines` | `JSON` | `CuisineCode[]`. |
| `priceRange` | `Enum` | `$`, `$$`, `$$$`, `$$$$`. |
| `ratingAverage` | `Float` | |
| `ratingCount` | `Int` | |
| `ownerCookProfileId` | `UUID?` | FK → `CookProfile.id`. |
| `addressId` | `UUID?` | FK → `Address.id`. |
| `neighborhoodId` | `UUID?` | FK → `Neighborhood.id`. |
| `state` | `Enum` | `ONBOARDING`, `ACTIVE`, `SUSPENDED`, `CLOSED`. |
| `metadata` | `JSON` | |

**Relationships:** `operates` `Kitchen` (1:N). `member_of` `Neighborhood` (N:1). `serves` `Menu` (1:N). `certified_by` `Certification` (1:N). `inspected_by` `Inspection` (1:N).

### 5.2 Kitchen
A physical or virtual food-preparation facility. Kitchens are where cooks work and where food is produced.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `restaurantId` | `UUID?` | FK → `Restaurant.id` (nullable for freelance kitchens). |
| `name` | `String` | |
| `kind` | `Enum` | `RESTAURANT`, `GHOST`, `HOME`, `CENTRAL`, `POPUP`. |
| `addressId` | `UUID?` | FK → `Address.id`. |
| `neighborhoodId` | `UUID?` | FK → `Neighborhood.id`. |
| `capacity` | `Int?` | Meals per service. |
| `operatingHours` | `JSON` | `{ "mon": { "open": "08:00", "close": "22:00" }, ... }`. |
| `equipmentIds` | `JSON` | `Equipment.id[]` (denormalized). |
| `state` | `Enum` | `ONBOARDING`, `ACTIVE`, `MAINTENANCE`, `DECOMMISSIONED`. |
| `metadata` | `JSON` | |

**Lifecycle:** `ONBOARDING` → `ACTIVE` → `MAINTENANCE` ⇄ `ACTIVE` → `DECOMMISSIONED`. **Relationships:** `operated_by` `Restaurant` (N:1, optional). `works_at` `CookProfile` (M:N). `contains` `Equipment` (1:N). `stocks` `Inventory` (1:1, each kitchen has exactly one `Inventory`). `inspected_by` `Inspection` (1:N, via `subjectType = "Kitchen"`). `produces` `MenuItem` (1:N).

---

## 6. Food Knowledge Cluster

### 6.1 Ingredient
The atomic unit of food. **Tenant-shared** (no `organizationId`) — ingredients are global reference data, loaded from food-composition connectors (USDA, WAFOCT) and enriched by operators.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `name` | `JSON` | Localized: `{ "en": "Tomato", "sw": "Nyanya", "fr": "Tomate" }`. |
| `aliases` | `JSON` | `["Solanum lycopersicum", "Tomato (red)"]`. |
| `category` | `String` | Branded `IngredientCategory`: `"grain"`, `"protein"`, `"vegetable"`, `"spice"`, `"fruit"`, `"dairy"`, `"fat"`, `"sweetener"`, `"beverage"`, `"condiment"`. |
| `subsystem` | `String?` | Botanical/taxonomic (e.g. `"Solanaceae"`). |
| `nutritionProfileId` | `UUID?` | FK → `NutritionProfile.id`. |
| `allergenFlags` | `JSON` | `["gluten", "soy"]`. |
| `dietaryFlags` | `JSON` | `["vegan", "halal", "kosher"]`. |
| `imageUrl` | `String?` | |
| `deprecated` | `Boolean` | Soft-deprecate without removal. |
| `metadata` | `JSON` | |

**Relationships:** `contains` `Recipe` (M:N, via `RecipeIngredient`). `supplied_by` `Supplier` (M:N, via `Relationship` type `"supplies"`). `substituted_by` `Ingredient` (M:N, via `Relationship` type `"substitutes"`).

### 6.2 Recipe
An ordered procedure that combines ingredients into a dish.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID?` | Null for platform-curated global recipes. |
| `authorCookProfileId` | `UUID?` | FK → `CookProfile.id`. |
| `title` | `JSON` | Localized. |
| `description` | `JSON` | Localized. |
| `cuisine` | `String` | `CuisineCode`. |
| `course` | `String?` | `"breakfast"`, `"lunch"`, `"dinner"`, `"snack"`, `"dessert"`, `"beverage"`. |
| `servings` | `Int` | Default 4. |
| `totalDurationMinutes` | `Int` | Sum of step durations. |
| `difficulty` | `Enum` | `EASY`, `MEDIUM`, `HARD`. |
| `steps` | `JSON` | `RecipeStep[]` (sequence, instruction, duration, equipment). |
| `nutritionPerServingId` | `UUID?` | FK → `NutritionProfile.id`. |
| `imageUrl` | `String?` | |
| `publishedAt` | `DateTime?` | |
| `state` | `Enum` | `DRAFT`, `PUBLISHED`, `DEPRECATED`. |
| `metadata` | `JSON` | |

**Lifecycle:**
```
            ┌────────┐  publish (reviewer approval)
            │ DRAFT  │──────────────▶┌───────────┐
            └────────┘               │ PUBLISHED │
                                     └─────┬─────┘
                                           │ deprecate
                                           ▼
                                     ┌───────────┐
                                     │ DEPRECATED│
                                     └───────────┘
```
**Relationships:** `authored_by` `CookProfile` (N:1). `contains` `Ingredient` (M:N, via `RecipeIngredient`). `featured_in` `MenuItem` (1:N).

### 6.3 RecipeIngredient
The junction table that connects `Recipe` to `Ingredient` with quantity and preparation metadata.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `recipeId` | `UUID` | FK → `Recipe.id`. |
| `ingredientId` | `UUID` | FK → `Ingredient.id`. |
| `quantity` | `Float` | Numeric amount. |
| `unit` | `String` | `"g"`, `"ml"`, `"tbsp"`, `"clove"`, `"pinch"`. |
| `preparation` | `String?` | `"diced"`, `"minced"`, `"julienne"`. |
| `optional` | `Boolean` | Default `false`. |
| `position` | `Int` | Order in the recipe's ingredient list. |
| `metadata` | `JSON` | |

**Relationships:** `Recipe` (N:1), `Ingredient` (N:1). The `contains` edge between `Recipe` and `Ingredient` is mirrored in `Relationship` (type `"contains"`, with `fromType="Recipe"`, `toType="Ingredient"`, and `weight=quantity` in `properties`).

### 6.4 Menu
A curated collection of `MenuItem`s offered by a `Restaurant` or `CookProfile` for a period.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `ownerType` | `Enum` | `RESTAURANT`, `COOK`, `HOUSEHOLD`. |
| `ownerId` | `UUID` | FK → `Restaurant.id` or `CookProfile.id` or `Household.id`. |
| `name` | `JSON` | Localized. |
| `description` | `JSON` | |
| `validFrom` | `DateTime` | |
| `validUntil` | `DateTime?` | Null = open-ended. |
| `active` | `Boolean` | |
| `metadata` | `JSON` | |

**Relationships:** `owned_by` `Restaurant` / `CookProfile` / `Household` (polymorphic). `contains` `MenuItem` (1:N).

### 6.5 MenuItem
A single bookable / orderable item on a `Menu`, usually backed by a `Recipe`.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `menuId` | `UUID` | FK → `Menu.id`. |
| `recipeId` | `UUID?` | FK → `Recipe.id` (null for composite items). |
| `name` | `JSON` | Localized. |
| `description` | `JSON` | |
| `price` | `Decimal` | Currency from `Country.currency`. |
| `currency` | `String` | ISO 4217. |
| `portionSize` | `String?` | `"small"`, `"regular"`, `"large"`. |
| `available` | `Boolean` | |
| `nutritionProfileId` | `UUID?` | FK → `NutritionProfile.id`. |
| `position` | `Int` | Display order. |
| `metadata` | `JSON` | |

**Relationships:** `member_of` `Menu` (N:1). `derived_from` `Recipe` (N:1). `produced_at` `Kitchen` (N:1, optional).

### 6.6 NutritionProfile
Per-entity nutrition snapshot. Attached to `Ingredient`, `Recipe`, or `MenuItem`.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `subjectType` | `Enum` | `INGREDIENT`, `RECIPE`, `MENU_ITEM`. |
| `subjectId` | `UUID` | FK to the relevant entity. |
| `basis` | `Enum` | `PER_100G`, `PER_SERVING`, `PER_PORTION`. |
| `energyKcal` | `Float` | |
| `proteinG` | `Float` | |
| `carbohydrateG` | `Float` | |
| `fatG` | `Float` | |
| `fibreG` | `Float` | |
| `sugarG` | `Float` | |
| `sodiumMg` | `Float` | |
| `micronutrients` | `JSON` | `{ "iron_mg": 2.4, "vitA_ug": 89, ... }`. |
| `allergens` | `JSON` | `["milk", "gluten"]`. |
| `source` | `String` | `"USDA-FDC"`, `"WAFOCT"`, `"lab-XYZ"`, `"computed"`. |
| `sourceVersion` | `String` | Schema version of the source. |
| `computedAt` | `DateTime` | When the snapshot was computed/loaded. |
| `metadata` | `JSON` | |

---

## 7. Inventory & Logistics Cluster

### 7.1 Inventory
The stock-keeping container for a single `Kitchen`. One kitchen = one inventory.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `kitchenId` | `UUID` | FK → `Kitchen.id`. Unique. |
| `name` | `String` | Display name. |
| `valuationMethod` | `Enum` | `FIFO`, `LIFO`, `WAC`. |
| `lastReconciledAt` | `DateTime?` | |
| `metadata` | `JSON` | |

**Relationships:** `stocks` `InventoryBatch` (1:N). `stocked_at` `Kitchen` (1:1).

### 7.2 InventoryBatch
A single lot/batch of an ingredient in an inventory.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `inventoryId` | `UUID` | FK → `Inventory.id`. |
| `ingredientId` | `UUID` | FK → `Ingredient.id`. |
| `supplierId` | `UUID?` | FK → `Supplier.id`. |
| `batchCode` | `String` | Supplier-provided lot code. |
| `quantityOnHand` | `Decimal` | Current quantity. |
| `unit` | `String` | `"g"`, `"kg"`, `"L"`, `"each"`. |
| `quantityReceived` | `Decimal` | Original received quantity. |
| `unitCost` | `Decimal` | Currency from supplier. |
| `currency` | `String` | |
| `receivedAt` | `DateTime` | |
| `expiresAt` | `DateTime?` | Null = non-perishable. |
| `bestBeforeAt` | `DateTime?` | |
| `state` | `Enum` | `ON_HAND`, `RESERVED`, `DEPLETED`, `DISCARDED`, `RETURNED`. |
| `metadata` | `JSON` | |

**Lifecycle:** `ON_HAND` → `RESERVED` (allocated to an order) → `DEPLETED` (consumed) or `DISCARDED` (spoilage) or `RETURNED` (to supplier). **Relationships:** `member_of` `Inventory` (N:1). `supplied_by` `Supplier` (N:1). `contains` `Ingredient` (N:1).

### 7.3 Equipment
A piece of kitchen equipment (stove, blender, walk-in fridge, delivery bike).

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `kitchenId` | `UUID?` | FK → `Kitchen.id` (null = in transit / warehouse). |
| `name` | `String` | |
| `kind` | `Enum` | `STOVE`, `OVEN`, `FRIDGE`, `BLENDER`, `MIXER`, `DELIVERY_BIKE`, `DELIVERY_VAN`, `THERMOMETER`, `OTHER`. |
| `serialNumber` | `String?` | |
| `manufacturer` | `String?` | |
| `modelNumber` | `String?` | |
| `acquiredAt` | `DateTime?` | |
| `purchaseValue` | `Decimal?` | |
| `currency` | `String?` | |
| `state` | `Enum` | `OPERATIONAL`, `NEEDS_REPAIR`, `UNDER_REPAIR`, `RETIRED`. |
| `metadata` | `JSON` | |

**Relationships:** `located_at` `Kitchen` (N:1, optional). `requires` `RecipeStep.equipment` (M:N, by `kind`).

### 7.4 Vehicle
A vehicle used for delivery or procurement.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `registration` | `String` | License plate. Unique per country. |
| `kind` | `Enum` | `MOTORCYCLE`, `CAR`, `VAN`, `TRUCK`, `BICYCLE`. |
| `capacityKg` | `Float` | |
| `ownerType` | `Enum` | `RESTAURANT`, `COOK`, `VENDOR`, `PLATFORM`. |
| `ownerId` | `UUID` | |
| `assignedDriverId` | `UUID?` | FK → `User.id`. |
| `state` | `Enum` | `AVAILABLE`, `IN_USE`, `MAINTENANCE`, `DECOMMISSIONED`. |
| `metadata` | `JSON` | |

**Relationships:** `operated_by` `Restaurant` / `CookProfile` / `Vendor` (polymorphic). `delivers` `Booking` (M1, 1:N).

---

## 8. Supply Chain Cluster

### 8.1 Supplier
A business that supplies raw ingredients to kitchens (wholesaler, farm, distributor).

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `name` | `String` | |
| `legalName` | `String` | |
| `taxId` | `String?` | |
| `addressId` | `UUID?` | FK → `Address.id`. |
| `neighborhoodId` | `UUID?` | FK → `Neighborhood.id`. |
| `contactUserId` | `UUID?` | FK → `User.id`. |
| `ratingAverage` | `Float` | |
| `ratingCount` | `Int` | |
| `paymentTerms` | `String?` | `"net-30"`, `"cod"`, etc. |
| `state` | `Enum` | `ONBOARDING`, `ACTIVE`, `SUSPENDED`, `DEACTIVATED`. |
| `metadata` | `JSON` | |

**Relationships:** `supplies` `Ingredient` (M:N). `supplies` `Kitchen` (M:N, via `Relationship` type `"supplies_to"`). `certified_by` `Certification` (1:N). `inspected_by` `Inspection` (1:N).

### 8.2 Vendor
A business that sells prepared food or non-food goods on the platform (a marketplace seller distinct from a `Supplier` of raw ingredients).

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `name` | `String` | |
| `legalName` | `String` | |
| `taxId` | `String?` | |
| `kind` | `Enum` | `PACKAGED_GOODS`, `EQUIPMENT`, `KITCHEN_SUPPLIES`, `OTHER`. |
| `addressId` | `UUID?` | FK → `Address.id`. |
| `contactUserId` | `UUID?` | FK → `User.id`. |
| `ratingAverage` | `Float` | |
| `ratingCount` | `Int` | |
| `state` | `Enum` | `ONBOARDING`, `ACTIVE`, `SUSPENDED`, `DEACTIVATED`. |
| `metadata` | `JSON` | |

**Relationships:** `supplies` `Equipment` (M:N). `certified_by` `Certification` (1:N). `partner_of` `Restaurant` (M:N, via `Relationship`).

> **Supplier vs Vendor.** `Supplier` sells raw `Ingredient`s into kitchens (B2B, into `InventoryBatch`). `Vendor` sells finished goods to operators or end customers (B2C/B2B, into orders). The two are never conflated.

---

## 9. Safety & Compliance Cluster

### 9.1 Certification
A credential awarded to a `CookProfile`, `Kitchen`, `Restaurant`, `Supplier`, or `Vendor` by an issuing authority (government, HACCP body, culinary school).

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `subjectType` | `Enum` | `COOK`, `KITCHEN`, `RESTAURANT`, `SUPPLIER`, `VENDOR`. |
| `subjectId` | `UUID` | FK to the relevant entity. |
| `kind` | `Enum` | `FOOD_SAFETY_LEVEL_1`, `FOOD_SAFETY_LEVEL_2`, `HACCP`, `SERVSAFE`, `HALAL`, `KOSHER`, `BUSINESS_LICENSE`, `CULINARY_DIPLOMA`, `OTHER`. |
| `issuer` | `String` | Issuing authority name. |
| `issuerCountryId` | `UUID?` | FK → `Country.id`. |
| `issuedAt` | `DateTime` | |
| `expiresAt` | `DateTime?` | Null = non-expiring. |
| `certificateNumber` | `String` | |
| `documentUrl` | `String?` | |
| `state` | `Enum` | `PENDING`, `ACTIVE`, `EXPIRED`, `REVOKED`. |
| `metadata` | `JSON` | |

**Lifecycle:** `PENDING` (uploaded, awaiting verification) → `ACTIVE` (verified by M2 `VerificationRequest`) → `EXPIRED` (past `expiresAt`) or `REVOKED` (issuer withdrawal). A daily scheduled job transitions `ACTIVE → EXPIRED` 30 days before `expiresAt` and emits a `food-domain.certification.expiring.v1` event.

### 9.2 Inspection
A formal inspection of a `CookProfile`, `Kitchen`, `Restaurant`, `Supplier`, or `Vendor`. Mirrors the M1 `safety` bounded context `InspectionAggregate`.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `subjectType` | `Enum` | `COOK`, `KITCHEN`, `RESTAURANT`, `SUPPLIER`, `VENDOR`. |
| `subjectId` | `UUID` | |
| `inspectorId` | `UUID` | FK → `User.id`. |
| `kind` | `Enum` | `ROUTINE`, `COMPLAINT`, `FOLLOW_UP`, `PRE_OPENING`. |
| `scheduledFor` | `DateTime` | |
| `startedAt` | `DateTime?` | |
| `completedAt` | `DateTime?` | |
| `outcome` | `Enum?` | `PASS`, `PASS_WITH_FINDINGS`, `FAIL`, `INCONCLUSIVE`. |
| `score` | `Float?` | 0–100. |
| `findings` | `JSON` | `Finding[]` (severity, description, remediation). |
| `reportUrl` | `String?` | |
| `state` | `Enum` | `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`. |
| `metadata` | `JSON` | |

### 9.3 FoodSafetyIncident
A recorded food-safety incident: illness report, recall, contamination event.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID` | Tenant. |
| `subjectType` | `Enum` | `INGREDIENT`, `RECIPE`, `MENU_ITEM`, `KITCHEN`, `RESTAURANT`, `COOK`, `SUPPLIER`, `VENDOR`, `INVENTORY_BATCH`. |
| `subjectId` | `UUID` | |
| `reportedBy` | `UUID` | FK → `User.id`. |
| `reportedAt` | `DateTime` | |
| `severity` | `Enum` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. |
| `category` | `Enum` | `ALLERGEN_UNDECLARED`, `CONTAMINATION`, `SPOILAGE`, `FOREIGN_OBJECT`, `ILLNESS_REPORT`, `RECALL`, `OTHER`. |
| `description` | `JSON` | Localized. |
| `affectedBatchIds` | `JSON` | `InventoryBatch.id[]`. |
| `affectedCustomerIds` | `JSON` | `User.id[]`. |
| `resolution` | `JSON?` | `{ "action": "recall", "completedAt": "...", "actor": "..." }`. |
| `state` | `Enum` | `OPEN`, `INVESTIGATING`, `RESOLVED`, `CLOSED`. |
| `metadata` | `JSON` | |

**Lifecycle:** `OPEN` → `INVESTIGATING` → `RESOLVED` → `CLOSED`. Critical incidents emit `food-domain.safety.incident.critical.v1` to the M1 `EventOutbox`; subscribers include the M2 `@eks/notifications` (operator alert) and the M4 connector platform (regulatory webhook to government systems).

---

## 10. Cross-Cutting: Graph & Versioning

### 10.1 Relationship
The canonical polymorphic relationship table — the *operational* graph store. Every cross-entity connection in §3–§9 has a corresponding `Relationship` row.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID?` | Null for tenant-shared relationships (e.g. `Country contains Region`). |
| `fromType` | `String` | Entity type name (e.g. `"CookProfile"`). |
| `fromId` | `UUID` | |
| `toType` | `String` | |
| `toId` | `UUID` | |
| `type` | `String` | Edge type: `member_of`, `works_at`, `contains`, `supplies`, `supplies_to`, `inspects`, `certified_by`, `follows`, `operates`, `located_in`, `authored_by`, `featured_in`, `derived_from`, `substitutes`, `partner_of`, `stocks`, `stocked_at`, `lives_in`, `operated_by`, `owned_by`, `produces`, `produced_at`, `requires`. |
| `properties` | `JSON` | Edge attributes (e.g. `{ "weight": 200, "unit": "g" }` for `Recipe contains Ingredient`). |
| `validFrom` | `DateTime` | Edge becomes effective. |
| `validUntil` | `DateTime?` | Null = open-ended. Enables temporal queries. |
| `state` | `Enum` | `ACTIVE`, `SUPERSEDED`, `DELETED`. |
| `version` | `Int` | Optimistic concurrency. |
| `metadata` | `JSON` | |

**Indexes:** Composite `(fromType, fromId, type, state)`, `(toType, toId, type, state)`, `(organizationId, type, state)`. The `Relationship` table is the **write-optimized** store; the `GraphEdge` table (§10.3) is the **read-optimized** projection used by graph traversal queries.

### 10.2 GraphNode
The **read-optimized** node projection used by graph traversal. One row per `(entityType, entityId)` pair. Rebuilt from the entity tables by the `GraphProjectionWorker`.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID?` | |
| `entityType` | `String` | `"CookProfile"`, `"Ingredient"`, etc. |
| `entityId` | `UUID` | FK to the source entity. |
| `label` | `String` | Display label (denormalized from `name` / `displayName` / `title`). |
| `properties` | `JSON` | Subset of entity fields used by traversal filters (e.g. `cuisine`, `state`, `category`). |
| `tags` | `JSON` | `["protein", "halal"]` — denormalized for fast filtering. |
| `degreeIn` | `Int` | Denormalized incoming edge count. |
| `degreeOut` | `Int` | Denormalized outgoing edge count. |
| `lastSyncedAt` | `DateTime` | When the projection was last refreshed. |
| `metadata` | `JSON` | |

**Unique index:** `(entityType, entityId)`.

### 10.3 GraphEdge
The **read-optimized** edge projection. One row per active `Relationship`.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID?` | |
| `relationshipId` | `UUID` | FK → `Relationship.id`. |
| `fromNodeId` | `UUID` | FK → `GraphNode.id`. |
| `toNodeId` | `UUID` | FK → `GraphNode.id`. |
| `type` | `String` | Edge type (same vocabulary as `Relationship.type`). |
| `weight` | `Float?` | Numeric weight for shortest-path & ranking (e.g. quantity, trust score). |
| `properties` | `JSON` | Edge attributes. |
| `validFrom` | `DateTime` | |
| `validUntil` | `DateTime?` | |
| `state` | `Enum` | `ACTIVE`, `SUPERSEDED`, `DELETED`. |
| `lastSyncedAt` | `DateTime` | |

**Indexes:** `(fromNodeId, type, state)`, `(toNodeId, type, state)`, `(organizationId, type, state)`.

### 10.4 EntityVersion
Audit-version table. Every mutating operation on a canonical entity writes an `EntityVersion` row containing the full entity snapshot (or diff) at that version.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID?` | |
| `entityType` | `String` | `"Ingredient"`, `"Recipe"`, etc. |
| `entityId` | `UUID` | FK to the source entity. |
| `version` | `Int` | Monotonic per entity. |
| `snapshot` | `JSON` | Full entity JSON at this version. |
| `diff` | `JSON?` | Field-level diff vs previous version (for compact storage). |
| `operation` | `Enum` | `CREATE`, `UPDATE`, `STATE_TRANSITION`, `SOFT_DELETE`, `RESTORE`. |
| `actorId` | `UUID` | FK → `User.id`. |
| `reason` | `String?` | Free-text rationale (e.g. `"HACCP re-inspection pass"`). |
| `changedAt` | `DateTime` | |
| `metadata` | `JSON` | |

**Indexes:** `(entityType, entityId, version)`, `(organizationId, changedAt)`. Entity versions are retained for the duration mandated by the tenant's data-retention policy (default 7 years for safety/compliance entities, 2 years for operational entities).

---

## 11. Entity Ownership & Tenant Isolation

Every canonical entity is owned by exactly one tenant (`organizationId`), with three exceptions:

1. **`Country`** — tenant-shared, seeded from ISO 3166-1.
2. **`Ingredient`** — tenant-shared global reference data. Tenants may *extend* ingredients with private metadata via the `IngredientTenantExtension` view (a tenant-scoped join on `Ingredient.id` + `organizationId`), but the canonical `Ingredient` row is shared.
3. **`Recipe`** with `organizationId = null` — platform-curated global recipes (e.g. the Eks-Food canonical Jollof Rice recipe). Tenants may fork these into private recipes via `fork_from` relationships.

Tenant isolation is enforced at three layers:

1. **Database layer.** Every query through the `@eks/food-domain` repository passes through the M2 `@eks/authorization` tenant filter (see `docs/identity/MULTI_TENANCY.md`). The `organizationId` column is indexed on every multi-tenant table; queries that omit the filter are rejected at the repository layer.
2. **API layer.** Every `/api/v1/food-domain/*` route handler runs the M2 `requireTenantContext` middleware, which extracts `organizationId` from the authenticated session and injects it into every repository call.
3. **Audit layer.** Every mutating operation logs to the M2 `AuditLog` with `organizationId`, `actorId`, `entityType`, `entityId`, `operation`, and a redacted `payload`. The audit log is queryable but immutable (see `docs/identity/AUDIT_AND_COMPLIANCE.md`).

Cross-tenant references are forbidden at the database level via composite unique constraints (e.g. `(organizationId, entityId)` on `EntityVersion`); a write that would create a cross-tenant relationship is rejected by the repository and surfaced as an RFC 7807 `403` `cross-tenant-violation` error (see `API_DOCUMENTATION.md` §9).

---

## 12. Versioning & Audit

Every canonical entity has a `version: Int` column (optimistic concurrency) and the standard audit metadata block (`createdAt`, `updatedAt`, `deletedAt`, `createdBy`, `updatedBy`, `deletedBy`). On every write:

1. The repository increments `version` and writes a new `EntityVersion` row (full snapshot + diff + operation + actor + reason).
2. The repository emits a `food-domain.{entity}.{operation}.v1` event to the M1 `EventOutbox` (subscribers include the `GraphProjectionWorker`, the `SearchIndexWorker`, and the M2 `@eks/notifications`).
3. The repository writes an `AuditLog` row via the M2 `@eks/observability` audit API.

Version recovery: `GET /api/v1/food-domain/{entity}/{id}/versions` returns the full version history; `GET /api/v1/food-domain/{entity}/{id}/versions/{v}` returns the snapshot at version `v`. `POST /api/v1/food-domain/{entity}/{id}/versions/{v}/restore` rolls the entity back to version `v` (creating a new version with `operation = RESTORE`).

---

## 13. See Also

- `CANONICAL_DATA_STANDARDS.md` — naming conventions, audit metadata, lifecycle state patterns, localization.
- `ENTITY_RELATIONSHIPS.md` — every relationship type with cardinality and ASCII diagram.
- `GRAPH_ARCHITECTURE.md` — `GraphNode` / `GraphEdge` storage abstraction, traversal, temporal queries, snapshots.
- `GRAPH_QUERY_GUIDE.md` — TypeScript examples for BFS, shortest-path, neighborhood, dependency analysis.
- `API_DOCUMENTATION.md` — full REST API reference for `/api/v1/food-domain/*`.
- `SEARCH_ARCHITECTURE.md` — full-text, faceted, fuzzy, multilingual search over canonical entities.
- `OPERATIONAL_RUNBOOKS.md` — graph size monitoring, latency SLOs, import/export, recovery.
- `docs/identity/MULTI_TENANCY.md` — tenant isolation model.
- `docs/identity/AUDIT_AND_COMPLIANCE.md` — audit log retention and querying.
- `docs/integration/SCHEMA_REGISTRY_GUIDE.md` — schema versioning across connector boundaries.
