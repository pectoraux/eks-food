# Eks-Food Customer Platform — Food Preference Intelligence Guide

> **Audience:** Platform engineers, data scientists, recommendation engineers (M9+), product managers. Read alongside `PLATFORM_ARCHITECTURE.md`, `HOUSEHOLD_MODEL_GUIDE.md`, `MEAL_PLANNING_GUIDE.md`, and the M7 `docs/fims/NUTRITION_ENGINE_GUIDE.md` (the `DietaryProfile`, `Allergen`, `NutritionProfile` models referenced here).
>
> **Status:** Milestone 8 (Customer Platform). This document specifies the target preference intelligence model: `CustomerPreference`, `CuisinePreference`, `IngredientPreference`, `DietaryProfileAssignment`, `AllergyRecord`, `NutritionGoal`. M8 stores and resolves preferences; M9+ consumes them via the `/api/v1/customer/preferences/:profileId/resolve` endpoint.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- **Six normalized preference models** replacing the M6 `CustomerProfile` JSON blobs (`dietaryPrefs`, `favoriteCuisines`, `favoriteMeals`, `allergies`, `nutritionGoals`, `cookingPrefs`).
- **Explicit vs implicit provenance** — every preference row records whether the customer stated it (`EXPLICIT_SURVEY`, `EXPLICIT_UI`) or whether the platform inferred it (`IMPLICIT_FAVORITE`, `IMPLICIT_HISTORY`, `IMPLICIT_REVIEW`, `IMPLICIT_PANTRY`, `IMPLICIT_RECOMMENDER`).
- **Preference scoring** on a -100 (strong dislike) to +100 (strong preference) scale with a 0..1 `confidence` field that decays over time for implicit preferences.
- **Conflict resolution** — explicit preferences always override implicit preferences. Among implicit preferences, more recent + higher-confidence sources win.
- **A single resolution endpoint** (`/api/v1/customer/preferences/:profileId/resolve`) that returns the merged, de-conflicted, scored preference set for a profile, ready for consumption by recommendation engines.
- **Allergen safety** — `AllergyRecord` rows are always high-priority hard constraints that override any preference (a customer who loves peanut butter but has a `SEVERE` peanut allergy is never recommended peanut-containing recipes).
- **Graph projection** — every preference creates M6 `GraphNode`/`GraphEdge` entries so the M6 `GraphEngine` can compute "customers who prefer spicy Ghanaian cuisine" for cohort queries.

### 1.2 Non-Goals

- **Recommendation generation** — M9+ consumes the resolved preferences; M8 does not rank recipes, generate suggestions, or score match quality.
- **Cross-customer preference inference** — M8 stores per-customer preferences only; collaborative filtering happens in M9+.
- **Real-time preference updates from sensor data** (smart fridge, etc.) — out of scope.
- **Nutrition plan adherence tracking** — M8 stores `NutritionGoal` and `MealHistory` separately; adherence calculation is an M10+ analytics concern.

---

## 2. The Six Preference Models

### 2.1 `CustomerPreference` (root)

