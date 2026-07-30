# Eks-Food Canonical Entity Relationships

> **Audience:** Application architects, data engineers, integration engineers, support engineers. Read alongside `DOMAIN_MODEL_REFERENCE.md` (entity field definitions), `GRAPH_ARCHITECTURE.md` (engine & traversal), `GRAPH_QUERY_GUIDE.md` (TypeScript traversal examples).
>
> **Status:** Milestone 6. This document is the canonical reference for every cross-entity relationship in the Eks-Food domain. It enumerates every `Relationship.type` (the edge vocabulary), shows its cardinality, direction, lifecycle, and properties, and provides an ASCII diagram of the full graph topology.

---

## 1. Notation

Throughout this document:

- `A ──[edge]──▶ B` means: there is a `Relationship` row with `fromType = A`, `toType = B`, `type = edge`. The edge is **directed** from A to B.
- Cardinality is written as `[A]──{1:N|M:N|N:1}──[B]`. `1:N` means one A connects to many Bs; `M:N` means many-to-many.
- "Mirror edge" indicates that a reverse `Relationship` (e.g. `operated_by` for `operates`) is also materialized. Mirror edges are maintained by the `GraphProjectionWorker` and exist in `Relationship` only if explicitly created; in `GraphEdge` they are synthesized on read via the direction parameter of `GraphEngine.traverse`.
- "Polymorphic" indicates the `toType` (or `fromType`) is one of a closed set, discriminated by a `subjectType` / `ownerType` column on the source entity.

---

## 2. Edge Vocabulary (Canonical)

| # | Edge Type | From | To | Cardinality | Mirror Edge | Polymorphic | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `member_of` | `CustomerProfile` | `Household` | N:1 | — | No | A customer belongs to at most one household. |
| 2 | `member_of` | `Region` | `Country` | N:1 | — | No | Geography. |
| 3 | `member_of` | `City` | `Region` | N:1 | — | No | |
| 4 | `member_of` | `Neighborhood` | `City` | N:1 | — | No | |
| 5 | `member_of` | `InventoryBatch` | `Inventory` | N:1 | — | No | |
| 6 | `member_of` | `MenuItem` | `Menu` | N:1 | — | No | |
| 7 | `contains` | `Country` | `Region` | 1:N | `member_of` | No | |
| 8 | `contains` | `Region` | `City` | 1:N | `member_of` | No | |
| 9 | `contains` | `City` | `Neighborhood` | 1:N | `member_of` | No | |
| 10 | `contains` | `Recipe` | `Ingredient` | M:N | — | No | Via `RecipeIngredient` junction; `properties.weight = quantity`, `properties.unit`, `properties.preparation`. |
| 11 | `contains` | `Menu` | `MenuItem` | 1:N | `member_of` | No | |
| 12 | `contains` | `Kitchen` | `Equipment` | 1:N | — | No | |
| 13 | `operates` | `Restaurant` | `Kitchen` | 1:N | `operated_by` | No | |
| 14 | `operated_by` | `Kitchen` | `Restaurant` | N:1 | `operates` | No | |
| 15 | `operated_by` | `Vehicle` | `Restaurant`/`CookProfile`/`Vendor` | N:1 | — | Yes (`ownerType`) | |
| 16 | `owned_by` | `Menu` | `Restaurant`/`CookProfile`/`Household` | N:1 | — | Yes (`ownerType`) | |
| 17 | `located_in` | `Household` | `Neighborhood` | N:1 | — | No | |
| 18 | `located_in` | `Kitchen` | `Neighborhood` | N:1 | — | No | |
| 19 | `located_in` | `Restaurant` | `Neighborhood` | N:1 | — | No | |
| 20 | `located_in` | `Supplier` | `Neighborhood` | N:1 | — | No | |
| 21 | `located_in` | `Vendor` | `Neighborhood` | N:1 | — | No | |
| 22 | `lives_in` | `CustomerProfile` | `Neighborhood` | N:1 | — | No | |
| 23 | `works_at` | `CookProfile` | `Kitchen` | M:N | — | No | `properties.role`: `"head-chef"`, `"line-cook"`, `"owner"`. |
| 24 | `supplies` | `Supplier` | `Ingredient` | M:N | — | No | Supplier's catalog. `properties.sku`, `properties.unitCost`. |
| 25 | `supplies_to` | `Supplier` | `Kitchen` | M:N | — | No | Active supply contract. `properties.contractId`, `properties.leadTimeDays`. |
| 26 | `stocks` | `Inventory` | `InventoryBatch` | 1:N | `member_of` | No | |
| 27 | `stocked_at` | `Inventory` | `Kitchen` | 1:1 | — | No | One inventory per kitchen. |
| 28 | `inspects` | `Inspection` | `{Cook,Kitchen,Restaurant,Supplier,Vendor}` | N:1 | — | Yes (`subjectType`) | |
| 29 | `certified_by` | `{Cook,Kitchen,Restaurant,Supplier,Vendor}` | `Certification` | 1:N | — | Yes (`subjectType`) | One subject may hold many certifications. |
| 30 | `authored_by` | `Recipe` | `CookProfile` | N:1 | — | No | |
| 31 | `featured_in` | `Recipe` | `MenuItem` | 1:N | `derived_from` | No | |
| 32 | `derived_from` | `MenuItem` | `Recipe` | N:1 | `featured_in` | No | |
| 33 | `produces` | `Kitchen` | `MenuItem` | 1:N | `produced_at` | No | |
| 34 | `produced_at` | `MenuItem` | `Kitchen` | N:1 | `produces` | No | |
| 35 | `requires` | `RecipeStep` | `Equipment` | M:N | — | No | Matched by `Equipment.kind` (e.g. `"STOVE"`). |
| 36 | `follows` | `CustomerProfile` | `CookProfile` | M:N | — | No | Social graph. |
| 37 | `substitutes` | `Ingredient` | `Ingredient` | M:N | — | No | `properties.ratio`, `properties.reason` (e.g. `"allergen-friendly"`). |
| 38 | `partner_of` | `Vendor` | `Restaurant` | M:N | — | No | Marketplace partnership. |
| 39 | `fork_from` | `Recipe` | `Recipe` | N:1 | — | No | Tenant forks a platform recipe. |

