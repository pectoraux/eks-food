# Eks-Food Food Intelligence Platform — Recipe Engine Guide

> **Audience:** Recipe authors, R&D chefs, platform engineers, kitchen operators. Read alongside `CATALOG_ARCHITECTURE.md`, `NUTRITION_ENGINE_GUIDE.md`, `MEASUREMENT_SYSTEM_GUIDE.md`, and the M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md`.
>
> **Status:** Milestone 7. This document specifies the `@eks/fims` recipe engine: `RecipeVersion`, `RecipeStage`, `RecipeInstruction` Prisma models, the draft→review→publish workflow, approvals and ownership, ingredient dependencies, time estimates, serving sizes, the `RecipeScaler` engine (2 → 5000 servings), and recipe reusability patterns.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- Recipe content is **immutable once published**. Edits produce a new `RecipeVersion` row; the previous version remains queryable forever (audit + compliance).
- A recipe has at most one `ACTIVE` version at a time; deprecated versions stay readable but cannot be cooked against.
- Drafts support collaborative editing with explicit ownership transfer and approval gates.
- Recipe structure is rich enough to model real kitchen workflows: stages (prep, cook, plate), instructions per stage, ingredient dependencies ("after chopping onion, add oil to pan"), equipment requirements, and time estimates broken down by phase.
- Scaling from 2 to 5000 servings is **deterministic and side-effect-free**: the same `(recipeVersionId, servings)` tuple always yields the same scaled ingredient list and time estimates.
- Recipes are reusable: a recipe can include another recipe as a sub-recipe (e.g. "house stock" inside "jollof rice").

### 1.2 Non-Goals

- Recipe pricing (lives in M1 `PricingRule` + M5 merchant connector).
- Recipe publishing to consumer channels (lives in the M1 `MenuItem` → marketplace flow).
- Nutrition calculation (see `NUTRITION_ENGINE_GUIDE.md`); the recipe engine only collects ingredient quantities and delegates nutrition roll-up to the nutrition engine.

---

## 2. Data Model

### 2.1 `RecipeVersion` (M7 target)

```
model RecipeVersion {
  id                String   @id @default(cuid())
  organizationId    String
  recipeId          String                          // logical recipe (1 recipe → N versions)
  versionNumber     Int                             // monotonic per recipeId
  // Display
  title             String
  titleLocalized    String   @default("{}")         // LocalizedText JSON
  description       String?
  // Cuisine & metadata
  cuisine           String?                         // "Ghanaian", "Levantine", "Pan-Asian"
  course            String?                         // "main", "starter", "dessert", "snack"
  tags              String   @default("[]")
  // Quantities
  baseServings      Int      @default(4)            // the serving count this version was authored for
  servingUnit       String   @default("portion")    // "portion" | "ml" | "g" (for beverages / bulk)
  // Time estimates (minutes)
  prepTimeMin       Int      @default(0)
  cookTimeMin       Int      @default(0)
  coolTimeMin       Int      @default(0)
  restTimeMin       Int      @default(0)
  cleanupTimeMin    Int      @default(0)
  totalTimeMin      Int      @default(0)            // derived: prep+cook+cool+rest+cleanup
  // Ownership & workflow
  ownerId           String                          // FK → User
  authorId          String?                         // FK → User (original author, immutable)
  status            String   @default("DRAFT")      // DRAFT|IN_REVIEW|PUBLISHED|DEPRECATED|ARCHIVED
  previousVersionId String?                         // FK → RecipeVersion (immediate predecessor)
  publishedAt       DateTime?
  deprecatedAt      DateTime?
  // Approval
  approvedById      String?
  approvedAt        DateTime?
  approvalNotes     String?
  // Reusability
  parentRecipeId    String?                         // FK → RecipeVersion (if forked)
  // Nutrition snapshot (denormalized for read perf)
  nutritionSnapshot String   @default("{}")         // per-base-serving NutritionFact JSON
  allergenIds       String   @default("[]")         // denormalized for filter performance
  // Standard audit block
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?
  createdBy         String?
  updatedBy         String?
  metadata          String   @default("{}")
  // Relations
  stages            RecipeStage[]
  instructions      RecipeInstruction[]             // flattened for query convenience
  ingredients       RecipeIngredientLine[]
  subRecipes        RecipeSubRecipe[]
  approvals        RecipeApproval[]
  @@unique([recipeId, versionNumber])
  @@index([organizationId, status])
  @@index([ownerId, status])
  @@index([previousVersionId])
}
```

### 2.2 `RecipeStage`

A recipe is divided into ordered stages. Each stage has its own time estimate and may run in parallel with another stage (e.g. "cook rice" while "fry tomato sauce").

```
model RecipeStage {
  id                String   @id @default(cuid())
  recipeVersionId   String
  sortOrder         Int                             // 0-based, contiguous
  name              String                          // "Prep", "Cook", "Plate"
  nameLocalized     String   @default("{}")
  description       String?
  stageType         String   @default("PREP")       // PREP|COOK|COOL|REST|PLATE|CLEANUP
  timeMin           Int      @default(0)
  parallelWith      String?                         // FK → RecipeStage (if this stage runs in parallel)
  equipment         String   @default("[]")         // JSON array of equipment codes
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  recipeVersion     RecipeVersion @relation(fields: [recipeVersionId], references: [id], onDelete: Cascade)
  instructions      RecipeInstruction[]
  @@index([recipeVersionId, sortOrder])
}
```

### 2.3 `RecipeInstruction`

An instruction belongs to exactly one stage and references the ingredients it consumes (this is the dependency graph).

```
model RecipeInstruction {
  id                String   @id @default(cuid())
  recipeVersionId   String
  stageId           String
  sortOrder         Int                             // 0-based within the stage
  instruction       String                          // human-readable, may contain markdown
  instructionLocalized String @default("{}")
  // Dependencies
  ingredientLineIds String   @default("[]")         // JSON array of RecipeIngredientLine.id used here
  prerequisiteInstructionIds String @default("[]")  // JSON array of RecipeInstruction.id that must complete first
  // Technique
  technique         String?                         // "saute", "braise", "steam", "deep-fry"
  targetTempC       Float?                          // target cooking temperature
  durationMin       Int?                            // explicit duration if not implied by stage
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  recipeVersion     RecipeVersion @relation(fields: [recipeVersionId], references: [id], onDelete: Cascade)
  stage             RecipeStage   @relation(fields: [stageId], references: [id], onDelete: Cascade)
  @@index([recipeVersionId, sortOrder])
  @@index([stageId, sortOrder])
}
```

### 2.4 `RecipeIngredientLine`

Replaces the M6 `RecipeIngredient` join (which is preserved for backward compatibility). Each line carries a quantity, a unit (referencing `MeasurementUnit`), an optional preparation ("chopped", "minced"), and an optional variant reference.

```
model RecipeIngredientLine {
  id                String   @id @default(cuid())
  recipeVersionId   String
  catalogId         String                          // FK → FoodCatalog
  variantId         String?                          // FK → IngredientVariant (optional)
  quantity          Float                            // quantity in `unit`
  unit              String                           // FK → MeasurementUnit.code
  preparation       String?                          // "chopped", "minced", "grated"
  preparationFactor Float    @default(1.0)           // yield factor: 0.85 for "peeled and cored"
  isOptional        Boolean  @default(false)
  substituteFor     String?                          // FK → RecipeIngredientLine (if this is a substitute)
  sortOrder         Int      @default(0)
  note              String?
  recipeVersion     RecipeVersion @relation(fields: [recipeVersionId], references: [id], onDelete: Cascade)
  @@index([recipeVersionId])
  @@index([catalogId])
}
```

`preparationFactor` is critical: "500 g onions, peeled" yields 500 × 0.90 = 450 g usable onion. The scaler multiplies base quantity by the serving ratio and then by `preparationFactor` when computing inventory consumption.

### 2.5 `RecipeSubRecipe`

A recipe can include another published recipe as a sub-recipe.

```
model RecipeSubRecipe {
  id                 String   @id @default(cuid())
  recipeVersionId    String
  subRecipeVersionId String                          // FK → RecipeVersion (must be PUBLISHED)
  quantity           Float                           // how many base-servings of the sub-recipe to produce
  note               String?
  sortOrder          Int      @default(0)
  recipeVersion      RecipeVersion @relation("ParentRecipe", fields: [recipeVersionId], references: [id], onDelete: Cascade)
  subRecipeVersion   RecipeVersion @relation("ChildRecipe",  fields: [subRecipeVersionId], references: [id])
  @@index([recipeVersionId])
  @@index([subRecipeVersionId])
}
```

Sub-recipes are resolved recursively by the `RecipeScaler`. Cycle detection runs on every publish (see §6).

### 2.6 `RecipeApproval`

Approval records are immutable audit entries.

```
model RecipeApproval {
  id                String   @id @default(cuid())
  recipeVersionId   String
  approverId        String                          // FK → User
  decision          String                          // APPROVED|REJECTED|CHANGES_REQUESTED
  notes             String?
  approvedAt        DateTime @default(now())
  recipeVersion     RecipeVersion @relation(fields: [recipeVersionId], references: [id], onDelete: Cascade)
  @@index([recipeVersionId])
  @@index([approverId])
}
```

---

## 3. Workflow

### 3.1 State machine

```
            create
        ┌─────────────┐
        │             ▼
    ┌───────┐  submit  ┌────────────┐  approve   ┌───────────┐  deprecate  ┌────────────┐  archive  ┌──────────┐
    │ DRAFT │ ────────▶│ IN_REVIEW  │ ──────────▶│ PUBLISHED │ ───────────▶│ DEPRECATED │ ────────▶│ ARCHIVED │
    └───────┘          └────────────┘            └───────────┘             └────────────┘           └──────────┘
        │                   │  reject                 ▲                         │
        │ edit              ▼                         │ reactivate              │
        └───────► (DRAFT)   (DRAFT)                   └─────────────────────────┘
                            ▲  request changes
                            │
                       (IN_REVIEW)
