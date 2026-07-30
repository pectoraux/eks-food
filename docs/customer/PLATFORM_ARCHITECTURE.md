# Eks-Food Customer Platform — Platform Architecture

> **Audience:** Platform engineers, full-stack engineers, data engineers, product managers. Read alongside `HOUSEHOLD_MODEL_GUIDE.md`, `PREFERENCE_INTELLIGENCE_GUIDE.md`, `MEAL_PLANNING_GUIDE.md`, `PANTRY_MANAGEMENT_GUIDE.md`, `SHOPPING_LIST_GUIDE.md`, `PRIVACY_PERMISSIONS_GUIDE.md`, `OPERATIONAL_RUNBOOKS.md`, and the M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md`.
>
> **Status:** Milestone 8 (Customer Platform, Household Management & Food Preference Intelligence). This document specifies the target architecture for the `@eks/customer` package and the `/api/v1/customer/*` route family. It extends the M6 canonical `Household` and `CustomerProfile` models (which shipped as JSON-blob placeholders) with twenty-one fully-normalized Prisma models that make customer data queryable, auditable, and privacy-controlled.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- **One canonical customer profile** per real-world person, living across multiple households (family home, shared apartment, office kitchen) without duplication.
- **Twenty-one normalized Prisma models** — `HouseholdMember`, `HouseholdRelationship`, `CustomerPreference`, `CuisinePreference`, `IngredientPreference`, `DietaryProfileAssignment`, `AllergyRecord`, `NutritionGoal`, `Address`, `DeliveryInstruction`, `MealHistory`, `MealPlan`, `MealCalendar`, `ShoppingList`, `ShoppingListItem`, `Pantry`, `PantryItem`, `Favorite`, `Review`, `Rating`, `CustomerNotificationPreference` — replacing the JSON-blob fields on the M6 `CustomerProfile` (`dietaryPrefs`, `allergies`, `favoriteCuisines`, `favoriteMeals`, `nutritionGoals`, `cookingPrefs`).
- **Bidirectional integration** with M2 Identity (User, Session, Membership, RBAC), M5 Connectors (Maps, Calendar, Notifications), M6 Food Domain (Household canonical, GraphNode for the preference→ingredient→recipe graph), and M7 FIMS (FoodCatalog, RecipeVersion, InventoryStock, DietaryProfile, Allergen).
- **Explicit preference provenance** — every preference row records whether it was stated by the customer (`EXPLICIT_SURVEY`, `EXPLICIT_UI`), or derived from behaviour (`IMPLICIT_FAVORITE`, `IMPLICIT_HISTORY`, `IMPLICIT_REVIEW`, `IMPLICIT_PANTRY`).
- **Privacy by design** — child privacy protections on dependents under 13, GDPR-ready data subject rights (export, deletion, portability), tenant isolation inherited from M2, and auditable access to all sensitive reads. See `PRIVACY_PERMISSIONS_GUIDE.md`.
- **Foundation, not optimization** — the platform stores preference signals, meal plans, pantry state, and shopping lists. It does **not** run a recommendation engine or automated procurement in M8; those are M9+ concerns that will consume the data produced here.

### 1.2 Non-Goals

- Recommendation engines (M9+ — see §10 for the consumption contract).
- Automated grocery ordering or procurement (M5 `ProcurementConnection` is for the cook/kitchen side; M8 customer-side shopping lists are manual or recipe-generated only).
- Payment processing — the M1 Payswap port and M2 identity cover payment identity; the Customer Platform never touches card tokens.
- Authentication & authorization mechanisms — those are M2's job; the Customer Platform consumes `RequestContext.userId` and `RequestContext.organizationId` and applies its own household-level ABAC layer on top.
- Restaurant-side menus, cook-side profiles — see M6 `CookProfile`, `Restaurant`, `Menu`, `MenuItem`.

---

## 2. Package Layout — `@eks/customer`

The M8 `@eks/customer` package mirrors the layout of `@eks/fims` and `@eks/food-domain`: a single TypeScript entry point with named exports per module, a `package.json` declaring the private package, an `events.ts` registry, an `audit-actions.ts` registry, and a `__tests__/` directory per module. Path alias `@eks/customer` is registered in `tsconfig.json` alongside the other 23 packages.

```
src/packages/customer/
├── index.ts                     # barrel re-export
├── package.json                 # { "name": "@eks/customer", "private": true }
├── events.ts                    # customer.*.v1 event registry + buildCustomerEvent factory
├── audit-actions.ts             # CUSTOMER_* uppercase-SNAKE_CASE audit codes
├── preferences.ts               # PreferenceService — resolve explicit + implicit, decay, conflict resolution
├── household.ts                 # HouseholdService — create, invite, addMember, changeRole, depart
├── meal-planning.ts             # MealPlanService — create, schedule, calendar sync
├── pantry.ts                    # PantryService — inventory, expiration scanning, low-stock detection
├── shopping-list.ts             # ShoppingListService — collaborative lists, conflict resolution
├── reviews.ts                   # ReviewService — submit, moderate, ratings rollup
├── privacy.ts                   # PrivacyService — export, delete, portability, child-safety checks
├── permissions.ts               # HouseholdPermissionResolver — admin/guardian/dependent/guest/caregiver
└── __tests__/
    ├── events.spec.ts
    ├── audit-actions.spec.ts
    ├── preferences.spec.ts
    ├── household.spec.ts
    ├── meal-planning.spec.ts
    ├── pantry.spec.ts
    ├── shopping-list.spec.ts
    ├── reviews.spec.ts
    ├── privacy.spec.ts
    └── permissions.spec.ts
```

All services follow the M7 convention: stateless class with constructor-injected Prisma client, async methods returning plain DTOs, no Express/Next coupling. Route handlers in `src/app/api/v1/customer/*` are thin wrappers that call the services and serialize via `@eks/api/response` (`success()`, `error()` with RFC 7807 `problem+json`).

---

## 3. The Twenty-One Prisma Models

The M8 schema is grouped into eight bounded contexts within the Customer Platform. All models are tenant-scoped (carry `organizationId` as the first index column per M2 `MULTI_TENANCY.md` §2) and carry the M6 standard audit block (`createdAt`, `updatedAt`, `deletedAt`, `createdBy`, `updatedBy`, `version`).

### 3.1 Identity & Profile (extends M6 `CustomerProfile`)

| Model | Purpose | Replaces |
|---|---|---|
| `CustomerProfile` (extended) | Root aggregate — name, locale, accessibility, cultural prefs, communication channels, meal times, cooking prefs, restaurant prefs | M6 JSON blobs `dietaryPrefs`, `favoriteCuisines`, `cookingPrefs` |
| `Address` (extended) | Delivery addresses with geocoded lat/lng, label, default flag, verification status | M1 `Address` (gains `verifiedAt`, `geocodedAt`, `deliveryZoneId`) |
| `DeliveryInstruction` | Per-address delivery instructions (gate code, floor, contact-free preference) | Was a free-text column on M1 `Address.instructions` |
| `CustomerNotificationPreference` | Per-channel opt-ins (email, SMS, push, in-app) and per-event-type preferences (booking reminders, meal plan reminders, review requests, marketing) | New in M8 |

### 3.2 Household (extends M6 `Household`)

| Model | Purpose |
|---|---|
| `Household` (extended) | Adds `householdType` (FAMILY, ROOMMATES, APARTMENT, OFFICE, SHARED_KITCHEN, INSTITUTION), `kitchenShared`, `defaultAddressId` |
| `HouseholdMember` | The membership join row — a `CustomerProfile` belongs to a `Household` with a `role` (ADMIN, GUARDIAN, DEPENDENT, GUEST, CAREGIVER), `joinedAt`, `departedAt`, `invitedBy` |
| `HouseholdRelationship` | Auditable directed relationships between members (SPOUSE, PARENT, CHILD, SIBLING, ROOMMATE, COLLEAGUE, CAREGIVER_FOR, GUARDIAN_OF) with `validFrom`, `validTo` for temporal history |

### 3.3 Preferences

| Model | Purpose | Links to |
|---|---|---|
| `CustomerPreference` | Root preference row carrying `provenance` (EXPLICIT_SURVEY / EXPLICIT_UI / IMPLICIT_FAVORITE / IMPLICIT_HISTORY / IMPLICIT_REVIEW / IMPLICIT_PANTRY), `score` (-100..+100), `confidence` (0..1), `decayedAt` | The `CustomerProfile.id` |
| `CuisinePreference` | Favorite/disliked cuisines, spice level, cooking style | M6 graph node `cuisine` |
| `IngredientPreference` | Favorite/disliked ingredients, preparation methods | M7 `FoodCatalog.id` (INGREDIENT class) |
| `DietaryProfileAssignment` | Links a customer to an M7 `DietaryProfile` (VEGAN, HALAL, etc.) with `strictness` (FLEXIBLE, MODERATE, STRICT) | M7 `DietaryProfile.id` |
| `AllergyRecord` | Allergies with severity (MILD, MODERATE, SEVERE, LIFE_THREATENING), source (SELF_REPORTED, MEDICAL, INFERRED), `diagnosedAt` | M7 `Allergen.id` |
| `NutritionGoal` | Time-bound nutrition goals (calories, macros, micros) with `startDate`, `endDate`, `targetValue`, `unit` | Optional M7 `NutritionProfile` template |

### 3.4 Food History

| Model | Purpose |
|---|---|
| `MealHistory` | Per-meal record — what was eaten, when, where (home/restaurant), who cooked, rating, photos. Drives implicit preference derivation. |
| `Favorite` (extended) | Polymorphic favorites — cook, recipe, restaurant, menu item, ingredient. Extends M1 cook-only `Favorite` with `entityType` discriminator. |

### 3.5 Meal Planning

| Model | Purpose |
|---|---|
| `MealPlan` | A plan covering a date range (weekly, monthly, special occasion, holiday) for a household or member. State machine: DRAFT → COMMITTED → ACTIVE → COMPLETED → ARCHIVED. |
| `MealCalendar` | Per-day entries within a plan — meal type (BREAKFAST, LUNCH, DINNER, SNACK, BRUNCH, TEA), `recipeId` (M7 `RecipeVersion`), `scheduledAt`, `servings`, `householdMemberIds[]`. Syncs bidirectionally with M5 `CalendarConnection`. |

### 3.6 Pantry

| Model | Purpose |
|---|---|
| `Pantry` | Per-household (or per-member) pantry — a logical location. References an M7 `InventoryLocation` of `locationType=HOUSEHOLD` for physical stock alignment. |
| `PantryItem` | One row per stocked item — `catalogItemId` (M7 `FoodCatalog`), `quantity`, `unit` (M7 `MeasurementUnit`), `expiresAt`, `preferredBrandId`, `consumptionHistory` (JSON array of `{date, quantity, mealHistoryId}`) |

### 3.7 Shopping

| Model | Purpose |
|---|---|
| `ShoppingList` | Per-household, per-trip list. `tripType` (WEEKLY_GROCERY, TOP_UP, EVENT, RECIPE_GENERATED), `status` (OPEN, COMPLETED, ARCHIVED), `assignedTo[]`, `dueAt` |
| `ShoppingListItem` | `catalogItemId`, `quantity`, `unit`, `addedBy`, `addedAt`, `source` (MANUAL, RECIPE_GENERATED, RECURRING, SUBSTITUTION), `status` (PENDING, IN_CART, PURCHASED, UNAVAILABLE), `substitutedForItemId` |

### 3.8 Reviews

| Model | Purpose |
|---|---|
| `Review` | Long-form review — `entityType` (COOK, RECIPE, RESTAURANT, MENU_ITEM, DELIVERY), `entityId`, `title`, `body`, `status` (PENDING, APPROVED, REJECTED, REMOVED, DISPUTED), `moderatedAt`, `moderatedBy`, `householdMemberId` |
| `Rating` | Numeric rating (1-5 stars, fractional to 0.5) on the same entities — kept separate from `Review` so ratings can exist without a written review and vice-versa |

---

## 4. Customer Profile Anatomy

The `CustomerProfile` aggregate (M8 extended from M6) carries the customer's identity-adjacent fields. The M2 `User` is the security principal; the M6/M8 `CustomerProfile` is the food-domain persona. A single `User` may have multiple `CustomerProfile` rows (one per organization they belong to) but only one per organization.

```
model CustomerProfile {
  id              String   @id @default(cuid())
  organizationId  String
  userId          String?                      // M2 User.id (nullable for dependents w/o accounts)
  householdId     String?                      // primary household; secondary memberships via HouseholdMember
  name            String
  email           String?
  phone           String?
  // Communication
  preferredLocale String   @default("en")      // IETF tag: en, tw, ga, fr, ha
  preferredLanguage String @default("en")
  // Accessibility
  accessibilityPrefs String @default("{}")     // { largeText, screenReader, reducedMotion, highContrast, captions }
  // Cultural preferences (JSON for flexibility, validated by tenant Zod schema)
  culturalPrefs   String   @default("{}")      // { dietaryReligion, fastingCalendar, celebrationCalendar }
  // Meal times (cron-like schedule)
  mealTimes       String   @default("{}")      // { breakfast: "07:00", lunch: "12:30", dinner: "19:00" }
  // Cooking preferences (high-level; detailed breakdown in CustomerPreference rows)
  cookingPrefs    String   @default("{}")      // { homeCookingFrequency, equipmentOwned, cuisineAffinities }
  // Restaurant preferences
  restaurantPrefs String   @default("{}")      // { priceRange, ambiance, cuisine, deliveryVsDineIn }
  // Lifecycle
  status          String   @default("ACTIVE")  // PENDING | ACTIVE | SUSPENDED | INACTIVE | DECEASED
  dateOfBirth     DateTime?                    // for child-privacy gating; NULL for self-only signups that skip DOB
  isMinor         Boolean  @default(false)     // derived at write time from dateOfBirth
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")      // tenant-validated JSONB extension point

  household       Household? @relation(fields: [householdId], references: [id])
  user            User?      @relation(fields: [userId], references: [id])

  @@index([organizationId])
  @@index([householdId])
  @@index([userId])
}
```

**Why JSON for `accessibilityPrefs`, `culturalPrefs`, `mealTimes`, `cookingPrefs`, `restaurantPrefs`?** These are heterogeneous, evolve frequently, and are rarely queried by indexed predicates. They use the M3 `@eks/registry` to register a tenant-specific Zod schema per field; the API layer validates before persisting. The structured, queryable fields (allergies, cuisines, ingredients, dietary profiles, nutrition goals) live in their own normalized tables.

---

## 5. Integration Map

### 5.1 M2 — Identity & Access Management

| Concern | M2 artifact | M8 usage |
|---|---|---|
| Authentication | `User`, `Session`, `Identity` | `CustomerProfile.userId` → `User.id`. Session tokens carry `userId` and `organizationId` via `RequestContext`. |
| Authorization | `Role`, `Permission`, `Membership`, `Policy` | Customer platform adds household-level ABAC via `HouseholdMember.role`. See `PRIVACY_PERMISSIONS_GUIDE.md` §3. |
| Multi-tenancy | `organizationId` invariant | Every M8 model carries `organizationId` as the first column of every composite index. |
| Organizations | `Organization`, `Team` | A `Household` may be linked to an `Organization` (for institutional households — office kitchen, school cafeteria). |
| Verification | `VerificationRequest` | Dependent accounts (children) require guardian-verified `VerificationRequest` before activation. |
| Notifications | `NotificationLog` | M8 `CustomerNotificationPreference` drives per-customer opt-ins consumed by the M5 NotificationConnector. |

### 5.2 M5 — Connectors

| Connector | Usage in M8 |
|---|---|
| `MapsConnector` | `Address` rows are geocoded via `MapsConnector.geocode(line1, city, region)` on write. The `lat`/`lng` columns, `deliveryZoneId`, and `verifiedAt` are populated. Reverse-geocode is used by the mobile app's "use my current location" feature. |
| `CalendarConnector` | `MealCalendar` rows are mirrored to the customer's connected calendar (Google, Outlook, Apple) via the M5 `CalendarConnection`. Bidirectional sync: a meal added in Google Calendar creates a `MealCalendar` row (after authZ check). |
| `NotificationConnector` | `CustomerNotificationPreference` rows are resolved per event type to choose channel (email/SMS/push/in-app) and provider (SendGrid, Twilio, Firebase, OneSignal — per M5 failover policy). |
| `WeatherConnector` | Used by meal-planning heuristics (M9+) to suggest lighter meals on hot days. M8 stores the weather-at-time-of-plan-creation in `MealPlan.metadata.weatherSnapshot` for future analysis. |

### 5.3 M6 — Food Domain

| M6 artifact | M8 usage |
|---|---|
| `Household` (canonical) | M8 extends this model with `householdType`, `kitchenShared`, `defaultAddressId`. The M6 row remains the canonical household entity across the platform. |
| `CustomerProfile` (canonical) | M8 extends with structured preference fields (§4). |
| `GraphNode`, `GraphEdge` | Each `CustomerPreference`, `CuisinePreference`, `IngredientPreference` creates a `GraphNode` of type `customer_preference` and edges `prefers` / `dislikes` / `allergic_to` to cuisine/ingredient nodes. This enables graph queries like "find customers who prefer spicy Ghanaian cuisine". |
| `Relationship` (canonical) | M8 `HouseholdRelationship` rows are mirrored as M6 `Relationship` records of type `family` / `roommate` / `caregiver` with temporal `validFrom`/`validTo`. |
| `GeoRegion`, `City`, `Neighborhood` | `Address.deliveryZoneId` references `Neighborhood.id`. Household defaults to neighborhood-level cuisine matching. |

### 5.4 M7 — Food Intelligence Platform

| M7 artifact | M8 usage |
|---|---|
| `FoodCatalog` | `IngredientPreference.catalogItemId` and `PantryItem.catalogItemId` reference `FoodCatalog.id` (filtered to `itemType=INGREDIENT`). |
| `RecipeVersion` | `MealCalendar.recipeId` references `RecipeVersion.id`. Recipe scaling (M7 `RecipeScaler`) is invoked when generating `ShoppingListItem` rows from a `MealPlan`. |
| `DietaryProfile` | `DietaryProfileAssignment.dietaryProfileId` references `DietaryProfile.id` (VEGAN, HALAL, KOSHER, etc.). |
| `Allergen` | `AllergyRecord.allergenId` references `Allergen.id`. Allergen checks during meal plan generation use M7 `NutritionCalculator.aggregateAllergens`. |
| `InventoryLocation`, `InventoryStock` | `Pantry.inventoryLocationId` references an `InventoryLocation` of `locationType=HOUSEHOLD`. Pantry stock is a customer-facing projection of the M7 inventory; the M7 `InventoryService` remains the system of record for stock movements. |
| `MeasurementUnit` | `PantryItem.unit`, `ShoppingListItem.unit` reference `MeasurementUnit.code` (e.g. `g`, `kg`, `cup`, `olonka`). |
| `NutritionProfile` | `NutritionGoal.templateProfileId` optionally references an M7 `NutritionProfile` (e.g. "DASH diet template") that seeds the goal's macro/micro targets. |

---

## 6. API Surface — `/api/v1/customer/*`

The route family follows the M7 pattern (thin Next.js route handlers, business logic in `@eks/customer` services, RFC 7807 errors via `@eks/api/response`). All routes require the M2 `x-eks-org`, `x-eks-user`, `x-eks-role` headers (M1 convention) plus an M8 `x-eks-household` header for household-scoped operations.

| Route | Method | Service | Purpose |
|---|---|---|---|
| `/api/v1/customer/profiles` | GET, POST | `HouseholdService` | List/create customer profiles |
| `/api/v1/customer/profiles/:id` | GET, PATCH, DELETE | `HouseholdService` | Read/update/soft-delete a profile |
| `/api/v1/customer/households` | GET, POST | `HouseholdService` | List/create households |
| `/api/v1/customer/households/:id` | GET, PATCH | `HouseholdService` | Read/update a household |
| `/api/v1/customer/households/:id/members` | GET, POST | `HouseholdService` | List/add members |
| `/api/v1/customer/households/:id/members/:memberId` | PATCH, DELETE | `HouseholdService` | Change role / depart member |
| `/api/v1/customer/households/:id/relationships` | GET, POST | `HouseholdService` | List/create relationships |
| `/api/v1/customer/preferences/:profileId` | GET | `PreferenceService` | Resolve all preferences (explicit + implicit) for a profile |
| `/api/v1/customer/preferences/:profileId/cuisines` | GET, POST, PATCH, DELETE | `PreferenceService` | CRUD cuisine preferences |
| `/api/v1/customer/preferences/:profileId/ingredients` | GET, POST, PATCH, DELETE | `PreferenceService` | CRUD ingredient preferences |
| `/api/v1/customer/preferences/:profileId/allergies` | GET, POST, DELETE | `PreferenceService` | CRUD allergies |
| `/api/v1/customer/preferences/:profileId/dietary-profiles` | GET, POST, DELETE | `PreferenceService` | Assign dietary profiles |
| `/api/v1/customer/preferences/:profileId/nutrition-goals` | GET, POST, PATCH | `PreferenceService` | CRUD nutrition goals |
| `/api/v1/customer/addresses` | GET, POST, PATCH, DELETE | (in `HouseholdService`) | CRUD addresses |
| `/api/v1/customer/addresses/:id/verify` | POST | `HouseholdService` | Trigger geocoding via M5 MapsConnector |
| `/api/z/v1/customer/meal-plans` | GET, POST | `MealPlanService` | List/create meal plans |
| `/api/v1/customer/meal-plans/:id` | GET, PATCH, DELETE | `MealPlanService` | Read/update/delete a plan |
| `/api/v1/customer/meal-plans/:id/calendar` | GET, POST, PATCH | `MealPlanService` | CRUD calendar entries |
| `/api/v1/customer/meal-plans/:id/sync-calendar` | POST | `MealPlanService` | Trigger bidirectional M5 CalendarConnector sync |
| `/api/v1/customer/pantries/:householdId` | GET | `PantryService` | Read household pantry |
| `/api/v1/customer/pantries/:householdId/items` | GET, POST, PATCH, DELETE | `PantryService` | CRUD pantry items |
| `/api/v1/customer/pantries/:householdId/low-stock` | GET | `PantryService` | Items at or below reorder level |
| `/api/v1/customer/pantries/:householdId/expiring` | GET | `PantryService` | Items expiring within N days |
| `/api/v1/customer/shopping-lists` | GET, POST | `ShoppingListService` | List/create shopping lists |
| `/api/v1/customer/shopping-lists/:id` | GET, PATCH, DELETE | `ShoppingListService` | Read/update/delete a list |
| `/api/v1/customer/shopping-lists/:id/items` | GET, POST, PATCH, DELETE | `ShoppingListService` | CRUD items |
| `/api/v1/customer/shopping-lists/:id/generate-from-plan` | POST | `ShoppingListService` | Auto-generate items from a `MealPlan` |
| `/api/v1/customer/favorites` | GET, POST, DELETE | `ReviewService` | List/add/remove favorites |
| `/api/v1/customer/reviews` | GET, POST | `ReviewService` | List/submit reviews |
| `/api/v1/customer/reviews/:id/moderate` | POST | `ReviewService` | Approve/reject/remove (admin only) |
| `/api/v1/customer/ratings` | GET, POST | `ReviewService` | List/submit ratings |
| `/api/v1/customer/notifications/preferences` | GET, PUT | (in `HouseholdService`) | Read/update notification preferences |
| `/api/v1/customer/privacy/export` | POST | `PrivacyService` | GDPR data export (async, returns jobId) |
| `/api/v1/customer/privacy/delete` | POST | `PrivacyService` | GDPR right to erasure (async) |
| `/api/v1/customer/privacy/audit-log` | GET | `PrivacyService` | Read customer's own audit trail |

All routes:
- Return RFC 7807 `application/problem+json` on errors with `code` field in `CUSTOMER_*` namespace (e.g. `CUSTOMER_HOUSEHOLD_NOT_FOUND`, `CUSTOMER_PERMISSION_DENIED`, `CUSTOMER_CHILD_SAFETY_VIOLATION`).
- Emit `customer.*.v1` domain events on every state-changing operation (see §7).
- Write `CUSTOMER_*` audit actions (see §8) for every privileged read or write.
- Are rate-limited via the M1 `@eks/api/rate-limit` middleware (100 req/min per user, 1000 req/min per org).
- Are idempotent on POST via the M1 `Idempotency-Key` header.

---

## 7. Domain Events — `customer.*.v1`

The M8 `events.ts` registry follows the M7 `FIMS_EVENTS` convention: PascalCase registry keys → `{Aggregate}.{PastTenseVerb}` wire strings, `as const` registry, derived `CustomerEvent` union type, `CustomerEventMeta` interface for per-event overrides, `buildCustomerEvent(name, aggregateId, payload, meta?)` factory pulling `requestContext()` from `@eks/observability` and `asUUID`/`asISODate`/`uuid` from `@eks/common`.

The registry contains at minimum these events (full list in `events.ts`):

| Aggregate | Events |
|---|---|
| `CustomerProfile` | `Created`, `Updated`, `Deactivated`, `Reactivated`, `Deleted` |
| `Household` | `Created`, `Updated`, `Dissolved` |
| `HouseholdMember` | `Invited`, `Joined`, `RoleChanged`, `Departed`, `Removed` |
| `HouseholdRelationship` | `Created`, `Ended` |
| `CustomerPreference` | `Recorded`, `Updated`, `Decayed`, `Overridden`, `Removed` |
| `AllergyRecord` | `Recorded`, `Updated`, `Removed` |
| `NutritionGoal` | `Set`, `Updated`, `Achieved`, `Discontinued` |
| `Address` | `Added`, `Updated`, `Verified`, `Removed`, `Defaulted` |
| `MealPlan` | `Created`, `Committed`, `Activated`, `Completed`, `Archived`, `Deleted` |
| `MealCalendar` | `Scheduled`, `Rescheduled`, `Cancelled`, `SyncedToCalendar` |
| `PantryItem` | `Added`, `Updated`, `Consumed`, `Expired`, `Removed` |
| `ShoppingList` | `Created`, `Completed`, `Archived` |
| `ShoppingListItem` | `Added`, `Updated`, `Purchased`, `Substituted`, `Removed` |
| `Favorite` | `Added`, `Removed` |
| `Review` | `Submitted`, `Approved`, `Rejected`, `Removed`, `Disputed` |
| `Rating` | `Recorded`, `Updated`, `Removed` |
| `CustomerNotificationPreference` | `Updated` |
| `Privacy` | `ExportRequested`, `ExportReady`, `DeleteRequested`, `DeleteCompleted`, `DataPorted` |

All events carry `tier: "domain"`, `version: 1`, ambient `correlationId`/`causationId`/`traceId`/`actorUserId`/`organizationId` from `requestContext()`. They flow through the M1 transactional outbox (`EventOutbox` table) and the M1 `@eks/workers` consumer for downstream projection.

---

## 8. Audit Actions — `CUSTOMER_*`

The M8 `audit-actions.ts` mirrors the M7 `FIMS_AUDIT_ACTIONS` pattern: uppercase-SNAKE_CASE codes, `as const` registry, derived `CustomerAuditAction` union type. Every privileged read or write on customer data writes an `AuditLog` row (M1 model) with one of these codes. Audit entries are retained per the M8 retention schedule (see `PRIVACY_PERMISSIONS_GUIDE.md` §7) — 7 years for review moderation actions, 6 years for child-safety actions, 2 years for routine preference updates.

Sample actions (full list in `audit-actions.ts`): `CUSTOMER_PROFILE_CREATED`, `CUSTOMER_PROFILE_READ`, `CUSTOMER_PROFILE_UPDATED`, `CUSTOMER_PROFILE_DELETED`, `CUSTOMER_HOUSEHOLD_CREATED`, `CUSTOMER_HOUSEHOLD_MEMBER_INVITED`, `CUSTOMER_HOUSEHOLD_MEMBER_ROLE_CHANGED`, `CUSTOMER_HOUSEHOLD_MEMBER_REMOVED`, `CUSTOMER_PREFERENCE_RECORDED`, `CUSTOMER_PREFERENCE_OVERRIDDEN`, `CUSTOMER_ALLERGY_RECORDED`, `CUSTOMER_ALLERGY_REMOVED`, `CUSTOMER_MEAL_PLAN_CREATED`, `CUSTOMER_MEAL_PLAN_COMMITTED`, `CUSTOMER_PANTRY_ITEM_ADDED`, `CUSTOMER_PANTRY_ITEM_CONSUMED`, `CUSTOMER_PANTRY_ITEM_EXPIRED`, `CUSTOMER_SHOPPING_LIST_ITEM_PURCHASED`, `CUSTOMER_REVIEW_SUBMITTED`, `CUSTOMER_REVIEW_MODERATED`, `CUSTOMER_REVIEW_REMOVED`, `CUSTOMER_RATING_RECORDED`, `CUSTOMER_ADDRESS_VERIFIED`, `CUSTOMER_NOTIFICATION_PREFERENCE_UPDATED`, `CUSTOMER_PRIVACY_EXPORT_REQUESTED`, `CUSTOMER_PRIVACY_EXPORT_READY`, `CUSTOMER_PRIVACY_DELETE_REQUESTED`, `CUSTOMER_PRIVACY_DELETE_COMPLETED`, `CUSTOMER_CHILD_SAFETY_CHECK_PASSED`, `CUSTOMER_CHILD_SAFETY_CHECK_FAILED`.

---

## 9. Lifecycle & State Machines

### 9.1 CustomerProfile lifecycle

```
                  ┌─────────────────────────────┐
                  │  PENDING (verification)     │
                  └──────────────┬──────────────┘
                                 │ VerificationRequest verified (M2)
                                 ▼
                  ┌─────────────────────────────┐
        ┌────────▶│  ACTIVE                     │────────┐
        │         └──────────────┬──────────────┘        │
        │                        │ suspend                │ reactivate
        │                        ▼                        │
        │         ┌─────────────────────────────┐         │
        └─────────│  SUSPENDED                  │─────────┘
                  └──────────────┬──────────────┘
                                 │ mark inactive (long inactivity)
                                 ▼
                  ┌─────────────────────────────┐
                  │  INACTIVE                   │
                  └──────────────┬──────────────┘
                                 │ GDPR erasure OR deceased
                                 ▼
                  ┌─────────────────────────────┐
                  │  DELETED (soft, GDPR hold)  │
                  └─────────────────────────────┘
```

Transitions emit the corresponding `CustomerProfile.*` event and audit action. The `DELETED` state holds the row for the GDPR retention window (30 days for routine deletion, 6 years for child accounts — see `PRIVACY_PERMISSIONS_GUIDE.md` §7) before a hard purge job removes it.

### 9.2 HouseholdMember lifecycle

```
INVITED ──accept──▶ ACTIVE ──role change──▶ ACTIVE (new role)
                       │
                       ├──depart──▶ DEPARTED (no future permissions, history retained)
                       └──remove──▶ REMOVED (involuntary, audit-flagged)
```

A `HouseholdMember` row is never deleted — `departedAt` and `removalReason` are set, preserving audit history. A member may rejoin (new `HouseholdMember` row with `rejoinedFromId` pointing to the prior row).

### 9.3 MealPlan lifecycle

```
DRAFT ──commit──▶ COMMITTED ──activate (at startDate)──▶ ACTIVE ──complete (at endDate)──▶ COMPLETED ──archive──▶ ARCHIVED
  ▲                   │
  │                   └──cancel──▶ CANCELLED (archived automatically after 30 days)
  └──revert (from COMMITTED only, within 24h)──┘
```

---

## 10. Future Consumption Contract (M9+)

M8 produces data; M9+ consumes it. The contract:

- **Recommendation engine (M9)** reads `CustomerPreference` rows where `provenance` is explicit (weight 1.0) or implicit with `confidence >= 0.5` (weight 0.5–1.0 by recency decay). It reads `MealHistory` for collaborative filtering and `HouseholdRelationship` for household-level recommendations. It writes back derived preferences with `provenance=IMPLICIT_RECOMMENDER` (which never override explicit customer preferences — see `PREFERENCE_INTELLIGENCE_GUIDE.md` §6).
- **Automated procurement (M10)** reads `ShoppingList` rows in `COMPLETED` state plus `PantryItem.consumptionHistory` to learn recurring needs. It writes suggested `ShoppingList` rows with `source=RECURRING` for customer approval. No automated ordering without explicit customer opt-in per `CustomerNotificationPreference.marketingOptIn`.
- **Health analytics (M10+)** reads `NutritionGoal` and `MealHistory` (with customer's `analyticsOptIn` flag) to compute adherence. Aggregate-level analytics are k-anonymous (k≥50) per the M2 `MULTI_TENANCY.md` data residency rules.

---

## 11. Cross-References

- M1 `docs/ARCHITECTURE.md` — overall platform topology, transactional outbox, worker framework.
- M1 `docs/OPERATIONS_RUNBOOK.md` — base operational playbook.
- M1 `docs/EVENT_CONVENTIONS.md` — `{Aggregate}.{PastTenseVerb}` event naming, outbox schema.
- M1 `docs/API_CONVENTIONS.md` — RFC 7807 error format, header conventions, idempotency.
- M2 `docs/identity/MULTI_TENANCY.md` — `organizationId` invariant, tenant isolation.
- M2 `docs/identity/AUTHORIZATION_POLICIES.md` — RBAC+ABAC layers that M8 household permissions extend.
- M2 `docs/identity/AUDIT_AND_COMPLIANCE.md` — audit log conventions M8 builds on.
- M3 `docs/developer/EXTENSION_AUTHORING.md` — metadata schema registry for tenant-validated JSONB columns.
- M4 `docs/integration/TRANSFORMATION_GUIDE.md` — field mapping for household-data imports.
- M5 `docs/connectors/MAPS_GUIDE.md`, `CALENDAR_GUIDE.md`, `NOTIFICATIONS_GUIDE.md` — connector contracts M8 calls.
- M6 `docs/food-domain/DOMAIN_MODEL_REFERENCE.md` — canonical `Household`, `CustomerProfile` definitions M8 extends.
- M6 `docs/food-domain/GRAPH_ARCHITECTURE.md` — `GraphNode`/`GraphEdge` shape used for preference graph projection.
- M7 `docs/fims/CATALOG_ARCHITECTURE.md` — `FoodCatalog` rows referenced by `IngredientPreference` and `PantryItem`.
- M7 `docs/fims/RECIPE_ENGINE_GUIDE.md` — `RecipeVersion` referenced by `MealCalendar`.
- M7 `docs/fims/INVENTORY_GUIDE.md` — `InventoryLocation`/`InventoryStock` referenced by `Pantry`.
- M7 `docs/fims/NUTRITION_ENGINE_GUIDE.md` — `DietaryProfile`, `Allergen`, `NutritionProfile` referenced by preference models.

---

## 12. Open Questions (Tracked in ADR Log)

- **ADR-0081**: Should `HouseholdRelationship` use a closed enumeration of relationship types or an open registry per tenant? Current leaning: closed enumeration with tenant-specific `metadata` for nuanced family structures (e.g. "step-parent", "foster guardian").
- **ADR-0082**: Pantry stock — should `PantryItem` rows be the system of record (simpler, customer-controlled) or should they always project from M7 `InventoryStock` at a `HOUSEHOLD`-type location (single source of truth but requires cook-side inventory platform to manage customer pantries)? Current leaning: `PantryItem` is system of record for customer-managed items; `InventoryLocation` linkage is optional and used when a household is also a cook-side kitchen.
- **ADR-0083**: Child-safety age threshold — 13 (COPPA) or 16 (GDPR-K)? Current leaning: configurable per tenant at `TenantConfiguration.childAgeOfConsent` with defaults 13 in US tenants, 16 in EU tenants, 18 in markets without explicit legislation.
- **ADR-0084**: Review moderation — automatic (sentiment analysis) or fully human? Current leaning: automatic pre-screen flags `status=FLAGGED` for human moderation queue; never auto-approves.

These ADRs are tracked in `docs/adr/` (M1) and resolved before the M8 implementation merges.