---

## 3. Full Graph Topology (ASCII)

```
                                       ┌──────────────────┐
                                       │     Country      │  (tenant-shared, ISO 3166-1)
                                       └────────┬─────────┘
                                                │ contains
                                                ▼
                                       ┌──────────────────┐
                                       │     Region       │
                                       └────────┬─────────┘
                                                │ contains
                                                ▼
                                       ┌──────────────────┐
                                       │      City        │
                                       └────────┬─────────┘
                                                │ contains
                                                ▼
                                       ┌──────────────────┐
                                       │  Neighborhood    │  ◀── located_in ──┐
                                       └────────┬─────────┘                  │
                                                │                            │
                          ┌─────────────────────┼───────────────────┐        │
                          │                     │                   │        │
                          │ lives_in            │                   │        │
                          ▼                     ▼                   ▼        │
              ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
              │ CustomerProfile  │  │   Household      │  │  Restaurant      │── operates ──▶ Kitchen
              └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘                  │
                       │                     │                     │                            │
                       │ member_of           │ member_of           │ member_of (Menu owner)     │
                       ▼                     ▼                     ▼                            ▼
              ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     ┌──────────────────────┐
              │   Household      │  │ CustomerProfile  │  │      Menu        │     │     Kitchen          │
              └──────────────────┘  └──────────────────┘  └────────┬─────────┘     └──────────┬───────────┘
                                                                     │ contains                  │
                                                                     ▼                           │
              ┌──────────────────┐                          ┌──────────────────┐              │
              │  CookProfile     │◀─── follows ─────────────│   MenuItem      │              │
              └────────┬─────────┘                          └────────┬─────────┘              │
                       │                                             │                        │
            ┌──────────┼──────────┐                                  │ derived_from           │ produced_at
            │          │          │                                  ▼                        ▼
       works_at    authored_by  certified_by              ┌──────────────────┐     ┌──────────────────────┐
            │          │          │                        │     Recipe       │     │     Inventory        │── stocked_at ──▶ Kitchen
            ▼          ▼          ▼                        └────────┬─────────┘     └──────────┬───────────┘
       ┌────────┐ ┌────────┐ ┌──────────┐                          │ contains                 │ stocks
       │Kitchen │ │ Recipe │ │Certif.   │                          ▼                          ▼
       └───┬────┘ └────┬───┘ └──────────┘                  ┌──────────────────┐       ┌──────────────────────┐
           │           │                                   │   Ingredient     │◀──────│  InventoryBatch      │
           │           │ contains                          └────────┬─────────┘       └──────────┬───────────┘
           │           ▼                                            │                          │
           │     ┌──────────┐                                       │ supplied_by (inverse)    │ supplied_by
           │     │Ingredient│                                       │                          │
           │     └──────────┘                                       ▼                          ▼
           │                                  ┌──────────────────────────┐         ┌──────────────────────┐
           │ inspected_by                     │        Supplier          │◀────────│  InventoryBatch       │
           ▼                                  └─────────────┬────────────┘         └──────────────────────┘
       ┌──────────┐                                         │
       │Inspection│                                         │ supplies_to
       └──────────┘                                         ▼
                                                  ┌──────────────────┐
                                                  │     Kitchen      │  (loop back)
                                                  └──────────────────┘

              ┌──────────────────┐
              │   FoodSafety     │
              │   Incident       │── subject: {Ingredient|Recipe|MenuItem|Kitchen|Restaurant|Cook|Supplier|Vendor|InventoryBatch}
              └──────────────────┘

              ┌──────────────────┐
              │      Vendor      │── supplies ──▶ Equipment
              └────────┬─────────┘
                       │
                       │ partner_of
                       ▼
                  Restaurant

              ┌──────────────────┐
              │     Vehicle      │── operated_by ──▶ {Restaurant|CookProfile|Vendor}
              └──────────────────┘

              ┌──────────────────┐
              │    Equipment     │── located_at ──▶ Kitchen
              └──────────────────┘
              ┌──────────────────┐
              │ NutritionProfile │── subject: {Ingredient|Recipe|MenuItem}
              └──────────────────┘
              ┌──────────────────┐
              │ EntityVersion    │── entity: {any canonical entity}
              └──────────────────┘
              ┌──────────────────┐
              │   GraphNode      │── projects: {any canonical entity}
              │   GraphEdge      │── projects: Relationship
              └──────────────────┘
```

