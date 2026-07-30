# Eks-Food Food Intelligence Platform — Nutrition Engine Guide

> **Audience:** Nutritionists, R&D chefs, platform engineers, compliance officers. Read alongside `CATALOG_ARCHITECTURE.md`, `RECIPE_ENGINE_GUIDE.md`, and the M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` (which defines the source `NutritionProfile` shape).
>
> **Status:** Milestone 7. This document specifies the `@eks/fims` nutrition engine: `NutritionFact`, `Allergen`, and `DietaryProfile` Prisma models, automatic recipe-nutrition calculation from ingredient nutrition, per-serving calculation, nutritional inheritance from sub-recipes, allergen detection + cross-contamination modeling, and dietary classification (vegan, vegetarian, halal, kosher, gluten-free, dairy-free, keto, paleo, low-sodium, diabetic-friendly).

---

## 1. Goals & Non-Goals

### 1.1 Goals

- One canonical nutrition fact per `FoodCatalog` row, expressed per 100 g (or per 100 ml for liquids) and convertible to any serving size.
- Recipe nutrition is **derived, never authored**. The nutrition engine computes it from ingredient nutrition + the recipe's scaled quantities. There is no `recipe.nutrition` write API.
- Per-serving nutrition is computed by the `RecipeScaler` (see `RECIPE_ENGINE_GUIDE.md` §5) and cached.
- Allergens propagate transitively through sub-recipes (if "house stock" contains celery, every recipe using that stock carries the celery allergen).
- Cross-contamination is modeled explicitly via facility-level allergen presence declarations, separate from ingredient-level allergens.
- Dietary classification is rule-based and explainable: each tag (`VEGAN`, `GLUTEN_FREE`, etc.) carries a derivation chain so a nutritionist can audit why a recipe was tagged.

### 1.2 Non-Goals

- Medical device-grade nutrition accuracy (we use USDA + regional food composition databases; clinical use is out of scope).
- Personalized nutrition recommendations (lives in the M5 AI assistant).
- Diet plan generation (separate M8 roadmap item).

---

## 2. Data Model

### 2.1 `NutritionFact` (M7 target)

A `NutritionFact` row is always attached to either a `FoodCatalog` entry (per 100 g/ml basis) or a `RecipeVersion` (per-base-serving basis). The discriminator is `subjectType`.

```
model NutritionFact {
  id                 String   @id @default(cuid())
  organizationId     String?
  subjectType        String                          // CATALOG|RECIPE_VERSION
  subjectId          String                          // FK → FoodCatalog.id or RecipeVersion.id
  basisQuantity      Float                           // 100 for CATALOG, 1 for RECIPE_VERSION (per serving)
  basisUnit          String                          // "g" | "ml" | "serving"
  // Macronutrients
  energyKcal         Float
  energyKj           Float?                          // derived: kcal × 4.184
  proteinG           Float
  carbohydrateG      Float
  fatG               Float
  saturatedFatG      Float?
  monounsaturatedFatG Float?
  polyunsaturatedFatG Float?
  transFatG          Float?
  cholesterolMg      Float?
  // Carbohydrate breakdown
  sugarsG            Float?
  fibreG             Float?
  // Minerals
  sodiumMg           Float?
  potassiumMg        Float?
  calciumMg          Float?
  ironMg             Float?
  magnesiumMg        Float?
  zincMg             Float?
  phosphorusMg       Float?
  // Vitamins (per 100 g basis)
  vitaminAUg         Float?
  vitaminCMg         Float?
  vitaminDUg         Float?
  vitaminEMg         Float?
  vitaminKUg         Float?
  thiaminMg          Float?
  riboflavinMg       Float?
  niacinMg           Float?
  vitaminB6Mg        Float?
  folateUg           Float?
  vitaminB12Ug       Float?
  // Other
  alcoholG           Float?
  caffeineMg         Float?
  waterG             Float?
  // Provenance
  source             String                          // "USDA" | "WAFCT" | "supplier" | "calculated" | "manual"
  sourceId           String?                          // e.g. USDA FDC ID
  sourceVersion      String?                          // e.g. "USDA-SR-2024-Q4"
  calculatedAt       DateTime?                        // set when source="calculated"
  calculatedFromVersionId String?                     // FK → RecipeVersion (for calculated facts)
  // Allergen link (denormalized for fast filtering)
  allergenIds        String   @default("[]")          // JSON array of Allergen.id
  // Lifecycle
  version            Int      @default(1)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  @@index([subjectType, subjectId])
  @@index([source])
}
```

### 2.2 `Allergen`

The M7 allergen catalog. Seeded with the EU 14 big allergens + regionally significant ones (e.g. sesame, sulfites, lupin). Each allergen has a `severity` used to escalate cross-contamination risk.

```
model Allergen {
  id              String   @id @default(cuid())
  code            String   @unique                   // "PEANUT", "GLUTEN", "CRUSTACEAN", ...
  name            String
  nameLocalized   String   @default("{}")
  category        String                              // "BIG_14_EU" | "REGIONAL" | "ADDITIVE"
  severity        String   @default("HIGH")          // HIGH|MEDIUM|LOW
  description     String?
  crossContaminationRisk Boolean @default(true)      // if true, facility declaration matters
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([category])
}
```

### 2.3 `DietaryProfile`

A `DietaryProfile` is a reusable rule set that classifies a recipe or catalog item into dietary buckets. The default tenant ships with one profile per dietary tag; tenants may define their own (e.g. a kosher-certifier-specific profile).

```
model DietaryProfile {
  id              String   @id @default(cuid())
  organizationId  String?
  code            String   @unique                   // "VEGAN", "KOSHER_OU", "KETO_STRICT", ...
  name            String
  description     String?
  // Forbidden allergens (any present → recipe not eligible)
  forbiddenAllergenCodes String @default("[]")       // ["DAIRY","EGG"] for VEGAN
  // Forbidden ingredient tags
  forbiddenTags   String   @default("[]")             // ["animal-derived","gelatin"]
  // Required thresholds (per 100 g or per serving)
  maxSodiumMgPerServing  Float?
  maxSugarGPer100g       Float?
  maxCarbohydrateGPer100g Float?
  minFibreGPer100g       Float?
  // Keto:  maxCarbohydrateGPer100g = 5, minFibreGPer100g = 0
  // Low-sodium: maxSodiumMgPerServing = 140
  // Diabetic-friendly: maxSugarGPer100g = 5
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([organizationId])
}
```

### 2.4 `RecipeDietaryClassification` (denormalized for search)

```
model RecipeDietaryClassification {
  id                String   @id @default(cuid())
  recipeVersionId   String
  dietaryProfileCode String
  eligible          Boolean
  reason            String?                          // human-readable derivation
  derivationChain   String   @default("[]")          // JSON array of {step, rule, result}
  computedAt        DateTime @default(now())
  recipeVersion     RecipeVersion @relation(fields: [recipeVersionId], references: [id], onDelete: Cascade)
  @@unique([recipeVersionId, dietaryProfileCode])
  @@index([dietaryProfileCode, eligible])
}
```

---

## 3. The Nutrition Engine

### 3.1 `NutritionEngine` interface

Located at `packages/fims/src/nutrition/engine.ts`:

```typescript
export interface NutritionFactSnapshot {
  energyKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  saturatedFatG?: number;
  sugarsG?: number;
  fibreG?: number;
  sodiumMg?: number;
  // ... all fields from NutritionFact
  allergenCodes: string[];
  source: "calculated";
}

