# Eks-Food Customer Platform — Meal Planning Guide

> **Audience:** Platform engineers, full-stack engineers, product managers, calendar integration engineers. Read alongside `PLATFORM_ARCHITECTURE.md`, `HOUSEHOLD_MODEL_GUIDE.md`, `PREFERENCE_INTELLIGENCE_GUIDE.md`, `SHOPPING_LIST_GUIDE.md`, and the M5 `docs/connectors/CALENDAR_GUIDE.md`.
>
> **Status:** Milestone 8 (Customer Platform). This document specifies the target meal planning model: `MealPlan` and `MealCalendar` Prisma models. M8 builds the **foundation** — storing plans, scheduling meals, syncing to calendars. M9+ adds optimization (preference-aware suggestions, waste-aware planning, budget optimization).

---

## 1. Goals & Non-Goals

### 1.1 Goals

- **Two Prisma models** — `MealPlan` (the plan aggregate) and `MealCalendar` (the per-day, per-meal entries within a plan).
- **Five plan types** — `WEEKLY`, `MONTHLY`, `FAMILY`, `SPECIAL_OCCASION`, `HOLIDAY` — each with distinct default duration, household-vs-member scope, and calendar sync behavior.
- **Six meal types** — `BREAKFAST`, `LUNCH`, `DINNER`, `SNACK`, `BRUNCH`, `TEA` — covering Ghanaian, Nigerian, and global eating patterns.
- **Calendar integration** via the M5 `CalendarConnector` — bidirectional sync between `MealCalendar` rows and the customer's connected Google/Outlook/Apple calendar.
- **Recipe linkage** via M7 `RecipeVersion` — every meal entry optionally references a published recipe with servings and scaling info.
- **State machine** — `DRAFT` → `COMMITTED` → `ACTIVE` → `COMPLETED` → `ARCHIVED` (with `CANCELLED` and revert paths).
- **Household vs. member scope** — a plan may target the entire household (most common), a subset of members (e.g. "children's lunches"), or a single member (e.g. a dependent's specialized diet).
- **Special occasions and holidays** — configurable holiday calendar per tenant/region (Ghana public holidays, Islamic holidays for Halal-observing households, Christian holidays, etc.).

### 1.2 Non-Goals

- **Optimization** — M8 does not generate plans, suggest recipes, or balance nutrition automatically. M9+ adds the `MealPlanOptimizer` that consumes resolved preferences (`PREFERENCE_INTELLIGENCE_GUIDE.md` §7) and produces draft plans for customer review.
- **Automated grocery list generation** — `POST /api/v1/customer/shopping-lists/:id/generate-from-plan` exists but produces a flat list of ingredients scaled by servings; it does not dedupe against pantry stock, suggest substitutions, or optimize for budget (M9+).
- **Cook assignment** — M8 plans reference recipes only. Assigning a cook (from M6 `CookProfile`) is part of the M1 `Booking` flow, not meal planning.
- **Nutrition adherence tracking** — M8 stores `NutritionGoal` per profile (see `PREFERENCE_INTELLIGENCE_GUIDE.md` §2.6) but does not compute whether a plan meets the goal. Adherence tracking is M10+.

---

## 2. Plan Types

| `planType` | Default duration | Default scope | Default sync to calendar? | Typical use |
|---|:---:|:---:|:---:|---|
| `WEEKLY` | 7 days | household | yes (recurring weekly events) | Weekly meal prep, Monday breakfast through Sunday dinner |
| `MONTHLY` | 28-31 days | household | yes (per-day events) | Monthly planning with budget tracking |
| `FAMILY` | 7 days | household (all members, including dependents) | yes | Family-specific plan accounting for children's tastes |
| `SPECIAL_OCCASION` | 1 day | household (variable) | yes (single all-day event) | Birthday, anniversary, dinner party |
| `HOLIDAY` | 1-3 days | household | yes (per-day events) | Christmas, Eid, Easter, Independence Day |

`planType` drives:
- Default `startDate`/`endDate` computation when not specified in the request.
- Default `mealCalendar` template (e.g. `WEEKLY` pre-populates 7 days × 3 meals = 21 entries; `SPECIAL_OCCASION` pre-populates a single day with customizable meals).
- Calendar sync granularity (`WEEKLY` creates one recurring event per meal slot; `MONTHLY` creates one event per day).
- UI affordance (weekly grid view, monthly calendar view, special occasion form).

---

## 3. Data Model

### 3.1 `MealPlan`

```
model MealPlan {
  id              String   @id @default(cuid())
  organizationId  String
  householdId     String                     // FK → Household (always household-scoped, even for member-only plans)
  planType        String                     // WEEKLY|MONTHLY|FAMILY|SPECIAL_OCCASION|HOLIDAY
  title           String                     // e.g. "Week of Jan 15 — Ghanaian focus"
  description     String?
  // Time bound
  startDate       DateTime
  endDate         DateTime
  timezone        String   @default("Africa/Accra")
  // Scope (which members the plan covers)
  scopeType       String   @default("HOUSEHOLD") // HOUSEHOLD|SUBSET|SINGLE_MEMBER
  householdMemberIds String @default("[]")    // JSON array; for SUBSET/SINGLE_MEMBER scope
  // Recipe linkage summary
  recipeCount     Int      @default(0)        // denormalized count of distinct RecipeVersion ids
  totalServings   Int      @default(0)        // sum of MealCalendar.servings
  // Calendar sync
  calendarConnectionId String?                // FK → CalendarConnection (M5)
  calendarEventIds String @default("[]")      // JSON array of external calendar event IDs
  lastSyncedAt    DateTime?
  syncStatus      String   @default("PENDING") // PENDING|SYNCED|FAILED|DISABLED
  // Special occasion / holiday
  occasionType    String?                    // BIRTHDAY|ANNIVERSARY|DINNER_PARTY|EID|CHRISTMAS|EASTER|INDEPENDENCE_DAY|...
  occasionMetadata String @default("{}")     // { celebrantName?, guestCount?, theme? }
  // Lifecycle
  status          String   @default("DRAFT")  // DRAFT|COMMITTED|ACTIVE|COMPLETED|ARCHIVED|CANCELLED
  committedAt     DateTime?
  activatedAt     DateTime?
  completedAt     DateTime?
  archivedAt      DateTime?
  cancelledAt     DateTime?
  // Weather snapshot at plan creation (for future M9+ heuristics)
  weatherSnapshot String   @default("{}")     // { tempC, condition, source: "openweather", capturedAt }
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  household       Household      @relation(fields: [householdId], references: [id])
  calendarConnection CalendarConnection? @relation(fields: [calendarConnectionId], references: [id])
  calendar        MealCalendar[]

  @@index([organizationId])
  @@index([householdId, status])
  @@index([startDate, endDate])
  @@index([planType, status])
}
```

### 3.2 `MealCalendar`

```
model MealCalendar {
  id              String   @id @default(cuid())
  organizationId  String
  mealPlanId      String                     // FK → MealPlan
  // Scheduling
  scheduledDate   DateTime                   // the calendar day (midnight in plan.timezone)
  mealType        String                     // BREAKFAST|LUNCH|DINNER|SNACK|BRUNCH|TEA
  scheduledTime   String?                    // "07:30" (24h, in plan.timezone); NULL = "any time today"
  // Recipe
  recipeId        String?                    // FK → RecipeVersion (M7); NULL for free-text meals
  recipeServings  Int      @default(4)       // base servings from the recipe
  scaledServings  Int      @default(4)       // scaled to the household/member count
  scalingFactor   Float    @default(1.0)     // scaledServings / recipeServings
  // Free-text meal (no recipe)
  freeTextTitle   String?                    // e.g. "Leftover jollof from yesterday"
  freeTextNotes   String?
  // Who's eating
  householdMemberIds String @default("[]")   // JSON array of HouseholdMember.id (subset of plan scope)
  // Calendar sync
  calendarEventId String?                    // external calendar event ID for this entry
  // Status
  status          String   @default("PLANNED") // PLANNED|SHOPPED|COOKING|SERVED|SKIPPED|CANCELLED
  servedAt        DateTime?                  // when the meal was actually served
  skippedReason   String?                    // ATE_OUT|NO_TIME|NO_INGREDIENTS|OTHER
  // Feedback (drives implicit preferences)
  rating          Int?                       // 1-5 (post-meal rating; feeds IMPLICIT_REVIEW preferences)
  feedbackNotes   String?
  // Standard audit block
  version         Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  createdBy       String?
  updatedBy       String?
  metadata        String   @default("{}")

  mealPlan        MealPlan        @relation(fields: [mealPlanId], references: [id])
  recipe          RecipeVersion?  @relation(fields: [recipeId], references: [id])

  @@unique([mealPlanId, scheduledDate, mealType])
  @@index([organizationId])
  @@index([mealPlanId, scheduledDate])
  @@index([scheduledDate, status])
  @@index([recipeId])
}
```

---

## 4. Household vs. Member Plans

### 4.1 Scope types

| `scopeType` | `householdMemberIds` | Use case |
|---|---|---|
| `HOUSEHOLD` | all `ACTIVE` members (computed at COMMIT time) | Default — the plan covers everyone in the household |
| `SUBSET` | explicit list (e.g. parents only, or children only) | Dietary restrictions, work-from-home lunches |
| `SINGLE_MEMBER` | one member | Dependent's specialized diet, guest's visit |

### 4.2 Member-only meal entries

Even in a `HOUSEHOLD`-scoped plan, individual `MealCalendar` entries may target a subset via `householdMemberIds`. Example: the household dinner on Tuesday is jollof rice for everyone, but the dependent's portion is a smaller, milder serving. The `MealCalendar.scaledServings` for the household entry = total diners; a separate `MealCalendar` entry with `mealType=DINNER`, `scheduledDate=Tuesday`, `householdMemberIds=[child]` would conflict (the `@@unique` constraint prevents this).

Instead, the M8 UI uses a single `MealCalendar` entry per `(mealPlanId, scheduledDate, mealType)` and stores per-member adjustments in `metadata.memberAdjustments`:

```json
{
  "memberAdjustments": {
    "hm-ama": { "scaledServings": 1, "spiceLevel": 2, "notes": "Mild version, no scotch bonnet" }
  }
}
```

This keeps the calendar clean while preserving per-member customization. The M9+ meal optimizer will read these adjustments when generating future plans.

---

## 5. State Machine

```
                                    ┌──────────────────────┐
                  create            │  DRAFT               │
              ──────────────────▶   │  (editable, no sync) │
                                    └──────────┬───────────┘
                                               │ commit (caller: ADMIN/GUARDIAN)
                                               ▼
                                    ┌──────────────────────┐
                                    │  COMMITTED           │
                                    │  (locked, sync starts)│
                                    └──────────┬───────────┘
                                               │ startDate reached (cron) OR manual activate
                                               ▼
                                    ┌──────────────────────┐
                                    │  ACTIVE              │
                                    │  (sync ongoing)      │
                                    └──────────┬───────────┘
                                               │ endDate reached (cron) OR manual complete
                                               ▼
                                    ┌──────────────────────┐
                                    │  COMPLETED           │
                                    │  (entries can be rated)│
                                    └──────────┬───────────┘
                                               │ archive (auto after 30 days OR manual)
                                               ▼
                                    ┌──────────────────────┐
                                    │  ARCHIVED            │
                                    │  (read-only, retained)│
                                    └──────────────────────┘

  Revert path: COMMITTED → DRAFT (within 24h of commit, ADMIN only)
  Cancel path: DRAFT/COMMITTED/ACTIVE → CANCELLED → ARCHIVED (auto after 30 days)
```

### 5.1 Transitions

| From | To | Trigger | Permission | Audit action |
|---|---|---|---|---|
| (new) | `DRAFT` | `POST /api/v1/customer/meal-plans` | `household.meal_plan.write` | `CUSTOMER_MEAL_PLAN_CREATED` |
| `DRAFT` | `COMMITTED` | `POST /api/v1/customer/meal-plans/:id/commit` | `household.meal_plan.write` | `CUSTOMER_MEAL_PLAN_COMMITTED` |
| `COMMITTED` | `DRAFT` | `POST /api/v1/customer/meal-plans/:id/revert` (within 24h) | `household.meal_plan.write` | `CUSTOMER_MEAL_PLAN_REVERTED` |
| `COMMITTED` | `ACTIVE` | Cron job at `startDate` OR `POST /api/v1/customer/meal-plans/:id/activate` | (system or `household.meal_plan.write`) | `CUSTOMER_MEAL_PLAN_ACTIVATED` |
| `ACTIVE` | `COMPLETED` | Cron job at `endDate + 24h` OR `POST /api/v1/customer/meal-plans/:id/complete` | (system or `household.meal_plan.write`) | `CUSTOMER_MEAL_PLAN_COMPLETED` |
| `COMPLETED` | `ARCHIVED` | Cron job 30 days after `completedAt` OR `POST /api/v1/customer/meal-plans/:id/archive` | `household.meal_plan.write` | `CUSTOMER_MEAL_PLAN_ARCHIVED` |
| any | `CANCELLED` | `POST /api/v1/customer/meal-plans/:id/cancel` (with reason) | `household.meal_plan.write` | `CUSTOMER_MEAL_PLAN_CANCELLED` |
| `CANCELLED` | `ARCHIVED` | Cron job 30 days after `cancelledAt` | (system) | `CUSTOMER_MEAL_PLAN_ARCHIVED` |

Every transition emits the corresponding `MealPlan.*` event and writes the audit action. The M5 `CalendarConnector` is notified via the event bus to sync (or remove) the external calendar events.

---

## 6. Calendar Integration

### 6.1 Bidirectional sync

The M5 `CalendarConnector` provides bidirectional sync between `MealCalendar` rows and the customer's connected calendar (Google Calendar, Outlook, Apple Calendar via M5 `CalendarConnection`).

**Outbound (MealCalendar → external calendar):**
- On `MealPlan.COMMITTED`, the `MealPlanCalendarSyncJob` (M1 cron, runs every 5 min) creates one external event per `MealCalendar` entry.
- Events use the meal title (recipe name or `freeTextTitle`), the `scheduledTime` (or all-day if NULL), and a description linking back to the Eks-Food app.
- The external event ID is stored in `MealCalendar.calendarEventId` and `MealPlan.calendarEventIds` for later updates.
- Updates to `MealCalendar` rows (reschedule, recipe change, cancellation) propagate to the external calendar via the sync job.

**Inbound (external calendar → MealCalendar):**
- The M5 `CalendarConnector` webhook receives notifications when the customer edits or deletes the external event.
- The webhook payload is processed by `MealPlanCalendarSyncJob`, which updates or cancels the corresponding `MealCalendar` row.
- Inbound edits require `household.meal_plan.write` permission (the connector authenticates as the household member who owns the `CalendarConnection`).
- If the inbound edit would violate a constraint (e.g. moving a meal to a date outside the plan's `startDate`/`endDate`), the sync job writes a `MealCalendar.SyncFailed` event and a `CUSTOMER_CALENDAR_SYNC_FAILED` audit action; the external event is left in its new state and the customer is notified via the M5 `NotificationConnector`.

### 6.2 Recurring events for WEEKLY plans

For `WEEKLY` plan types, the sync job creates a single recurring event per meal slot (e.g. "Breakfast — every Monday at 07:30 for 7 weeks"). This reduces calendar clutter versus 21 separate events. The recurrence pattern is stored in `MealPlan.metadata.recurrencePattern` and used to update or cancel all occurrences atomically.

### 6.3 Manual sync trigger

The `POST /api/v1/customer/meal-plans/:id/sync-calendar` endpoint forces an immediate sync (bypassing the 5-minute cron). This is called by the UI after a customer makes multiple edits in quick succession. The endpoint is idempotent — multiple calls within a 60-second window coalesce into a single sync operation.

### 6.4 Calendar not connected

If `MealPlan.calendarConnectionId` is NULL (customer has no connected calendar), `syncStatus=DISABLED`. The plan still works — `MealCalendar` rows are stored and visible in the Eks-Food app's meal calendar view. The customer can connect a calendar later (via the M5 OAuth flow) and trigger a one-time backfill sync.

---

## 7. Special Occasions & Holidays

### 7.1 Holiday calendar

Each tenant organization configures a holiday calendar via `Organization.metadata.holidayCalendar`. The calendar is a JSON array of holiday entries:

```json
[
  { "code": "GH_INDEPENDENCE", "name": "Independence Day", "date": "2025-03-06", "regions": ["GH"] },
  { "code": "EID_FITR", "name": "Eid al-Fitr", "date": "2025-04-10", "regions": ["GH", "NG"] },
  { "code": "CHRISTMAS", "name": "Christmas Day", "date": "2025-12-25", "regions": ["*"] }
]
```

The M8 UI surfaces upcoming holidays on the meal planning screen, with one-click "Create holiday plan" that pre-fills `planType=HOLIDAY`, `occasionType=<holiday code>`, and a default 1-day duration with a special-occasion dinner.

### 7.2 Special occasions

Non-holiday special occasions (birthdays, anniversaries, dinner parties) are created with `planType=SPECIAL_OCCASION` and an `occasionType` from a tenant-configurable registry. The `occasionMetadata` field stores:

```json
{
  "celebrantName": "Ama",
  "celebrantMemberId": "hm-ama",
  "guestCount": 12,
  "theme": "Garden party",
  "dietaryRestrictions": ["vegan", "gluten-free"]
}
```

Special-occasion plans are excluded from the `recipeCount`/`totalServings` totals on the household dashboard (they're outliers, not routine). They're also flagged in the M9+ recommendation engine's training data to avoid skewing routine-meal suggestions.

### 7.3 Holiday plan templates

Holiday plans may reference tenant-configured templates (`TenantConfiguration.holidayPlanTemplates`) that pre-populate `MealCalendar` entries with traditional recipes for the occasion. Example: a Christmas template pre-fills breakfast (chocolate porridge), lunch (jollof + fried chicken), dinner (pot roast + sides), and snacks (cake, pastries). The customer can edit, add, or remove entries before committing.

---

## 8. Meal Calendar Entry Lifecycle

Each `MealCalendar` entry has its own state machine, independent of the parent `MealPlan`:

```
PLANNED ──shopping list completed──▶ SHOPPED
   │                                    │
   │                                    ├──cooking started──▶ COOKING
   │                                    │                        │
   │                                    │                        ├──served──▶ SERVED
   │                                    │                        └──cancelled──▶ CANCELLED
   │                                    │
   │                                    └──skipped (no time, no ingredients)──▶ SKIPPED
   │
   └──skipped (ate out, changed mind)──▶ SKIPPED
```

- `PLANNED`: The meal is in the plan but no action taken yet.
- `SHOPPED`: All ingredients are in the household pantry or marked purchased on the shopping list (denormalized flag computed by `MealPlanService.checkShoppingStatus(mealCalendarId)`).
- `COOKING`: The cook (household member or booked cook) has started preparing the meal. Triggers a notification to other household members ("Dinner will be ready in 30 min").
- `SERVED`: The meal was served. The `servedAt` timestamp is recorded. Household members can now submit ratings.
- `SKIPPED`: The meal was not served. The `skippedReason` is recorded. Skipped meals feed implicit preferences (the M9+ engine may infer dislike of the planned recipe if the same recipe is repeatedly skipped).
- `CANCELLED`: The meal was cancelled (e.g. recipe double-booked, ingredient recall). Distinct from `SKIPPED` — cancellation is an explicit decision before shopping/cooking; skipping happens after.

---

## 9. Recipe Linkage & Scaling

When a `MealCalendar` entry references an M7 `RecipeVersion`:

1. The base `recipeServings` is read from `RecipeVersion.servingSize`.
2. The `scaledServings` is computed from the `householdMemberIds` count (or the plan's total active member count if `householdMemberIds` is empty).
3. The `scalingFactor = scaledServings / recipeServings` is stored on the `MealCalendar` row.
4. The M7 `RecipeScaler.scaleToServings(recipe, scaledServings)` is invoked when generating the shopping list (`POST /api/v1/customer/shopping-lists/:id/generate-from-plan`) to compute per-ingredient quantities.
5. If the recipe contains an active allergen for any planned eater, the `MealCalendar.metadata.allergenWarning` is set and a `CUSTOMER_MEAL_PLAN_ALLERGEN_WARNING` audit action is written (the meal is not blocked — the customer may have planned a substitution).

---

## 10. API Examples

### 10.1 Create a weekly plan

```http
POST /api/v1/customer/meal-plans
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01
Idempotency-Key: mp-week-jan15-001

{
  "householdId": "hh-mensah-01",
  "planType": "WEEKLY",
  "title": "Week of Jan 15 — Ghanaian focus",
  "startDate": "2025-01-15",
  "endDate": "2025-01-21",
  "scopeType": "HOUSEHOLD",
  "calendarConnectionId": "cc-kwame-google-01"
}
```

Response `201 Created`:
```json
{
  "id": "mp-week-jan15-001",
  "status": "DRAFT",
  "planType": "WEEKLY",
  "startDate": "2025-01-15T00:00:00Z",
  "endDate": "2025-01-21T23:59:59Z",
  "scopeType": "HOUSEHOLD",
  "householdMemberIds": ["hm-kwame", "hm-ama", "hm-akosua"],
  "calendar": []  // empty until entries are added
}
```

### 10.2 Add a meal calendar entry

```http
POST /api/v1/customer/meal-plans/mp-week-jan15-001/calendar
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01

{
  "scheduledDate": "2025-01-15",
  "mealType": "DINNER",
  "scheduledTime": "19:00",
  "recipeId": "rv-jollof-001",
  "scaledServings": 4
}
```

Response `201 Created`:
```json
{
  "id": "mc-jan15-dinner-001",
  "mealPlanId": "mp-week-jan15-001",
  "scheduledDate": "2025-01-15T00:00:00Z",
  "mealType": "DINNER",
  "scheduledTime": "19:00",
  "recipeId": "rv-jollof-001",
  "recipeServings": 4,
  "scaledServings": 4,
  "scalingFactor": 1.0,
  "status": "PLANNED"
}
```

### 10.3 Commit the plan (triggers calendar sync)

```http
POST /api/v1/customer/meal-plans/mp-week-jan15-001/commit
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01
```

Response `200 OK`:
```json
{
  "id": "mp-week-jan15-001",
  "status": "COMMITTED",
  "committedAt": "2025-01-14T20:30:00Z",
  "calendarSync": {
    "status": "PENDING",
    "scheduledAt": "2025-01-14T20:35:00Z"
  }
}
```

### 10.4 Generate a shopping list from the plan

```http
POST /api/v1/customer/shopping-lists
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
x-eks-household: hh-mensah-01

{
  "householdId": "hh-mensah-01",
  "tripType": "RECIPE_GENERATED",
  "dueAt": "2025-01-15T10:00:00Z",
  "generateFromMealPlanId": "mp-week-jan15-001"
}
```

(Response shape — see `SHOPPING_LIST_GUIDE.md` §6.)

---

## 11. Cross-References

- `PLATFORM_ARCHITECTURE.md` §3.5 — meal planning bounded context overview.
- `HOUSEHOLD_MODEL_GUIDE.md` §4 — member roles that drive plan permission checks.
- `PREFERENCE_INTELLIGENCE_GUIDE.md` §11 — future recommendation engine contract that consumes meal plans.
- `SHOPPING_LIST_GUIDE.md` §6 — recipe-generated shopping list items.
- `PANTRY_MANAGEMENT_GUIDE.md` §5 — pantry consumption derived from served `MealCalendar` entries.
- `PRIVACY_PERMISSIONS_GUIDE.md` §4 — dependent-scoped plans (child-safety gating on meal plan writes).
- M5 `docs/connectors/CALENDAR_GUIDE.md` — `CalendarConnection` model and bidirectional sync contract.
- M5 `docs/connectors/NOTIFICATIONS_GUIDE.md` — notification triggers for meal reminders.
- M7 `docs/fims/RECIPE_ENGINE_GUIDE.md` — `RecipeVersion` referenced by `MealCalendar.recipeId`.
- M7 `docs/fims/RECIPE_ENGINE_GUIDE.md` §4 — `RecipeScaler.scaleToServings` used for serving scaling.
- M7 `docs/fims/NUTRITION_ENGINE_GUIDE.md` — `NutritionCalculator` for future per-meal nutrition computation.