---

## 4. Cluster-by-Cluster Detail

### 4.1 Geography cluster
```
   Country ──contains──▶ Region ──contains──▶ City ──contains──▶ Neighborhood
      ▲                    ▲                    ▲                    ▲
      └── member_of ───────┘                    │                    │
                          └── member_of ───────┘                    │
                                                └── member_of ──────┘
```
Geography is tenant-shared (no `organizationId`). Edges are 1:N downward (`contains`) and N:1 upward (`member_of`). Geography nodes are the **only** cross-tenant traversable nodes in the graph.

### 4.2 People & Households cluster
```
   CustomerProfile ──member_of──▶ Household
        │
        ├── lives_in ──▶ Neighborhood
        ├── follows ──▶ CookProfile (M:N)
        └── books (M1) ──▶ Booking
```
A `CustomerProfile` belongs to at most one `Household` (`member_of` is N:1). `follows` is M:N — a customer may follow many cooks and a cook may be followed by many customers. The `Booking` relationship is owned by the M1 `booking` bounded context; the M6 graph projects it as a derived edge for completeness but the source of truth is the `Booking` table.

### 4.3 Cook & Kitchen cluster
```
   CookProfile ──works_at──▶ Kitchen (M:N, with role)
        │
        ├── certified_by ──▶ Certification (1:N)
        ├── inspected_by ──▶ Inspection (1:N, subjectType=COOK)
        ├── authored_by ◀── Recipe (N:1)
        └── operates ──▶ Restaurant (M:N, owner/chef)
```
A cook works at zero or more kitchens; the `works_at` edge carries `properties.role` (`"head-chef"`, `"line-cook"`, `"owner"`). A cook may hold many certifications (each `certified_by` edge points to one `Certification` row). Inspections target the cook via the polymorphic `subjectType` discriminator.

