/**
 * @file customer/events.ts
 * @package @eks/customer
 *
 * Customer Platform domain events registry.
 *
 * Responsibility:
 *  - Define the canonical set of customer-domain events as a single
 *    constant (`CUSTOMER_EVENTS`) so producers and consumers reference
 *    the same literal strings for `eventType`. Each entry maps a
 *    PascalCase key (used in code) to the wire-format
 *    `{Aggregate}.{PastTenseVerb}` string that goes onto every
 *    DomainEvent envelope (see docs/EVENT_CONVENTIONS.md).
 *  - Expose `CustomerEvent` — a string-literal union derived from the
 *    registry keys — so call sites are exhaustively checked by the
 *    compiler when switching over customer events.
 *  - Provide `buildCustomerEvent`, the single factory that produces
 *    envelope-compliant {@link DomainEvent} instances for any customer
 *    event, with correlation/causation/trace ids pulled from the
 *    ambient request context (set via `withRequestContext`).
 *
 * Coverage:
 *  - Household lifecycle (create, update, member add/remove, relationship, invitation)
 *  - Address lifecycle (add, validate)
 *  - Preferences (general, cuisine, ingredient)
 *  - Dietary intelligence (profile, allergy, nutrition goal)
 *  - Meal history & meal planning
 *  - Shopping list lifecycle (create, item add, complete)
 *  - Pantry lifecycle (update, item add, item expire)
 *  - Favorites (add, remove)
 *  - Reviews & ratings (submit, moderate)
 *  - Notification preferences
 *
 * Constraints:
 *  - Pure TypeScript, no `any`, no I/O.
 *  - The returned object strictly satisfies the `DomainEvent` contract
 *    from `@eks/events` (`tier: "domain"`, `version: 1`).
 *  - Follows the EXACT same convention as `@eks/identity/events.ts`,
 *    `@eks/developer/events.ts`, `@eks/integration/events.ts`,
 *    `@eks/connectors/events.ts`, `@eks/food-domain/events.ts`,
 *    `@eks/fims/events.ts`.
 */

import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, asISODate, uuid, type UUID, type ISODateString } from "@eks/common";
import { requestContext } from "@eks/observability";

/**
 * Canonical customer domain events.
 *
 * The single source of truth for customer event type strings. Every
 * consumer of customer events (audit log, outbox, projections,
 * recommendation engine, meal-planning, notifications, analytics)
 * MUST reference these constants rather than spelling out the literal
 * string — that way the compiler catches typos and renaming is a
 * single edit.
 *
 * Naming follows the `{Aggregate}.{PastTenseVerb}` convention
 * documented in docs/EVENT_CONVENTIONS.md §3 (e.g. `Household.Created`,
 * `HouseholdMember.Added`, `Meal.Planned`).
 */
export const CUSTOMER_EVENTS = {
  // Household lifecycle
  HouseholdCreated: "Household.Created",
  HouseholdUpdated: "Household.Updated",
  HouseholdMemberAdded: "HouseholdMember.Added",
  HouseholdMemberRemoved: "HouseholdMember.Removed",
  HouseholdRelationshipCreated: "HouseholdRelationship.Created",

  // Address lifecycle
  AddressAdded: "Address.Added",
  AddressValidated: "Address.Validated",

  // Preferences
  PreferenceUpdated: "Preference.Updated",
  CuisinePreferenceSet: "CuisinePreference.Set",
  IngredientPreferenceSet: "IngredientPreference.Set",

  // Dietary intelligence
  DietaryProfileAssigned: "DietaryProfile.Assigned",
  AllergyRecorded: "Allergy.Recorded",
  NutritionGoalSet: "NutritionGoal.Set",

  // Meal history & planning
  MealHistoryRecorded: "MealHistory.Recorded",
  MealPlanCreated: "MealPlan.Created",
  MealPlanned: "Meal.Planned",

  // Shopping list lifecycle
  ShoppingListCreated: "ShoppingList.Created",
  ShoppingListItemAdded: "ShoppingListItem.Added",
  ShoppingListCompleted: "ShoppingList.Completed",

  // Pantry lifecycle
  PantryUpdated: "Pantry.Updated",
  PantryItemAdded: "PantryItem.Added",
  PantryItemExpired: "PantryItem.Expired",

  // Favorites
  FavoriteAdded: "Favorite.Added",
  FavoriteRemoved: "Favorite.Removed",

  // Reviews & ratings
  ReviewSubmitted: "Review.Submitted",
  ReviewModerated: "Review.Moderated",
  RatingSubmitted: "Rating.Submitted",

  // Notification preferences
  NotificationPreferenceUpdated: "NotificationPreference.Updated",

  // Household invitations
  HouseholdInvitationSent: "HouseholdInvitation.Sent",
  HouseholdInvitationAccepted: "HouseholdInvitation.Accepted",
} as const;