```
model CustomerPreference {
  id              String   @id @default(cuid())
  organizationId  String
  profileId       String                     // FK → CustomerProfile
  preferenceType  String                     // CUISINE|INGREDIENT|COOKING_STYLE|MEAL_SIZE|PREPARATION|BEVERAGE|SNACK|RESTAURANT
  targetId        String                     // polymorphic FK: cuisine code, FoodCatalog.id, cooking style code, etc.
  targetType      String                     // CUISINE|INGREDIENT|COOKING_STYLE|MEAL_SIZE|PREPARATION_METHOD|BEVERAGE|SNACK|RESTAURANT
  // Scoring
  score           Int      @default(0)       // -100 (strong dislike) to +100 (strong preference); 0 = neutral
  confidence      Float    @default(0.5)     // 0.0 to 1.0
  // Provenance
  provenance      String                     // EXPLICIT_SURVEY|EXPLICIT_UI|IMPLICIT_FAVORITE|IMPLICIT_HISTORY|IMPLICIT_REVIEW|IMPLICIT_PANTRY|IMPLICIT_RECOMMENDER
  sourceRef       String?                    // JSON: { mealHistoryId?, favoriteId?, reviewId?, surveyId? }
  observedAt      DateTime  @default(now())  // when the preference signal was observed
  decayedAt       DateTime?                  // when the confidence was last decayed (NULL = never)
  // Override chain
  overriddenBy    String?                    // CustomerPreference.id that overrides this row (NULL = active)
  overrides       String?                    // CustomerPreference.id that this row overrides (NULL = no prior)
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  profile         CustomerProfile @relation(fields: [profileId], references: [id])

  @@unique([profileId, preferenceType, targetId, overriddenBy])
  @@index([organizationId])
  @@index([profileId, preferenceType])
  @@index([provenance, observedAt])
  @@index([targetType, targetId])
}
```

### 2.2 `CuisinePreference`

A denormalized, query-optimized view of `CustomerPreference` rows where `preferenceType=CUISINE`. Maintained by the `PreferenceService` on every preference write.

```
model CuisinePreference {
  id              String   @id @default(cuid())
  organizationId  String
  profileId       String
  cuisineCode     String                     // e.g. "ghanaian", "nigerian", "italian", "vegan"
  preferenceScore Int      @default(0)       // -100..+100 (mirrors CustomerPreference.score)
  spiceLevel      Int      @default(3)       // 1 (mild) to 5 (very spicy)
  cookingStyles   String   @default("[]")    // JSON: ["grilled","stewed","fried"]
  provenance      String
  confidence      Float    @default(0.5)
  observedAt      DateTime  @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  profile         CustomerProfile @relation(fields: [profileId], references: [id])

  @@unique([profileId, cuisineCode])
  @@index([organizationId])
  @@index([profileId, preferenceScore])
  @@index([cuisineCode, preferenceScore])
}
```

### 2.3 `IngredientPreference`

Same shape as `CuisinePreference` but for individual ingredients, linking to the M7 `FoodCatalog`.

```
model IngredientPreference {
  id              String   @id @default(cuid())
  organizationId  String
  profileId       String
  catalogItemId   String                     // FK → FoodCatalog (itemType=INGREDIENT)
  preferenceScore Int      @default(0)
  preparationMethods String @default("[]")   // JSON: ["raw","grilled","boiled","fried"]
  preferredBrands String   @default("[]")    // JSON array of brand codes
  provenance      String
  confidence      Float    @default(0.5)
  observedAt      DateTime  @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  profile         CustomerProfile @relation(fields: [profileId], references: [id])
  catalogItem     FoodCatalog     @relation(fields: [catalogItemId], references: [id])

  @@unique([profileId, catalogItemId])
  @@index([organizationId])
  @@index([profileId, preferenceScore])
  @@index([catalogItemId, preferenceScore])
}
```

### 2.4 `DietaryProfileAssignment`

Links a customer to an M7 `DietaryProfile` (VEGAN, VEGETARIAN, HALAL, KOSHER, GLUTEN_FREE, DAIRY_FREE, KETO, PALEO, LOW_SODIUM, DIABETIC_FRIENDLY) with a `strictness` level.

```
model DietaryProfileAssignment {
  id              String   @id @default(cuid())
  organizationId  String
  profileId       String
  dietaryProfileId String                   // FK → DietaryProfile (M7)
  strictness      String   @default("MODERATE") // FLEXIBLE|MODERATE|STRICT
  provenance      String                     // usually EXPLICIT_SURVEY or EXPLICIT_UI
  observedAt      DateTime  @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  metadata        String   @default("{}")   // e.g. { "ramadanExempt": true }

  profile         CustomerProfile @relation(fields: [profileId], references: [id])
  dietaryProfile  DietaryProfile  @relation(fields: [dietaryProfileId], references: [id])

  @@unique([profileId, dietaryProfileId])
  @@index([organizationId])
  @@index([profileId])
  @@index([dietaryProfileId, strictness])
}
```