### 4.4 Restaurant & Kitchen cluster
```
   Restaurant ──operates──▶ Kitchen (1:N)
        │                       │
        ├── located_in ──▶ Neighborhood
        ├── certified_by ──▶ Certification (1:N)
        ├── inspected_by ──▶ Inspection (1:N, subjectType=RESTAURANT)
        ├── member_of (Menu owner) ──▶ Menu
        └── operated_by ◀── Vehicle (N:1, polymorphic)

   Kitchen ──contains──▶ Equipment (1:N)
        │
        ├── located_in ──▶ Neighborhood
        ├── stocked_at ◀── Inventory (1:1)
        ├── inspected_by ──▶ Inspection (1:N, subjectType=KITCHEN)
        └── produces ──▶ MenuItem (1:N)
```

### 4.5 Recipe & Ingredient cluster
```
   Recipe ──contains──▶ Ingredient (M:N, via RecipeIngredient)
        │                       │
        ├── authored_by ──▶ CookProfile (N:1)
        ├── featured_in ──▶ MenuItem (1:N)
        ├── fork_from ──▶ Recipe (N:1, platform→tenant)
        └── has ──▶ NutritionProfile (1:1, per-serving)

   Ingredient ──substitutes──▶ Ingredient (M:N, with ratio + reason)
        │
        ├── has ──▶ NutritionProfile (1:1, per-100g)
        └── supplied_by ◀── Supplier (M:N, via supplies)
```
The `Recipe contains Ingredient` edge is materialized both as a `RecipeIngredient` row (the source of truth, with quantity, unit, preparation) and as a `Relationship` (with `properties.weight = quantity`). The two are kept in sync by the `@eks/food-domain` repository: every `RecipeIngredient` write creates/updates the corresponding `Relationship`.

### 4.6 Menu & MenuItem cluster
```
   Menu ──owned_by──▶ {Restaurant|CookProfile|Household} (N:1, polymorphic)
        │
        └── contains ──▶ MenuItem (1:N)
                            │
                            ├── derived_from ──▶ Recipe (N:1)
                            ├── produced_at ──▶ Kitchen (N:1)
                            └── has ──▶ NutritionProfile (1:1)
```

### 4.7 Inventory & Logistics cluster
```
   Inventory ──stocked_at──▶ Kitchen (1:1)
        │
        └── stocks ──▶ InventoryBatch (1:N)
                            │
                            ├── member_of ──▶ Inventory (N:1)
                            ├── contains ──▶ Ingredient (N:1)
                            └── supplied_by ──▶ Supplier (N:1)

   Equipment ──located_at──▶ Kitchen (N:1)
   Vehicle ──operated_by──▶ {Restaurant|CookProfile|Vendor} (N:1, polymorphic)
        │
        └── assigned_to ──▶ User (M1)
```

### 4.8 Supply Chain cluster
```
   Supplier ──supplies──▶ Ingredient (M:N, catalog)
        │
        ├── supplies_to ──▶ Kitchen (M:N, contract)
        ├── certified_by ──▶ Certification (1:N)
        └── inspected_by ──▶ Inspection (1:N, subjectType=SUPPLIER)

   Vendor ──supplies──▶ Equipment (M:N)
        │
        ├── partner_of ──▶ Restaurant (M:N)
        ├── certified_by ──▶ Certification (1:N)
        └── inspected_by ──▶ Inspection (1:N, subjectType=VENDOR)
```

### 4.9 Safety & Compliance cluster
```
   Certification ──certifies──▶ {Cook|Kitchen|Restaurant|Supplier|Vendor} (N:1, polymorphic)
   Inspection ──inspects──▶ {Cook|Kitchen|Restaurant|Supplier|Vendor} (N:1, polymorphic)
   FoodSafetyIncident ──affects──▶ {Ingredient|Recipe|MenuItem|Kitchen|Restaurant|Cook|Supplier|Vendor|InventoryBatch} (N:1, polymorphic)
```
The polymorphic `subjectType` discriminator on `Certification`, `Inspection`, and `FoodSafetyIncident` widens the set of valid subject types. Validation is enforced by a Zod schema at the repository boundary.

---

## 5. Cardinality Reference