export class NutritionEngine {
  constructor(
    private readonly catalogRepo: CatalogRepository,
    private readonly converter: MeasurementConverter,
    private readonly allergenRepo: AllergenRepository,
  ) {}

  /** Compute per-base-serving nutrition for a recipe version. */
  async computeForRecipe(recipeVersionId: string): Promise<NutritionFactSnapshot>;

  /** Compute nutrition for a single ingredient line at a specific quantity. */
  async computeForIngredientLine(
    line: RecipeIngredientLine,
  ): Promise<NutritionFactSnapshot>;

  /** Recursively roll up sub-recipe nutrition. */
  async rollUpSubRecipes(
    parentSnapshot: NutritionFactSnapshot,
    subRecipes: Array<{ versionId: string; quantity: number }>,
  ): Promise<NutritionFactSnapshot>;
}
```

### 3.2 Computation algorithm

Given a recipe version `V` with `baseServings = N`:

1. For each `RecipeIngredientLine` in `V`:
   - Fetch the `NutritionFact` for `line.catalogId` (per 100 g basis).
   - Convert `line.quantity × line.unit` to grams using `MeasurementConverter` (see `MEASUREMENT_SYSTEM_GUIDE.md` — density-aware conversion).
   - Compute the ingredient's contribution: `fact.field × (grams / 100)`.
   - Multiply by `line.preparationFactor` to account for yield loss.
2. Sum all contributions across ingredient lines → per-recipe total.
3. For each `RecipeSubRecipe`: recursively compute its per-base-serving nutrition, then multiply by `subRecipe.quantity` (which is "how many base-servings of the sub-recipe to produce").
4. Divide the per-recipe total by `baseServings` → per-serving snapshot.
5. Compute `energyKj = energyKcal × 4.184`.
6. Collect `allergenCodes` from all ingredients (union).
7. Set `source = "calculated"`, `calculatedAt = now()`, `calculatedFromVersionId = V.id`.
8. Persist as a `NutritionFact` row with `subjectType=RECIPE_VERSION`, `subjectId=V.id`, `basisQuantity=1`, `basisUnit="serving"`.

### 3.3 Unit conversion

All nutrition math is done in grams. The `MeasurementConverter.toGrams(quantity, unit, catalogId)` method:

- For weight units (`g`, `kg`, `oz`, `lb`): straightforward conversion.
- For volume units (`ml`, `L`, `tsp`, `tbsp`, `cup`, `fl_oz`): look up the ingredient's density in `FoodCatalog.metadata.density` (g/ml). If absent, fall back to a `ConversionRule` row with `fromUnit=cup, toUnit=g, catalogId=<id>`; if absent, fall back to water density (1.0 g/ml) and emit a `nutrition.density.assumed` warning.
- For count units (`piece`, `bunch`, `clove`): use `IngredientVariant.piecesPerPack` and `packSize`, or fall back to `FoodCatalog.metadata.gramsPerPiece`.

### 3.4 Handling missing data

If a `FoodCatalog` row has no `NutritionFact`, the engine:

1. Throws `NutritionFactMissingError` at recipe publish time (the publish is blocked with `422 fims.recipe.publish.nutrition_missing`).
2. At cook-time scaling (after publish), the engine uses the snapshot stored on `RecipeVersion.nutritionSnapshot` and never re-derives.

This guarantees that a published recipe's nutrition cannot silently change because an ingredient's nutrition was edited after publish.

### 3.5 Nutritional inheritance

When recipe A includes sub-recipe B:

- A inherits B's allergens transitively.
- A inherits B's macronutrient profile proportionally to the sub-recipe quantity.
- A does NOT inherit B's dietary classification directly — instead, the dietary classifier re-evaluates A against each `DietaryProfile` using A's rolled-up nutrition + B's allergens. This means A might be `VEGAN` even if B is `VEGETARIAN` only if A's other ingredients compensate (which they won't, but the model is sound).

### 3.6 The snapshot field

`RecipeVersion.nutritionSnapshot` stores the JSON snapshot at publish time. This is the value returned by:

- `GET /api/v1/fims/recipes/{recipeId}/versions/{versionId}/nutrition`
- The `nutrition` field in the `RecipeScaler.scale()` response (after dividing by `baseServings` and multiplying by `requestedServings`).

The snapshot is immutable. The full `NutritionFact` row (with all micros) is also persisted for analytical queries.

---

## 4. Per-Serving Calculation

The `RecipeScaler.scale(recipeVersionId, servings)` returns:

```typescript
{
  nutrition: {
    perServing: NutritionFactSnapshot,    // = RecipeVersion.nutritionSnapshot
    totalForServings: NutritionFactSnapshot, // = perServing × servings
  }
}
```

For a 250-serving scale of a recipe whose `baseServings=4`:

- `perServing.energyKcal` = snapshot value (e.g. 412 kcal).
- `totalForServings.energyKcal` = 412 × 250 = 103 000 kcal.

The scaler rounds display values (e.g. `412.3` → `412`) but stores full precision in the JSON.

---

## 5. Allergen Detection

### 5.1 Ingredient-level allergens

Each `FoodCatalog` row may carry `metadata.allergenCodes` (e.g. `["MILK", "SOY"]` for a milk chocolate). The `NutritionEngine` collects these into `NutritionFact.allergenIds` during recipe computation.

### 5.2 Cross-contamination modeling

Cross-contamination is facility-level, not ingredient-level. The model:

```
model FacilityAllergenDeclaration {
  id              String   @id @default(cuid())
  organizationId  String
  facilityId      String                          // FK → InventoryLocation (kitchen / warehouse)
  allergenCode    String                          // FK → Allergen.code
  declarationType String                          // "CONTAINS" | "MAY_CONTAIN" | "HANDLED_ON_SHARED_LINES"
  declaredAt      DateTime @default(now())
  declaredBy      String
  notes           String?
  @@unique([facilityId, allergenCode])
}
```

A recipe cooked at facility `F` inherits all `MAY_CONTAIN` and `HANDLED_ON_SHARED_LINES` declarations from `F` as `allergenCodes` with a `crossContamination=true` flag. These are surfaced in the consumer-facing allergen statement as "May contain traces of X."

### 5.3 Allergen statement generation

`/api/v1/fims/recipes/{recipeId}/versions/{versionId}/allergen-statement?facilityId=<F>` returns:

```json
{
  "contains": [
    { "code": "GLUTEN", "source": "ingredient", "sources": ["Wheat Flour (FC-...)"] }
  ],
  "mayContain": [
    { "code": "PEANUT", "source": "facility", "facilityId": "loc_kitchen_01" },
    { "code": "TREE_NUT", "source": "facility", "facilityId": "loc_kitchen_01" }
  ],
  "freeFrom": [
    { "code": "CRUSTACEAN", "verifiedAt": "2025-07-30T09:00:00Z" }
  ]
}
```

`freeFrom` is computed by negation: allergens declared on the organization's master list that are neither in `contains` nor in `mayContain`.

---

## 6. Dietary Classification

### 6.1 The classifier

Located at `packages/fims/src/nutrition/dietary-classifier.ts`:

```typescript
export interface DietaryClassificationResult {
  profileCode: string;
  eligible: boolean;
  reason: string;
  derivationChain: Array<{
    step: string;
    rule: string;
    result: "PASS" | "FAIL" | "SKIP";
    detail?: string;
  }>;
}