```

| From | To | Permission | Side effects |
|---|---|---|---|
| `DRAFT` | `IN_REVIEW` | `food.recipe.submit` | Notifies approvers via M2 `@eks/notifications` |
| `IN_REVIEW` | `PUBLISHED` | `food.recipe.approve` | Snapshots nutrition, freezes ingredient lines, emits `fims.recipe.published.v1` |
| `IN_REVIEW` | `DRAFT` | `food.recipe.reject` | Appends `RecipeApproval` with `decision=REJECTED`, notifies author |
| `IN_REVIEW` | `DRAFT` | `food.recipe.request_changes` | Appends `RecipeApproval` with `decision=CHANGES_REQUESTED` |
| `PUBLISHED` | `DEPRECATED` | `food.recipe.deprecate` | Active menus referencing this version are flagged for review |
| `DEPRECATED` | `PUBLISHED` | `food.recipe.reactivate` | Only allowed if no newer `PUBLISHED` version exists |
| `DEPRECATED` | `ARCHIVED` | `food.recipe.archive` | Read-only retention |

### 3.2 New version creation

Editing a `PUBLISHED` recipe creates a new `RecipeVersion`:

1. The author calls `POST /api/v1/fims/recipes/{recipeId}/versions` with `fromVersionId` referencing the current published version.
2. The server creates a new `RecipeVersion` with `versionNumber = previous + 1`, `previousVersionId = fromVersionId`, `status = DRAFT`, `parentRecipeId` left null (this is a revision, not a fork).
3. Stages, instructions, and ingredient lines are deep-copied.
4. The author edits the draft through standard update endpoints.
5. On publish, the previous `PUBLISHED` version transitions to `DEPRECATED` automatically.

### 3.3 Forking

`POST /api/v1/fims/recipes/{recipeId}/fork` creates a new logical recipe (new `recipeId`) whose first version has `parentRecipeId` set to the source version. Forks are visible in the source recipe's `forks` list. Forking requires `food.recipe.fork` permission and is unrestricted across tenants only if the source recipe carries `metadata.shareable = true`.

### 3.4 Ownership transfer

`POST /api/v1/fims/recipes/{recipeId}/versions/{versionId}/transfer-ownership` with `{ newOwnerId }`:

- Requires `food.recipe.transfer` permission (typically held by the current owner or an org admin).
- Records an `OwnershipTransferred` audit action (M1 `AuditLog`).
- Emits `fims.recipe.ownership.transferred.v1`.
- The previous owner retains `food.recipe.read` access but loses write access unless explicitly granted.

---

## 4. Time Estimates

Five orthogonal time phases are captured per recipe version:

| Field | Meaning | Examples |
|---|---|---|
| `prepTimeMin` | Cleaning, chopping, measuring, marinating | 25 min for jollof rice |
| `cookTimeMin` | Active heat application | 40 min for jollof rice |
| `coolTimeMin` | Wait for food to come down to handling temperature | 10 min for baked goods |
| `restTimeMin` | Flavor development or texture setting (often passive) | 30 min for marinades |
| `cleanupTimeMin` | Dishwashing, surface sanitizing | 15 min |

`totalTimeMin` is a derived column recomputed on every save. Stage-level `RecipeStage.timeMin` must sum (accounting for `parallelWith`) to `totalTimeMin`; the API rejects save requests where this invariant is violated with `422 fims.recipe.time.invariant`.

### 4.1 Scaling time

The `RecipeScaler` scales time sub-linearly: doubling servings does not double prep time, because some operations (chopping one onion vs. two) take roughly the same duration. The scaling model:

```
scaled_time(phase, ratio) = base_time(phase) × ratio ^ alpha(phase)
```

Where `alpha` is empirically tuned per phase:

| Phase | α | Rationale |
|---|---|---|
| prep | 0.85 | Marginal efficiency gains, but limited by knife/board throughput |
| cook | 0.70 | Larger batches cook more efficiently per unit |
| cool | 1.00 | Thermal mass scales linearly |
| rest | 1.00 | Flavor diffusion is time-invariant |
| cleanup | 0.90 | Some fixed overhead (sink setup) |

These constants live in `metadata.scalingAlphas` so chefs can override per recipe.

---

## 5. Serving Sizes & Scaling

### 5.1 The `RecipeScaler` engine

Located at `packages/fims/src/recipe/scaler.ts`:

```typescript
export interface ScaledRecipe {
  recipeVersionId: string;
  requestedServings: number;
  baseServings: number;
  ratio: number;
  ingredientLines: Array<{
    catalogId: string;
    name: string;
    quantity: number;            // post-scaling, post-preparationFactor
    unit: string;                // post-rounding unit (may be converted for readability)
    preparationNote?: string;
  }>;
  subRecipes: Array<{ ... }>     // recursively scaled
  timeEstimate: {
    prepMin: number;
    cookMin: number;
    coolMin: number;
    restMin: number;
    cleanupMin: number;
    totalMin: number;
  };
  nutrition: NutritionFact;      // per serving, see NUTRITION_ENGINE_GUIDE.md
}