| Relationship | Cardinality | Enforced By |
|---|---|---|
| `CustomerProfile member_of Household` | N:1 | `CustomerProfile.householdId` FK + unique partial index |
| `Household located_in Neighborhood` | N:1 | `Household.neighborhoodId` FK |
| `CookProfile works_at Kitchen` | M:N | `Relationship` table; no unique constraint |
| `CookProfile certified_by Certification` | 1:N | `Certification.subjectType = COOK`, `subjectId` FK |
| `Restaurant operates Kitchen` | 1:N | `Kitchen.restaurantId` FK |
| `Kitchen contains Equipment` | 1:N | `Equipment.kitchenId` FK |
| `Kitchen stocked_at Inventory` | 1:1 | `Inventory.kitchenId` UNIQUE |
| `Inventory stocks InventoryBatch` | 1:N | `InventoryBatch.inventoryId` FK |
| `InventoryBatch contains Ingredient` | N:1 | `InventoryBatch.ingredientId` FK |
| `InventoryBatch supplied_by Supplier` | N:1 | `InventoryBatch.supplierId` FK |
| `Supplier supplies Ingredient` | M:N | `Relationship` table |
| `Supplier supplies_to Kitchen` | M:N | `Relationship` table |
| `Recipe contains Ingredient` | M:N | `RecipeIngredient` junction (source of truth) + `Relationship` mirror |
| `Recipe authored_by CookProfile` | N:1 | `Recipe.authorCookProfileId` FK |
| `Menu owned_by {Restaurant|CookProfile|Household}` | N:1 | `Menu.ownerType` + `Menu.ownerId` (polymorphic) |
| `Menu contains MenuItem` | 1:N | `MenuItem.menuId` FK |
| `MenuItem derived_from Recipe` | N:1 | `MenuItem.recipeId` FK |
| `MenuItem produced_at Kitchen` | N:1 | `MenuItem.kitchenId` FK (nullable) |
| `Inspection inspects {Cook|Kitchen|Restaurant|Supplier|Vendor}` | N:1 | `Inspection.subjectType` + `subjectId` (polymorphic) |
| `Certification certified_by {Cook|Kitchen|Restaurant|Supplier|Vendor}` | 1:N | `Certification.subjectType` + `subjectId` |
| `FoodSafetyIncident affects {Ingredient|...}` | N:1 | `FoodSafetyIncident.subjectType` + `subjectId` |
| `CustomerProfile follows CookProfile` | M:N | `Relationship` table |
| `Ingredient substitutes Ingredient` | M:N | `Relationship` table (self-loop) |
| `Vendor partner_of Restaurant` | M:N | `Relationship` table |
| `Recipe fork_from Recipe` | N:1 | `Recipe.forkedFromRecipeId` FK (self-loop) |
| `Vehicle operated_by {Restaurant|CookProfile|Vendor}` | N:1 | `Vehicle.ownerType` + `ownerId` |
| `Country contains Region` | 1:N | `Region.countryId` FK |
| `Region contains City` | 1:N | `City.regionId` FK |
| `City contains Neighborhood` | 1:N | `Neighborhood.cityId` FK |
| `GraphNode projects {any entity}` | 1:1 | Unique `(entityType, entityId)` |
| `GraphEdge projects Relationship` | 1:1 | Unique `relationshipId` |
| `EntityVersion versions {any entity}` | 1:N | `(entityType, entityId, version)` indexed |

---

## 6. Relationship Lifecycle

Every `Relationship` row moves through the following state machine:

```
                ┌──────────┐
                │  (none)  │
                └────┬─────┘
                     │ create (domain service)
                     ▼
                ┌──────────┐  update (new properties / weight)
                │  ACTIVE  │───────────────┐
                └────┬─────┘               │
                     │ supersede           ▼ (in-place: same row, new version)
                     ▼                  ┌──────┐
                ┌────────────┐          │ACTIVE│
                │ SUPERSEDED │          └──────┘
                └────┬───────┘
                     │ delete (hard or soft)
                     ▼
                ┌──────────┐
                │ DELETED  │
                └──────────┘
```

- **`ACTIVE`** — the edge is current and participates in graph traversal.
- **`SUPERSEDED`** — the edge was replaced by a newer edge. Retained for history; excluded from default traversals. Reachable via `traverseAsOf`.
- **`DELETED`** — the edge was hard-deleted. The row may be physically removed after the retention window; until then it remains queryable for audit.