### 2.5 `AllergyRecord`

A separate model from `CustomerPreference` because allergies are **hard constraints**, not preferences. An allergy is never overridden by a positive preference.

```
model AllergyRecord {
  id              String   @id @default(cuid())
  organizationId  String
  profileId       String
  allergenId      String                     // FK → Allergen (M7)
  severity        String                     // MILD|MODERATE|SEVERE|LIFE_THREATENING
  source          String                     // SELF_REPORTED|MEDICAL|INFERRED|GUARDIAN_REPORTED
  diagnosedAt     DateTime?
  notes           String?                    // e.g. "anaphylaxis — carries EpiPen"
  // Lifecycle
  status          String   @default("ACTIVE") // ACTIVE|RESOLVED|SUPERSEDED
  resolvedAt      DateTime?
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  profile         CustomerProfile @relation(fields: [profileId], references: [id])
  allergen        Allergen        @relation(fields: [allergenId], references: [id])

  @@unique([profileId, allergenId, status])
  @@index([organizationId])
  @@index([profileId, status])
  @@index([allergenId, severity])
}
```

### 2.6 `NutritionGoal`

Time-bound nutrition goals. A profile may have multiple goals over time (e.g. "bulk for 3 months, then cut for 2 months"); only one is `ACTIVE` at a time per `goalType`.

```
model NutritionGoal {
  id              String   @id @default(cuid())
  organizationId  String
  profileId       String
  goalType        String                     // CALORIES|MACRO|MICRO|WEIGHT|HYDRATION
  targetValue     Float
  unit            String                     // kcal|g|mg|L|kg
  // Time bound
  startDate       DateTime
  endDate         DateTime?
  // Optional template reference
  templateProfileId String?                  // FK → NutritionProfile (M7)
  // Macro/micro breakdown (JSON for flexibility)
  macroTargets    String   @default("{}")    // { protein: 150, carbs: 200, fat: 60 }
  microTargets    String   @default("{}")    // { sodium_mg: 2300, iron_mg: 18 }
  // Lifecycle
  status          String   @default("ACTIVE") // ACTIVE|ACHIEVED|DISCONTINUED|EXPIRED
  achievedAt      DateTime?
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  profile         CustomerProfile  @relation(fields: [profileId], references: [id])
  templateProfile NutritionProfile? @relation(fields: [templateProfileId], references: [id])

  @@unique([profileId, goalType, status])
  @@index([organizationId])
  @@index([profileId, status])
  @@index([startDate, endDate])
}
```

---

## 3. Explicit vs Implicit Provenance

### 3.1 Provenance taxonomy

| Code | Source | Confidence (default) | Decay rate | Override priority |
|---|---|:---:|:---:|:---:|
| `EXPLICIT_SURVEY` | Customer filled onboarding survey | 1.0 | none | highest |
| `EXPLICIT_UI` | Customer toggled a preference in the UI | 0.95 | none | highest |
| `IMPLICIT_FAVORITE` | Derived from `Favorite` row | 0.7 | 0.05/month | medium |
| `IMPLICIT_HISTORY` | Derived from `MealHistory` (last 90 days) | 0.8 | 0.05/month | medium |
| `IMPLICIT_REVIEW` | Derived from positive `Rating` (≥4) on a recipe/restaurant | 0.6 | 0.05/month | medium |
| `IMPLICIT_PANTRY` | Derived from `PantryItem.consumptionHistory` | 0.7 | 0.05/month | medium |
| `IMPLICIT_RECOMMENDER` | Written by M9+ recommendation engine (never overrides explicit) | 0.5 | 0.10/month | lowest |

### 3.2 Provenance recording