export class DietaryClassifier {
  constructor(private readonly profileRepo: DietaryProfileRepository) {}

  async classify(
    recipeVersionId: string,
    nutritionSnapshot: NutritionFactSnapshot,
  ): Promise<DietaryClassificationResult[]>;
}
```

### 6.2 Built-in profiles

| Code | Forbidden allergens | Forbidden tags | Thresholds |
|---|---|---|---|
| `VEGAN` | `MILK`, `EGG`, `FISH`, `CRUSTACEAN`, `MOLLUSC`, `HONEY` | `animal-derived` | — |
| `VEGETARIAN` | `FISH`, `CRUSTACEAN`, `MOLLUSC` | `meat`, `poultry` | — |
| `HALAL` | `PORK`, `ALCOHOL` | `non-halal-slaughtered`, `alcohol-cooked` | `alcoholG = 0` |
| `KOSHER` | `PORK`, `SHELLFISH`, `MILK_MEAT_MIX` | `non-kosher-slaughtered`, `milk-meat-combination` | — |
| `GLUTEN_FREE` | `GLUTEN`, `WHEAT`, `BARLEY`, `RYE` | `gluten-containing` | — |
| `DAIRY_FREE` | `MILK` | `dairy-derived` | — |
| `KETO` | — | `grain`, `sugar-added` | `maxCarbohydrateGPer100g = 5`, `minFibreGPer100g = 0` |
| `PALEO` | `GLUTEN`, `DAIRY` | `grain`, `legume`, `refined-sugar` | — |
| `LOW_SODIUM` | — | — | `maxSodiumMgPerServing = 140` |
| `DIABETIC_FRIENDLY` | — | `sugar-added` | `maxSugarGPer100g = 5`, `maxCarbohydrateGPer100g = 30` |

### 6.3 Classification flow

For each `DietaryProfile` applicable to the tenant:

1. **Forbidden allergen check.** If any allergen in `forbiddenAllergenCodes` is in the recipe's `allergenCodes`, the recipe fails. Derivation: `{rule: "forbidden_allergen", result: "FAIL", detail: "PEANUT present"}`.
2. **Forbidden tag check.** If any tag in `forbiddenTags` is in any ingredient's `FoodCatalog.tags`, fail.
3. **Threshold check.** Evaluate each threshold against the per-serving snapshot.
4. If all checks pass, `eligible = true` with derivation `{rule: "all_checks_passed", result: "PASS"}`.

### 6.4 Example derivation

```json
{
  "profileCode": "VEGAN",
  "eligible": false,
  "reason": "Contains EGG allergen from ingredient FC-EGG-001",
  "derivationChain": [
    { "step": "1", "rule": "forbidden_allergen", "result": "FAIL", "detail": "EGG present (from FC-EGG-001)" }
  ]
}
```

### 6.5 Storage and invalidation

Classifications are stored in `RecipeDietaryClassification` at publish time. If an ingredient's `NutritionFact` changes after publish, the recipe's classification is **not** automatically re-evaluated — the snapshot is authoritative. A nightly `RecipeClassificationDriftDetector` job (M1 `@eks/workers` cron) flags recipes whose classification would change based on updated ingredient nutrition, for human review.

---

## 7. API Surface

All routes under `/api/v1/fims/nutrition/*`.

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/fims/nutrition/facts/{subjectType}/{subjectId}` | Get the latest `NutritionFact` | `food.nutrition.read` |
| `POST` | `/api/v1/fims/nutrition/facts` | Create / update catalog-level `NutritionFact` | `food.nutrition.write` |
| `GET` | `/api/v1/fims/nutrition/recipes/{recipeVersionId}` | Get recipe per-serving snapshot | `food.nutrition.read` |
| `POST` | `/api/v1/fims/nutrition/recipes/{recipeVersionId}/recompute` | Recompute and store (draft only) | `food.nutrition.write` |
| `GET` | `/api/v1/fims/nutrition/recipes/{recipeVersionId}/allergen-statement` | Allergen statement (optionally `?facilityId=`) | `food.nutrition.read` |
| `GET` | `/api/v1/fims/nutrition/recipes/{recipeVersionId}/dietary` | All `DietaryProfile` classifications | `food.nutrition.read` |
| `GET` | `/api/v1/fims/allergens` | List allergens | `food.nutrition.read` |
| `POST` | `/api/v1/fims/allergens` | Create allergen (admin) | `food.allergen.create` |
| `GET` | `/api/v1/fims/dietary-profiles` | List profiles | `food.nutrition.read` |
| `POST` | `/api/v1/fims/dietary-profiles` | Create profile | `food.dietary.create` |
| `POST` | `/api/v1/fims/facilities/{facilityId}/allergen-declarations` | Declare facility allergens | `food.facility.allergen.declare` |

### 7.1 Example: allergen statement

```http
GET /api/v1/fims/nutrition/recipes/r_jollof/versions/v3/allergen-statement?facilityId=loc_kit_01 HTTP/1.1

HTTP/1.1 200 OK
{
  "contains": [],
  "mayContain": [
    { "code": "PEANUT", "source": "facility", "facilityId": "loc_kit_01" }
  ],
  "freeFrom": [
    { "code": "CRUSTACEAN", "verifiedAt": "2025-07-30T09:00:00Z" },
    { "code": "MOLLUSC", "verifiedAt": "2025-07-30T09:00:00Z" }
  ]
}
```

### 7.2 Example: dietary classification

```http
GET /api/v1/fims/nutrition/recipes/r_jollof/versions/v3/dietary HTTP/1.1

HTTP/1.1 200 OK
{
  "classifications": [
    { "profileCode": "VEGAN", "eligible": true, "reason": "All checks passed" },
    { "profileCode": "GLUTEN_FREE", "eligible": true, "reason": "All checks passed" },
    { "profileCode": "KETO", "eligible": false, "reason": "Carbohydrate 38g/100g exceeds 5g/100g" },
    { "profileCode": "LOW_SODIUM", "eligible": true, "reason": "Sodium 110mg/serving ≤ 140mg" }
  ]
}
```

---

## 8. Data Sources

The nutrition engine ships with two seed datasets:

- **USDA FoodData Central** (≈ 380 000 items, FDC IDs as `sourceId`) — global baseline.
- **West African Food Composition Table (WAFCT)** 2019 — regionally accurate values for tubers, plantains, palm oil, local greens, smoked fish.

Tenant nutritionists can override either source via `POST /api/v1/fims/nutrition/facts` with `source="manual"`; the override row carries a higher `sourcePriority` (resolved by the engine on read).

### 8.1 Source priority

| Priority | Source | Notes |
|---|---|---|
| 1 (highest) | `manual` | Tenant-authored override |
| 2 | `supplier` | Provided in supplier catalog CSV |
| 3 | `WAFCT` | Regional, preferred for West African items |
| 4 | `USDA` | Global baseline |
| 5 (lowest) | `calculated` | Recipe-level facts computed by the engine |

The engine resolves per-field: if `manual` provides only `proteinG`, the other fields fall back to `WAFCT` or `USDA`. This per-field resolution is recorded in `NutritionFact.metadata.sourceResolution`.

---

## 9. Performance

| Operation | p50 | p99 | Notes |
|---|---|---|---|
| Read `NutritionFact` for one catalog item | 4 ms | 12 ms | Indexed lookup |
| Compute recipe nutrition (10 ingredients, no sub-recipes) | 18 ms | 45 ms | In-process |
| Compute recipe nutrition (50 ingredients, 3 sub-recipes depth 2) | 80 ms | 220 ms | Includes sub-recipe loads |
| Classify recipe against 10 dietary profiles | 6 ms | 18 ms | Pure computation |
| Allergen statement with facility declarations | 9 ms | 25 ms | One extra query |

The recipe nutrition computation is memoized: subsequent `recompute` calls within the same process reuse the intermediate `computeForIngredientLine` results.

---

## 10. Compliance

- EU Regulation 1169/2011 (FIC) — mandatory nutrition declaration format is supported via the `?format=fic-eu` query param on `GET /api/v1/fims/nutrition/recipes/{id}`, which returns the 7 mandatory fields (energy, fat, saturates, carbohydrate, sugars, protein, salt) in the prescribed order. `salt` is computed as `sodiumMg × 2.5 / 1000` (g).
- US FDA 21 CFR 101.9 — `?format=fda-us` returns the US Nutrition Facts panel format.
- Ghana FDA — regional label rules are encoded in the `GHA_FDA` formatter (rounding to nearest 1 g for macronutrients, mandatory vitamin A/C/Iron/Zinc declaration).

Each format is implemented as a pure function in `packages/fims/src/nutrition/formatters/` and tested against fixture recipes with known expected outputs.

---

## 11. References

- `CATALOG_ARCHITECTURE.md` — `FoodCatalog.allergenIds`, `metadata.density`.
- `RECIPE_ENGINE_GUIDE.md` — `RecipeVersion.nutritionSnapshot`, the scaler's nutrition return.
- `MEASUREMENT_SYSTEM_GUIDE.md` — `MeasurementConverter.toGrams` for nutrition math.
- `INVENTORY_GUIDE.md` — facility/kitchen model used for `FacilityAllergenDeclaration`.
- M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` — source `NutritionProfile` shape.
- M1 `docs/OPERATIONS_RUNBOOK.md` for cron-job conventions.