/**
 * Union of every canonical customer event name. Use this as the type of
 * the `name` argument to {@link buildCustomerEvent} so the compiler
 * rejects unknown events at the call site.
 */
export type CustomerEvent = keyof typeof CUSTOMER_EVENTS;

/** Optional overrides accepted by {@link buildCustomerEvent}. */
export interface CustomerEventMeta {
  readonly eventId?: UUID;
  readonly occurredAt?: ISODateString;
  readonly correlationId?: UUID;
  readonly causationId?: UUID | null;
  readonly traceId?: UUID;
  readonly actorUserId?: UUID | null;
  readonly organizationId?: UUID | null;
}

/**
 * Build an envelope-compliant {@link DomainEvent} for a customer
 * aggregate.
 *
 * Behaviour:
 *  - `eventType` is the canonical `{Aggregate}.{Verb}` string from
 *    {@link CUSTOMER_EVENTS}.
 *  - `aggregateType` is parsed from the canonical string (everything
 *    before the first `.`), so `Household.Created` → `Household`,
 *    `HouseholdMember.Added` → `HouseholdMember`,
 *    `CuisinePreference.Set` → `CuisinePreference`, etc.
 *  - `tier` is fixed at `"domain"` (customer events are raised inside
 *    an aggregate and persisted to the outbox).
 *  - `version` is fixed at {@link EVENT_VERSION} (= 1).
 *  - `eventId`, `occurredAt` default to a fresh uuid / now unless
 *    overridden via `meta`.
 *  - `correlationId`, `causationId`, `traceId`, `actorUserId`,
 *    `organizationId` are pulled from the ambient request context
 *    (set via `withRequestContext`) when present, falling back to
 *    fresh uuids / `null` otherwise. Explicit `meta` overrides
 *    always win.
 *
 * @example
 *   const evt = buildCustomerEvent(
 *     "HouseholdCreated",
 *     householdId,
 *     { name: "Mensah Family", createdBy: userId },
 *   );
 *   await eventBus().publish(evt);
 */
export function buildCustomerEvent(
  name: CustomerEvent,
  aggregateId: UUID,
  payload: Readonly<Record<string, unknown>>,
  meta?: CustomerEventMeta,
): DomainEvent {
  const eventType = CUSTOMER_EVENTS[name];
  const aggregateType = eventType.split(".", 2)[0] ?? "Customer";
  const ctx = requestContext();

  const correlationId: UUID =
    meta?.correlationId ?? (ctx ? asUUID(ctx.correlationId) : uuid());
  const causationId: UUID | null =
    meta?.causationId ?? (ctx?.causationId ? asUUID(ctx.causationId) : null);
  const traceId: UUID | undefined =
    meta?.traceId ?? (ctx ? asUUID(ctx.traceId) : undefined);
  const actorUserId: UUID | null =
    meta?.actorUserId ?? (ctx?.actorUserId ? asUUID(ctx.actorUserId) : null);
  const organizationId: UUID | null =
    meta?.organizationId ?? (ctx?.organizationId ? asUUID(ctx.organizationId) : null);

  return {
    tier: "domain",
    eventId: meta?.eventId ?? uuid(),
    occurredAt: meta?.occurredAt ?? asISODate(new Date()),
    correlationId,
    causationId,
    version: EVENT_VERSION,
    traceId,
    actorUserId,
    organizationId,
    aggregateType,
    aggregateId,
    eventType,
    payload,
  };
}