export class RecipeScaler {
  constructor(
    private readonly catalogRepo: CatalogRepository,
    private readonly converter: MeasurementConverter,
    private readonly nutritionEngine: NutritionEngine,
  ) {}

  async scale(
    recipeVersionId: string,
    servings: number,
    options?: ScalingOptions,
  ): Promise<ScaledRecipe>;
}
```

### 5.2 Scaling range

The scaler accepts `servings` in `[2, 5000]`. Outside this range:

- `servings < 2` → `400 fims.recipe.scale.servings.too_small`
- `servings > 5000` → `400 fims.recipe.scale.servings.too_large`

The upper bound prevents runaway batch computations and accidental orders that would exceed kitchen capacity.

### 5.3 Scaling algorithm

1. Load the recipe version with all stages, instructions, ingredient lines, and sub-recipes (depth-first, cycle-checked).
2. Compute `ratio = servings / baseServings`.
3. For each ingredient line:
   - `scaledQuantity = line.quantity × ratio`.
   - `consumedQuantity = scaledQuantity × line.preparationFactor` (this is what gets reserved against inventory).
   - Round `scaledQuantity` to a sensible unit (e.g. 5.23 g → 5 g, 1.07 cups → 1 cup + 1 tbsp).
   - Optionally convert to a more readable unit if `options.preferredUnitSystem` is set (`metric` or `imperial`).
4. For each sub-recipe: recursively `scale(subRecipeVersionId, ceil(line.quantity × ratio))`.
5. Scale time per the α model above.
6. Compute nutrition per serving via the nutrition engine (see `NUTRITION_ENGINE_GUIDE.md`).
7. Return the assembled `ScaledRecipe`.

### 5.4 Rounding rules

The scaler uses these rounding rules to keep printed quantities usable in a kitchen:

| Unit | Rounding |
|---|---|
| `g` (< 100) | nearest 1 g |
| `g` (100–1000) | nearest 5 g |
| `g` (> 1000) | nearest 10 g |
| `kg` | nearest 0.05 kg |
| `ml` (< 100) | nearest 5 ml |
| `ml` (100–1000) | nearest 10 ml |
| `L` | nearest 0.05 L |
| `tsp` | nearest 0.25 tsp |
| `tbsp` | nearest 0.5 tbsp |
| `cup` | nearest 0.25 cup |
| `piece` (< 10) | nearest 0.5 piece |
| `piece` (≥ 10) | nearest 1 piece |

### 5.5 Cycle detection

Sub-recipe graphs may form cycles (recipe A includes recipe B which includes recipe A). The scaler detects cycles on every `scale()` call:

- Maintain a visited set of `recipeVersionId`s along the current DFS path.
- If a node is revisited on the current path, throw `Error("fims.recipe.scale.cycle_detected")` with the cycle path in the message.
- Publish attempts also run static cycle detection at `publish` time and reject with `422 fims.recipe.publish.cycle`.

---

## 6. Approvals

### 6.1 Approvers

Approvers are configured per organization via the `food.recipe.approve` permission grant (see M2 `docs/identity/AUTHORIZATION_POLICIES.md`). The default policy requires:

- One approval for recipes with `baseServings ≤ 50`.
- Two approvals for `baseServings > 50` (executive chef + R&D lead).
- Three approvals for recipes intended for multi-site rollout (`metadata.multiSite = true`).

### 6.2 Approval workflow

1. Author submits draft → `IN_REVIEW`.
2. Approvers receive a notification with a deep link to the review UI.
3. Each approver records a `RecipeApproval` row with `decision ∈ {APPROVED, REJECTED, CHANGES_REQUESTED}`.
4. When the required number of `APPROVED` decisions is reached, the recipe auto-transitions to `PUBLISHED`.
5. Any single `REJECTED` decision transitions the recipe back to `DRAFT` and notifies the author.

### 6.3 Re-approval after edit

If a `PUBLISHED` recipe is edited (creating a new draft version), the new version requires fresh approvals — previous approvals do not carry over.

---

## 7. Ingredient Dependencies

### 7.1 The dependency graph

Each `RecipeInstruction.ingredientLineIds` array captures which ingredients are consumed at which step. Each `RecipeInstruction.prerequisiteInstructionIds` array captures ordering constraints. Together these form a DAG that the `RecipeDependencyAnalyzer` can traverse to answer:

- "Which steps can run in parallel?" — instructions with no shared prerequisites.
- "What is the critical path?" — longest path through the dependency graph.
- "If we substitute ingredient X for Y, which instructions are affected?" — instructions whose `ingredientLineIds` contain X.

### 7.2 Substitutes

`RecipeIngredientLine.substituteFor` lets an author declare a backup ingredient. The cook-side UI surfaces substitutes when the primary is out of stock (cross-references the `INVENTORY_GUIDE.md` availability check). The nutrition engine computes nutrition for the primary ingredient; substitutes are only used at cook time.

---

## 8. Reusability

### 8.1 Sub-recipe resolution

When `RecipeSubRecipe` references another recipe, the scaler resolves the sub-recipe's ingredient lines recursively and rolls them into the parent's shopping list. The sub-recipe's instructions are NOT inlined into the parent's instruction list — instead, the parent recipe references the sub-recipe by name and the cook UI displays them as a collapsible section.

### 8.2 Template recipes

A recipe can be marked `metadata.isTemplate = true`. Templates are not directly cookable but can be forked. Example: "Base Tomato Sauce" template forked into "Shito Sauce" and "Marinara".

### 8.3 Recipe collections

The `metadata.collections` array (e.g. `["seasonal-q4", "ramadan-2025"]`) groups recipes for menu planning. Collections are managed via the M1 `FeatureFlag`-like mechanism (typed metadata, no separate table).

---

## 9. API Surface

All routes under `/api/v1/fims/recipes/*`.

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `POST` | `/api/v1/fims/recipes` | Create logical recipe (first version) | `food.recipe.create` |
| `GET` | `/api/v1/fims/recipes` | List (filter by `status`, `ownerId`, `cuisine`, `course`, `tags`) | `food.recipe.read` |
| `GET` | `/api/v1/fims/recipes/{recipeId}` | Get recipe metadata (latest published version) | `food.recipe.read` |
| `GET` | `/api/v1/fims/recipes/{recipeId}/versions` | Version history | `food.recipe.read` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions` | New version from existing | `food.recipe.version.create` |
| `GET` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}` | Get one version with full graph | `food.recipe.read` |
| `PATCH` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}` | Update draft fields | `food.recipe.update` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/submit` | `DRAFT` → `IN_REVIEW` | `food.recipe.submit` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/approve` | Record approval | `food.recipe.approve` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/publish` | Publish (auto if approvals met) | `food.recipe.publish` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/deprecate` | `PUBLISHED` → `DEPRECATED` | `food.recipe.deprecate` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/reactivate` | `DEPRECATED` → `PUBLISHED` | `food.recipe.reactivate` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/archive` | `DEPRECATED` → `ARCHIVED` | `food.recipe.archive` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/transfer-ownership` | Transfer ownership | `food.recipe.transfer` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/fork` | Fork to new logical recipe | `food.recipe.fork` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/scale` | Scale to N servings | `food.recipe.read` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/stages` | Add stage | `food.recipe.update` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/stages/{stageId}/instructions` | Add instruction | `food.recipe.update` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/ingredient-lines` | Add ingredient line | `food.recipe.update` |
| `POST` | `/api/v1/fims/recipes/{recipeId}/versions/{versionId}/sub-recipes` | Add sub-recipe | `food.recipe.update` |

### 9.1 Example: scale

```http
POST /api/v1/fims/recipes/r_jollof/versions/v3/scale HTTP/1.1
Content-Type: application/json

{ "servings": 250, "preferredUnitSystem": "metric" }

HTTP/1.1 200 OK
{
  "recipeVersionId": "v3",
  "requestedServings": 250,
  "baseServings": 4,
  "ratio": 62.5,
  "ingredientLines": [
    { "catalogId": "clx...", "name": "Long-Grain Rice", "quantity": 15.6, "unit": "kg", "preparationNote": "washed" },
    { "catalogId": "clx...", "name": "Tomato",          "quantity": 18.7, "unit": "kg", "preparationNote": "chopped" },
    { "catalogId": "clx...", "name": "Onion",           "quantity": 4.6,  "unit": "kg", "preparationNote": "peeled, sliced", "preparationFactor": 0.90 }
  ],
  "timeEstimate": {
    "prepMin": 175, "cookMin": 280, "coolMin": 60, "restMin": 0, "cleanupMin": 130, "totalMin": 645
  },
  "nutrition": { "perServing": { "energyKcal": 412, "proteinG": 9, ... } }
}
```

### 9.2 Error catalog

| Code | HTTP | Meaning |
|---|---|---|
| `fims.recipe.scale.cycle_detected` | 422 | Sub-recipe graph contains a cycle |
| `fims.recipe.scale.servings.too_small` | 400 | `servings < 2` |
| `fims.recipe.scale.servings.too_large` | 400 | `servings > 5000` |
| `fims.recipe.publish.cycle` | 422 | Publish-time cycle check failed |
| `fims.recipe.publish.missing_approval` | 409 | Required approvals not yet recorded |
| `fims.recipe.publish.nutrition_missing` | 422 | One or more ingredient lines reference catalog items without `NutritionFact` |
| `fims.recipe.transition.invalid` | 409 | Lifecycle transition not allowed from current state |
| `fims.recipe.time.invariant` | 422 | Stage times don't sum to total |
| `fims.recipe.sub_recipe.not_published` | 422 | Sub-recipe is not in `PUBLISHED` state |
| `fims.recipe.ownership.transfer.not_owner` | 403 | Caller is not the current owner and lacks `food.recipe.transfer` |

---

## 10. Caching

The `RecipeScaler` result is deterministic given `(recipeVersionId, servings, options)`, so it is cached:

- **In-process LRU** (M1 `@eks/cache`): key `recipe:scale:{versionId}:{servings}:{unitSystem}`, TTL 1 hour, max 10 000 entries.
- **Optional Redis** (when configured): same key, TTL 24 hours.

Cache invalidation on `RecipeVersion` publish or deprecate uses the M1 cache pattern registry (see `docs/developer/ARCHITECTURE.md` §Caching).

---

## 11. Migration from M6 `Recipe`

The M6 `Recipe` and `RecipeIngredient` models remain readable. The M7 migration:

1. For each `Recipe` row, create a logical recipe (`recipeId` = original `Recipe.id`) with one `RecipeVersion` (`versionNumber=1`, `status=PUBLISHED`).
2. Map `Recipe.steps` JSON → `RecipeStage` (one stage "Cook") + `RecipeInstruction` rows.
3. Map `RecipeIngredient` rows → `RecipeIngredientLine` rows with `preparationFactor=1.0` (no prep info in M6).
4. Map `Recipe.prepTimeMin` / `cookTimeMin` directly; set `coolTimeMin=restTimeMin=cleanupTimeMin=0`.
5. The M6 `/api/v1/food-domain/recipes/*` routes become thin proxies to `/api/v1/fims/recipes/*` for one release, then are deprecated.

---

## 12. References

- `CATALOG_ARCHITECTURE.md` — `FoodCatalog`, `IngredientVariant`, `IngredientAlias`.
- `NUTRITION_ENGINE_GUIDE.md` — `NutritionFact` roll-up at scale time.
- `MEASUREMENT_SYSTEM_GUIDE.md` — `MeasurementConverter` used by the scaler.
- `INVENTORY_GUIDE.md` — `InventoryReservation` created from scaled ingredient lines.
- M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` — `Recipe`, `RecipeIngredient`, `NutritionProfile`.
- M2 `docs/identity/AUTHORIZATION_POLICIES.md` — permission model.
- M1 `docs/EVENT_CONVENTIONS.md`, `docs/CODING_STANDARDS.md`.
