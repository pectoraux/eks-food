/**
 * @file food-domain/events.ts
 * @package @eks/food-domain
 *
 * Food domain events registry.
 *
 * Responsibility:
 *  - Define the canonical set of food-domain events as a single
 *    constant (`FOOD_DOMAIN_EVENTS`) so producers and consumers reference
 *    the same literal strings for `eventType`. Each entry maps a
 *    PascalCase key (used in code) to the wire-format
 *    `{Aggregate}.{PastTenseVerb}` string that goes onto every
 *    DomainEvent envelope (see docs/EVENT_CONVENTIONS.md).
 *  - Expose `FoodDomainEvent` — a string-literal union derived from the
 *    registry keys — so call sites are exhaustively checked by the
 *    compiler when switching over food-domain events.
 *  - Provide `buildFoodDomainEvent`, the single factory that produces
 *    envelope-compliant {@link DomainEvent} instances for any
 *    food-domain event, with correlation/causation/trace ids pulled
 *    from the ambient request context (set via `withRequestContext`).
 *
 * Constraints:
 *  - Pure TypeScript, no `any`, no I/O.
 *  - The returned object strictly satisfies the `DomainEvent` contract
 *    from `@eks/events` (`tier: "domain"`, `version: 1`).
 *  - Follows the EXACT same convention as `@eks/identity/events.ts`,
 *    `@eks/developer/events.ts`, `@eks/integration/events.ts`,
 *    `@eks/connectors/events.ts`.
 */

import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, asISODate, uuid, type UUID, type ISODateString } from "@eks/common";
import { requestContext } from "@eks/observability";

/**
 * Canonical food-domain events.
 *
 * The single source of truth for food-domain event type strings. Every
 * consumer of food-domain events (audit log, outbox, projections,
 * Food Intelligence Graph, search index, marketplace, restaurant
 * directory, kitchen network) MUST reference these constants rather
 * than spelling out the literal string — that way the compiler catches
 * typos and renaming is a single edit.
 *
 * Naming follows the `{Aggregate}.{PastTenseVerb}` convention
 * documented in docs/EVENT_CONVENTIONS.md §3 (e.g. `Customer.Created`,
 * `Recipe.Published`, `GraphNode.Created`).
 */
export const FOOD_DOMAIN_EVENTS = {
  // Customer & household lifecycle
  CustomerCreated: "Customer.Created",
  CustomerUpdated: "Customer.Updated",
  CustomerDeleted: "Customer.Deleted",
  HouseholdCreated: "Household.Created",
  HouseholdMemberAdded: "HouseholdMember.Added",
  HouseholdMemberRemoved: "HouseholdMember.Removed",

  // Cook lifecycle
  CookProfileCreated: "CookProfile.Created",
  CookCertified: "Cook.Certified",

  // Restaurant & kitchen lifecycle
  RestaurantRegistered: "Restaurant.Registered",
  KitchenCreated: "Kitchen.Created",
  KitchenCertified: "Kitchen.Certified",

  // Ingredient & recipe lifecycle
  IngredientAdded: "Ingredient.Added",
  IngredientUpdated: "Ingredient.Updated",
  RecipeCreated: "Recipe.Created",
  RecipeUpdated: "Recipe.Updated",
  RecipeVersionPublished: "RecipeVersion.Published",

  // Menu lifecycle
  MenuItemAdded: "MenuItem.Added",
  MenuUpdated: "Menu.Updated",

  // Inventory lifecycle
  InventoryAdjusted: "Inventory.Adjusted",
  InventoryBatchReceived: "InventoryBatch.Received",

  // Asset & logistics lifecycle
  EquipmentRegistered: "Equipment.Registered",
  VehicleRegistered: "Vehicle.Registered",

  // Supplier & vendor lifecycle
  SupplierRegistered: "Supplier.Registered",
  VendorRegistered: "Vendor.Registered",

  // Certification & inspection lifecycle
  CertificationIssued: "Certification.Issued",
  CertificationExpired: "Certification.Expired",
  CertificationRevoked: "Certification.Revoked",
  InspectionScheduled: "Inspection.Scheduled",
  InspectionCompleted: "Inspection.Completed",

  // Food safety incident lifecycle
  FoodSafetyIncidentReported: "FoodSafetyIncident.Reported",
  FoodSafetyIncidentResolved: "FoodSafetyIncident.Resolved",

  // Nutrition
  NutritionProfileCreated: "NutritionProfile.Created",

  // Food Intelligence Graph
  RelationshipCreated: "Relationship.Created",
  RelationshipRemoved: "Relationship.Removed",
  GraphNodeCreated: "GraphNode.Created",
  GraphEdgeCreated: "GraphEdge.Created",

  // Entity lifecycle (versioning, import/export, search)
  EntityVersionCreated: "EntityVersion.Created",
  EntityImported: "Entity.Imported",
  EntityExported: "Entity.Exported",
  SearchIndexed: "Search.Indexed",
} as const;

/**
 * Union of every canonical food-domain event name. Use this as the type
 * of `name` arguments to {@link buildFoodDomainEvent} so the compiler
 * rejects unknown events at the call site.
 */
export type FoodDomainEvent = keyof typeof FOOD_DOMAIN_EVENTS;

/** Optional overrides accepted by {@link buildFoodDomainEvent}. */
export interface FoodDomainEventMeta {
  readonly eventId?: UUID;
  readonly occurredAt?: ISODateString;
  readonly correlationId?: UUID;
  readonly causationId?: UUID | null;
  readonly traceId?: UUID;
  readonly actorUserId?: UUID | null;
  readonly organizationId?: UUID | null;
}

/**
 * Build an envelope-compliant {@link DomainEvent} for a food-domain
 * aggregate.
 *
 * Behaviour:
 *  - `eventType` is the canonical `{Aggregate}.{Verb}` string from
 *    {@link FOOD_DOMAIN_EVENTS}.
 *  - `aggregateType` is parsed from the canonical string (everything
 *    before the first `.`), so `Customer.Created` → `Customer`,
 *    `RecipeVersion.Published` → `RecipeVersion`,
 *    `GraphNode.Created` → `GraphNode`, etc.
 *  - `tier` is fixed at `"domain"` (food-domain events are raised
 *    inside an aggregate and persisted to the outbox).
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
 *   const evt = buildFoodDomainEvent(
 *     "RecipeCreated",
 *     recipeId,
 *     { name: "Jollof Rice", servings: 4, cuisine: "Ghanaian" },
 *   );
 *   await eventBus().publish(evt);
 */
export function buildFoodDomainEvent(
  name: FoodDomainEvent,
  aggregateId: UUID,
  payload: Readonly<Record<string, unknown>>,
  meta?: FoodDomainEventMeta,
): DomainEvent {
  const eventType = FOOD_DOMAIN_EVENTS[name];
  const aggregateType = eventType.split(".", 2)[0] ?? "FoodDomain";
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