State transitions are atomic at the `Relationship` row level: the repository writes the transition within the same transaction as the entity mutation that caused it, and both write to `EntityVersion` and `AuditLog` (see `DOMAIN_MODEL_REFERENCE.md` §12).

---

## 7. Polymorphic Subjects

Several canonical entities use a `(subjectType, subjectId)` polymorphic pattern rather than separate FK columns per type. The set of valid `subjectType` values is closed and validated by a Zod schema at the repository boundary:

| Entity | Valid `subjectType` values |
|---|---|
| `Certification` | `COOK`, `KITCHEN`, `RESTAURANT`, `SUPPLIER`, `VENDOR` |
| `Inspection` | `COOK`, `KITCHEN`, `RESTAURANT`, `SUPPLIER`, `VENDOR` |
| `FoodSafetyIncident` | `INGREDIENT`, `RECIPE`, `MENU_ITEM`, `KITCHEN`, `RESTAURANT`, `COOK`, `SUPPLIER`, `VENDOR`, `INVENTORY_BATCH` |
| `NutritionProfile` | `INGREDIENT`, `RECIPE`, `MENU_ITEM` |
| `EntityVersion` | Any canonical entity type |
| `GraphNode` | Any canonical entity type |
| `Relationship` (via `fromType` / `toType`) | Any canonical entity type |

Polymorphic FKs are not enforced at the database level (Postgres does not support polymorphic FKs natively). Validation is performed in three layers:

1. **Zod schema** at the repository boundary — rejects invalid `subjectType` strings before the row is written.
2. **Application-level referential check** — the repository verifies that the referenced entity exists before writing the polymorphic row.
3. **Nightly reconciliation job** — the `RelationshipIntegrityJob` scans for orphaned polymorphic references and reports them as drift (see `OPERATIONAL_RUNBOOKS.md` §8).

---

## 8. Inverse & Mirror Edges

Some edges are bidirectional and materialized as **two** `Relationship` rows (a forward and a mirror):

| Forward | Mirror | Notes |
|---|---|---|
| `Restaurant operates Kitchen` | `Kitchen operated_by Restaurant` | Both rows are created in the same transaction. |
| `Menu contains MenuItem` | `MenuItem member_of Menu` | |
| `Recipe featured_in MenuItem` | `MenuItem derived_from Recipe` | |
| `Kitchen produces MenuItem` | `MenuItem produced_at Kitchen` | |
| `Country contains Region` | `Region member_of Country` | |

Other edges (e.g. `CookProfile works_at Kitchen`) are unidirectional; the reverse traversal is performed by the `GraphEngine` via the `direction: 'inbound'` parameter on `traverse`, which queries `GraphEdge` from the `toNodeId` side. No mirror row is materialized, avoiding write amplification.

The decision to materialize a mirror edge is made per edge type based on read patterns: edges that are queried bidirectionally with high frequency get material mirrors; edges queried in one direction only do not. The vocabulary table in `@eks/food-domain/graph/edge-types.ts` declares which edges have material mirrors.

---

## 9. Self-Loop Edges

Two edge types are self-loops (the `fromType` and `toType` are the same):

1. **`Ingredient substitutes Ingredient`** — models allergen-friendly and regional substitutions. The `Relationship.properties` carries `ratio` (e.g. `1.0` for tomato→tomato, `0.75` for egg→flax-egg) and `reason` (e.g. `"allergen-friendly"`, `"regional-swap"`). Cycles in the substitution graph are detected by the `SubstitutionCycleDetector` job; cycles are forbidden because they make "find a substitute" non-terminating.

2. **`Recipe fork_from Recipe`** — models tenant forks of platform-curated recipes. A tenant fork copies the `steps`, `ingredients`, and metadata of the platform recipe into a new `Recipe` row with the tenant's `organizationId`, then creates a `fork_from` edge from the fork to the source. Forks are tracked for attribution and for upstream-change propagation (the `RecipeUpstreamSyncJob` notifies fork owners when the source recipe is updated).

---

## 10. Cross-Tenant Edges

Most edges are intra-tenant: both endpoints share the same `organizationId`. Three categories of edges are cross-tenant (or tenant-shared):