Every preference write records the `provenance` and `sourceRef` (a JSON object pointing to the originating artifact: a `mealHistoryId`, a `favoriteId`, a `reviewId`, a `surveyId`, or a `surveyQuestionId`). The `observedAt` field records when the signal was observed (e.g. the date of the meal in `MealHistory`, not the date the preference row was written — these can differ if the implicit derivation job runs nightly).

### 3.3 Confidence decay

Implicit preferences decay over time. The nightly `PreferenceDecayJob` (M1 cron, 02:00 UTC) recomputes `confidence` for every implicit preference:

```
confidence_new = confidence_old * (1 - decay_rate)^months_elapsed
```

Where `months_elapsed = (NOW() - observedAt) / 30 days` and `decay_rate` is the per-provenance value from §3.1. When `confidence < 0.1`, the preference row is marked `decayedAt=NOW()` and excluded from the resolution endpoint's default response (still queryable with `?includeDecayed=true`).

Explicit preferences do not decay — they remain at their original `confidence` until the customer changes them.

---

## 4. Preference Scoring

### 4.1 The -100 to +100 scale

| Score range | Meaning | Example |
|---|---|---|
| +75 to +100 | Strong preference | "I love jollof rice, cook it weekly" |
| +25 to +74 | Mild preference | "I enjoy jollof rice" |
| -24 to +24 | Neutral / no signal | (no preference row written) |
| -25 to -74 | Mild dislike | "I'll eat it but prefer alternatives" |
| -75 to -100 | Strong dislike | "I cannot stand it" |

### 4.2 Score derivation from implicit signals

| Signal | Derived score |
|---|---|
| `Favorite` added | +75 (one-time) |
| `MealHistory` entry (eaten) | +25 per meal, capped at +100 |
| `Rating` 5 stars | +50 |
| `Rating` 4 stars | +25 |
| `Rating` 3 stars | 0 (no preference written) |
| `Rating` 2 stars | -25 |
| `Rating` 1 star | -50 |
| `PantryItem` consumed ≥3 times in 30 days | +50 |
| `PantryItem` purchased but expired unconsumed (waste) | -25 |
| `Review` text sentiment positive (NLP, M9+) | +25 to +50 (scaled by confidence) |
| `Review` text sentiment negative | -25 to -50 |

The nightly `PreferenceDerivationJob` runs these derivations and writes new `CustomerPreference` rows with the appropriate `provenance` and `sourceRef`. Multiple signals for the same `(profileId, preferenceType, targetId)` accumulate; the `PreferenceService.resolve` endpoint merges them per §6.

---

## 5. Household-Level Preference Resolution

Preferences are stored per-profile, but household-level queries need aggregated views. The `PreferenceService.resolveHousehold(householdId)` endpoint returns the merged preference set for all `ACTIVE` members of a household, with conflict resolution rules:

1. **Allergies** (always): union of all members' allergies. A recipe is rejected if it contains any member's active allergen.
2. **Dietary profiles**: intersection (most restrictive wins). If one member is vegan, the household meal is vegan.
3. **Cuisine preferences**: weighted average, weighted by member's role weight (`ADMIN=1.0`, `GUARDIAN=1.0`, `DEPENDENT=0.7`, `GUEST=0.5`, `CAREGIVER=0.3`).
4. **Ingredient preferences**: weighted average; any member with score ≤ -50 vetoes (the ingredient is excluded).
5. **Spice level**: max across members (spice-lovers' preference wins, but mild options are flagged for the sensitive member).
6. **Nutrition goals**: not aggregated (each member has their own goal); the household meal plan should satisfy each member's macro target via the M7 `NutritionCalculator`.

---

## 6. Conflict Resolution — Explicit Overrides Implicit

### 6.1 The override chain

When a new preference is written that conflicts with an existing one (same `profileId`, `preferenceType`, `targetId`), the `PreferenceService.applyOverride` algorithm:

1. Loads the current active preference (where `overriddenBy IS NULL`).
2. Compares `provenance` priority:
   - If new.provenance is explicit and existing.provenance is implicit → new overrides existing.
   - If new.provenance is explicit and existing.provenance is explicit → new overrides existing (customer's latest word wins).
   - If new.provenance is implicit and existing.provenance is explicit → new is **rejected** with `CUSTOMER_PREFERENCE_EXPLICIT_NOT_OVERRIDABLE` error; an `IMPLICIT_RECOMMENDER` row may still be written but is excluded from `resolve`.
   - If new.provenance is implicit and existing.provenance is implicit → higher `confidence` wins; if equal confidence, more recent `observedAt` wins.
3. Sets `existing.overriddenBy = new.id` and `new.overrides = existing.id`.
4. Emits `CustomerPreference.Overridden` event with both row IDs.
5. Writes `CUSTOMER_PREFERENCE_OVERRIDDEN` audit action.

The override chain is preserved — querying the history of a preference returns all prior rows, ordered by `observedAt DESC`. This is the data the M9+ recommendation engine uses to learn "the customer used to love peanuts but developed an allergy last month".

### 6.2 Allergy override

Allergies are not part of the override chain — they live in `AllergyRecord` and are always treated as hard constraints. A positive `IngredientPreference` for `peanut` (score +90) coexists with a `SEVERE` `AllergyRecord` for `peanut`. The `resolve` endpoint returns both; consumers (M9+) must check `AllergyRecord` first and exclude any matching ingredients regardless of preference score.

### 6.3 Example conflict resolution

```
Day 1: Customer adds "peanut butter" to favorites.
       → writes CustomerPreference(target=peanut_butter, score=+75, provenance=IMPLICIT_FAVORITE, confidence=0.7)
       → writes IngredientPreference(catalogItemId=peanut, score=+50, provenance=IMPLICIT_FAVORITE)

Day 30: Customer rates a peanut soup recipe 5 stars.
        → writes CustomerPreference(target=peanut, score=+50, provenance=IMPLICIT_REVIEW, confidence=0.6)
        → conflict with existing IMPLICIT_FAVORITE row at score +50
        → both implicit, equal score → newer (IMPLICIT_REVIEW) wins by observedAt
        → existing.overriddenBy = new.id

Day 60: Customer explicitly marks "I don't like peanuts" in the UI.
        → writes CustomerPreference(target=peanut, score=-75, provenance=EXPLICIT_UI, confidence=0.95)
        → new is explicit, existing is implicit → new overrides
        → existing.overriddenBy = new.id
        → audit: CUSTOMER_PREFERENCE_OVERRIDDEN (oldProvenance=IMPLICIT_REVIEW, newProvenance=EXPLICIT_UI)

Day 90: Recommendation engine suggests peanut recipes based on MealHistory (stale implicit signal).
        → attempt to write IMPLICIT_RECOMMENDER score=+30 → REJECTED with CUSTOMER_PREFERENCE_EXPLICIT_NOT_OVERRIDABLE
        → row may still be written but excluded from resolve() default response
```

---

## 7. The `resolve` Endpoint

`GET /api/v1/customer/preferences/:profileId/resolve?includeDecayed=false&includeOverridden=false` returns the merged preference set:

```json
{
  "profileId": "prof-kwame",
  "resolvedAt": "2025-01-15T10:30:00Z",
  "cuisines": [
    { "cuisineCode": "ghanaian", "score": 90, "confidence": 0.95, "provenance": "EXPLICIT_SURVEY", "spiceLevel": 4 },
    { "cuisineCode": "nigerian", "score": 60, "confidence": 0.7, "provenance": "IMPLICIT_HISTORY", "spiceLevel": 3 }
  ],
  "ingredients": [
    { "catalogItemId": "fc-rice-lg-001", "score": 85, "confidence": 0.9, "provenance": "EXPLICIT_UI" },
    { "catalogItemId": "fc-peanut-001", "score": -75, "confidence": 0.95, "provenance": "EXPLICIT_UI" }
  ],
  "dietaryProfiles": [
    { "dietaryProfileId": "dp-halal", "strictness": "STRICT", "provenance": "EXPLICIT_SURVEY" }
  ],
  "allergies": [
    { "allergenId": "al-peanut", "severity": "SEVERE", "source": "MEDICAL" }
  ],
  "nutritionGoals": [
    { "goalType": "CALORIES", "targetValue": 2200, "unit": "kcal", "status": "ACTIVE", "endDate": "2025-03-31" }
  ],
  "excluded": {
    "decayed": 3,
    "overridden": 5,
    "rejectedImplicit": 2
  }
}
```

The response is cached in the M1 `@eks/cache` LRU (key `customer:pref:resolve:{profileId}:{includeDecayed}:{includeOverridden}`, TTL 5 min, invalidated on any preference write for that profile).

---

## 8. Graph Projection

Every preference write emits a domain event consumed by the M1 `@eks/workers` projection worker. The worker creates or updates M6 `GraphEdge` rows:

| Preference type | Graph edge | Example |
|---|---|---|
| `CuisinePreference` (score > 0) | `prefers_cuisine` from `customer_profile` node to `cuisine` node | Kwame →prefers_cuisine→ Ghanaian |
| `CuisinePreference` (score < 0) | `dislikes_cuisine` | Kwame →dislikes_cuisine→ Thai |
| `IngredientPreference` (score > 0) | `prefers_ingredient` | Kwame →prefers_ingredient→ rice |
| `IngredientPreference` (score < 0) | `dislikes_ingredient` | Kwame →dislikes_ingredient→ peanut |
| `DietaryProfileAssignment` | `follows_diet` | Kwame →follows_diet→ Halal |
| `AllergyRecord` | `allergic_to` | Kwame →allergic_to→ Peanut |

Edges carry `weight = score/100` and `confidence` as edge attributes. The M6 `GraphEngine.traverse` can then compute:

- "Find all customers who prefer Ghanaian cuisine and are allergic to peanut" (intersection of two edge traversals).
- "Find all cuisines preferred by customers who follow a Halal diet" (one-hop traversal + group-by).
- "Find customers with preference graph similar to customer X" (graph similarity, M9+ collaborative filtering input).

---

## 9. Preference Lifecycle Events

| Event | Trigger | Side effects |
|---|---|---|
| `CustomerPreference.Recorded` | New preference row created | Graph edge projected; cache invalidated |
| `CustomerPreference.Updated` | Existing preference row's score/confidence changed | Graph edge weight updated; cache invalidated |
| `CustomerPreference.Decayed` | Nightly decay job lowered confidence below threshold | Graph edge weight updated; cache invalidated |
| `CustomerPreference.Overridden` | New preference overrode existing | Old edge ended (`validTo=now`); new edge created |
| `CustomerPreference.Removed` | Customer deleted preference | Graph edge hard-deleted; cache invalidated |
| `AllergyRecord.Recorded` | New allergy recorded | Hard constraint propagated to all household members' resolve responses; `MealPlan` audit job flags meals containing the allergen |
| `AllergyRecord.Updated` | Severity or status changed | Same propagation |
| `AllergyRecord.Removed` | Allergy resolved | Constraint lifted; `MealPlan` audit job re-checks |
| `NutritionGoal.Set` | New goal created | `MealPlanService` re-evaluates active plans for adherence |
| `NutritionGoal.Updated` | Goal target changed | Same |
| `NutritionGoal.Achieved` | Goal marked achieved (manual or via M10+ adherence tracker) | Goal `status=ACHIEVED`, `achievedAt=now` |
| `NutritionGoal.Discontinued` | Customer discontinued goal | Goal `status=DISCONTINUED`, `endDate=now` |

---

## 10. API Examples

### 10.1 Record an explicit cuisine preference

```http
POST /api/v1/customer/preferences/prof-kwame/cuisines
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
Idempotency-Key: pref-ghanaian-001

{
  "cuisineCode": "ghanaian",
  "preferenceScore": 90,
  "spiceLevel": 4,
  "cookingStyles": ["stewed", "grilled", "fried"],
  "provenance": "EXPLICIT_UI"
}
```

Response `201 Created`:
```json
{
  "id": "cp-kwame-ghanaian-001",
  "profileId": "prof-kwame",
  "cuisineCode": "ghanaian",
  "preferenceScore": 90,
  "spiceLevel": 4,
  "provenance": "EXPLICIT_UI",
  "confidence": 0.95
}
```

### 10.2 Record a severe allergy

```http
POST /api/v1/customer/preferences/prof-kwame/allergies
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member

{
  "allergenId": "al-peanut",
  "severity": "SEVERE",
  "source": "MEDICAL",
  "diagnosedAt": "2024-08-15",
  "notes": "Anaphylaxis — carries EpiPen"
}
```

Response `201 Created` (with hard-constraint propagation acknowledgment):
```json
{
  "id": "ar-kwame-peanut-001",
  "profileId": "prof-kwame",
  "allergenId": "al-peanut",
  "severity": "SEVERE",
  "status": "ACTIVE",
  "propagatedTo": {
    "householdMealPlans": 2,
    "pantryItemsFlagged": 1,
    "shoppingListItemsFlagged": 0
  }
}
```

### 10.3 Resolve all preferences

```http
GET /api/v1/customer/preferences/prof-kwame/resolve?includeDecayed=false&includeOverridden=false
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
```

(See §7 for the response shape.)

---

## 11. Future Recommendation Engine Contract

The M9+ recommendation engine consumes the `/api/v1/customer/preferences/:profileId/resolve` endpoint and follows these rules:

1. **Allergies first.** Any recipe containing an active allergen for any household member is excluded before scoring.
2. **Dietary profiles second.** Any recipe violating the strictness level of any member's dietary profile is excluded.
3. **Explicit preferences third.** Recipes matching explicit positive preferences get a +score boost; recipes matching explicit negative preferences get a -score penalty.
4. **Implicit preferences fourth.** Recipes matching implicit preferences get a smaller boost scaled by `confidence`.
5. **No implicit overrides.** The engine may write `IMPLICIT_RECOMMENDER` preferences (e.g. "customer engaged positively with recipe X we suggested") but these never override explicit preferences — see §6.
6. **Provenance transparency.** The engine's suggestions must include a `reasoning` array referencing the preference rows that drove the suggestion (for UI explanation: "Because you love Ghanaian cuisine and have peanuts in your pantry").

---

## 12. Cross-References

- `PLATFORM_ARCHITECTURE.md` §3.3 — preference bounded context overview.
- `HOUSEHOLD_MODEL_GUIDE.md` §4 — member roles that drive household preference weighting.
- `MEAL_PLANNING_GUIDE.md` §6 — how meal plan generation consumes resolved preferences.
- `PANTRY_MANAGEMENT_GUIDE.md` §5 — pantry consumption feeding implicit preferences.
- `PRIVACY_PERMISSIONS_GUIDE.md` §5 — child-safety gating on preference writes (minors cannot write public preferences without guardian co-sign).
- M6 `docs/food-domain/GRAPH_ARCHITECTURE.md` — `GraphEngine.traverse` for preference-based cohort queries.
- M7 `docs/fims/NUTRITION_ENGINE_GUIDE.md` — `DietaryProfile`, `Allergen`, `NutritionProfile` definitions.
- M7 `docs/fims/CATALOG_ARCHITECTURE.md` — `FoodCatalog` referenced by `IngredientPreference.catalogItemId`.
- M7 `docs/fims/RECIPE_ENGINE_GUIDE.md` — `RecipeVersion.allergenIds` used for allergy-recipe matching.