1. **Geography edges** (`contains`, `member_of` between `Country`, `Region`, `City`, `Neighborhood`) — all endpoints have `organizationId = null`. Traversable from any tenant.
2. **Global `Ingredient` edges** (`supplies`, `substitutes` involving a global `Ingredient`) — the `Ingredient` endpoint has `organizationId = null`, the other endpoint is tenant-scoped. Traversable from any tenant, but the non-global endpoint is filtered to the querying tenant.
3. **Global `Recipe` edges** (`fork_from` where the source is a platform recipe with `organizationId = null`) — same pattern as global `Ingredient`.

Cross-tenant edges are explicitly flagged in `Relationship.organizationId = null`. The `GraphEngine.traverse` operation enforces tenant isolation by joining `GraphNode.organizationId` against the query's `organizationId` filter (with `OR organization_id IS NULL` for global nodes). See `GRAPH_ARCHITECTURE.md` §10.

---

## 11. Edge Properties Schema

Each edge type has a typed `properties` schema defined in `@eks/food-domain/graph/edge-properties.ts`. The schemas are validated by Zod at write time:

```typescript
// Example: Recipe contains Ingredient
export const ContainsRecipeIngredientProperties = z.object({
  weight: z.number().positive(),         // quantity
  unit: z.string().min(1),                // "g", "ml", "tbsp"
  preparation: z.string().optional(),     // "diced", "minced"
  optional: z.boolean().default(false),
  position: z.number().int().nonnegative(),
});

// Example: Supplier supplies Ingredient
export const SuppliesIngredientProperties = z.object({
  sku: z.string().optional(),
  unitCost: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  minimumOrderQuantity: z.number().positive().optional(),
});

// Example: CookProfile works_at Kitchen
export const WorksAtProperties = z.object({
  role: z.enum(['head-chef', 'line-cook', 'sous-chef', 'pastry-chef', 'owner', 'contractor']),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  weeklyHours: z.number().positive().optional(),
});

// Example: Ingredient substitutes Ingredient
export const SubstitutesProperties = z.object({
  ratio: z.number().positive(),          // multiply quantity by this
  reason: z.enum(['allergen-friendly', 'regional-swap', 'cost', 'availability', 'dietary', 'other']),
  notes: z.string().optional(),
});
```

The full set of schemas lives in `@eks/food-domain/graph/edge-properties.ts`. Adding a new edge type or extending an existing schema requires a new minor version of `@eks/food-domain` and a corresponding entry in `EntityVersion.metadata.schemaVersion`.

---

## 12. Referential Integrity

Referential integrity is enforced at four layers:

1. **Database FK constraints** — for non-polymorphic relationships (`Household.neighborhoodId`, `Kitchen.restaurantId`, `Recipe.authorCookProfileId`, etc.), Postgres FK constraints prevent orphaned references.
2. **Application-level referential check** — for polymorphic relationships (`Certification.subjectId`, `Inspection.subjectId`, etc.), the repository verifies the referenced entity exists before writing.
3. **Edge-type validator** — the `Relationship.type` column is validated against the closed `EDGE_TYPES` enum at write time.
4. **Nightly reconciliation** — the `RelationshipIntegrityJob` scans for orphaned references and reports them as drift.

Violations are surfaced as RFC 7807 `409 conflict` errors with `type: "https://docs.eks-food.com/errors/relationship-integrity"`. See `API_DOCUMENTATION.md` §9.

---

## 13. See Also

- `DOMAIN_MODEL_REFERENCE.md` — full entity field definitions and lifecycle states.
- `GRAPH_ARCHITECTURE.md` — `GraphEngine` interface, storage abstraction, traversal algorithms.
- `GRAPH_QUERY_GUIDE.md` — TypeScript code examples for traversal, shortest-path, neighborhood, dependency analysis.
- `API_DOCUMENTATION.md` §5 — `/api/v1/food-domain/relationships` REST routes.
- `CANONICAL_DATA_STANDARDS.md` §6 — naming conventions for edge types and properties.
- `OPERATIONAL_RUNBOOKS.md` §8 — `RelationshipIntegrityJob` monitoring and drift remediation.
