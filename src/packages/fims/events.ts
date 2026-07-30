/**
 * @file fims/events.ts
 * @package @eks/fims
 *
 * Food Intelligence & Management System (FIMS) domain events registry.
 *
 * Responsibility:
 *  - Define the canonical set of FIMS domain events as a single constant
 *    (`FIMS_EVENTS`) so producers and consumers reference the same literal
 *    strings for `eventType`. Each entry maps a PascalCase key (used in
 *    code) to the wire-format `{Aggregate}.{PastTenseVerb}` string that
 *    goes onto every {@link DomainEvent} envelope (see
 *    docs/EVENT_CONVENTIONS.md).
 *  - Expose `FimEvent` — a string-literal union derived from the registry
 *    keys — so call sites are exhaustively checked by the compiler when
 *    switching over FIMS events.
 *  - Provide `buildFimsEvent`, the single factory that produces
 *    envelope-compliant {@link DomainEvent} instances for any FIMS event,
 *    with correlation/causation/trace ids pulled from the ambient request
 *    context (set via `withRequestContext`).
 *
 * Coverage:
 *  - Catalog item lifecycle (add, update, publish, archive, import, export)
 *  - Ingredient variant creation
 *  - Recipe lifecycle (create, update, publish, version, scale, stage, archive)
 *  - Menu lifecycle (create, update, publish, version, item, bundle, archive)
 *  - Nutrition calculation, allergen detection, dietary classification
 *  - Inventory lifecycle (adjust, receive, transfer, reserve, audit, delete)
 *  - Batch lifecycle (create, expire, recall)
 *  - Waste recording & stock movement
 *  - Measurement conversion & taxonomy updates
 *
 * Constraints:
 *  - Pure TypeScript, no `any`, no I/O.
 *  - The returned object strictly satisfies the `DomainEvent` contract
 *    from `@eks/events` (`tier: "domain"`, `version: 1`).
 *  - Follows the EXACT same convention as `@eks/identity/events.ts`,
 *    `@eks/developer/events.ts`, `@eks/integration/events.ts`,
 *    `@eks/connectors/events.ts`, `@eks/food-domain/events.ts`.
 */

import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, asISODate, uuid, type UUID, type ISODateString } from "@eks/common";
import { requestContext } from "@eks/observability";

/**
 * Canonical FIMS domain events.
 *
 * The single source of truth for FIMS event type strings. Every consumer
 * of FIMS events (audit log, outbox, projections, search index,
 * inventory ledger, nutrition cache, allergen registry) MUST reference
 * these constants rather than spelling out the literal string — that way
 * the compiler catches typos and renaming is a single edit.
 *
 * Naming follows the `{Aggregate}.{PastTenseVerb}` convention
 * documented in docs/EVENT_CONVENTIONS.md §3 (e.g. `CatalogItem.Added`,
 * `Recipe.Scaled`, `Inventory.Received`).
 */
export const FIMS_EVENTS = {
  // Catalog item lifecycle
  CatalogItemAdded: "CatalogItem.Added",
  CatalogItemUpdated: "CatalogItem.Updated",
  CatalogItemPublished: "CatalogItem.Published",
  CatalogItemArchived: "CatalogItem.Archived",

  // Ingredient variants
  IngredientVariantCreated: "IngredientVariant.Created",

  // Recipe lifecycle
  RecipeCreated: "Recipe.Created",
  RecipeUpdated: "Recipe.Updated",
  RecipePublished: "Recipe.Published",
  RecipeVersionCreated: "RecipeVersion.Created",
  RecipeScaled: "Recipe.Scaled",
  RecipeStageAdded: "RecipeStage.Added",
  RecipeArchived: "Recipe.Archived",

  // Menu lifecycle
  MenuCreated: "Menu.Created",
  MenuUpdated: "Menu.Updated",
  MenuPublished: "Menu.Published",
  MenuVersionCreated: "MenuVersion.Created",
  MenuItemAdded: "MenuItem.Added",
  MenuBundleCreated: "MenuBundle.Created",
  MenuArchived: "Menu.Archived",

  // Nutrition, allergens, dietary classification
  NutritionCalculated: "Nutrition.Calculated",
  AllergenDetected: "Allergen.Detected",
  DietaryClassified: "Dietary.Classified",

  // Inventory lifecycle
  InventoryAdjusted: "Inventory.Adjusted",
  InventoryReceived: "Inventory.Received",
  InventoryTransferred: "Inventory.Transferred",
  InventoryReserved: "Inventory.Reserved",
  InventoryAuditCompleted: "InventoryAudit.Completed",
  InventoryDeleted: "Inventory.Deleted",

  // Batch lifecycle
  BatchCreated: "Batch.Created",
  BatchExpired: "Batch.Expired",
  BatchRecalled: "Batch.Recalled",

  // Waste & stock movements
  WasteRecorded: "Waste.Recorded",
  StockMovementRecorded: "StockMovement.Recorded",

  // Catalog import/export
  CatalogImported: "Catalog.Imported",
  CatalogExported: "Catalog.Exported",

  // Measurement & taxonomy
  MeasurementConverted: "Measurement.Converted",
  TaxonomyUpdated: "Taxonomy.Updated",
} as const;

/**
 * Union of every canonical FIMS event name. Use this as the type of the
 * `name` argument to {@link buildFimsEvent} so the compiler rejects
 * unknown events at the call site.
 */
export type FimEvent = keyof typeof FIMS_EVENTS;

/** Optional overrides accepted by {@link buildFimsEvent}. */
export interface FimsEventMeta {
  readonly eventId?: UUID;
  readonly occurredAt?: ISODateString;
  readonly correlationId?: UUID;
  readonly causationId?: UUID | null;
  readonly traceId?: UUID;
  readonly actorUserId?: UUID | null;
  readonly organizationId?: UUID | null;
}

/**
 * Build an envelope-compliant {@link DomainEvent} for a FIMS aggregate.
 *
 * Behaviour:
 *  - `eventType` is the canonical `{Aggregate}.{Verb}` string from
 *    {@link FIMS_EVENTS}.
 *  - `aggregateType` is parsed from the canonical string (everything
 *    before the first `.`), so `CatalogItem.Added` → `CatalogItem`,
 *    `RecipeVersion.Created` → `RecipeVersion`,
 *    `InventoryAudit.Completed` → `InventoryAudit`, etc.
 *  - `tier` is fixed at `"domain"` (FIMS events are raised inside an
 *    aggregate and persisted to the outbox).
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
 *   const evt = buildFimsEvent(
 *     "RecipeScaled",
 *     recipeId,
 *     { fromServings: 4, toServings: 10, factor: 2.5 },
 *   );
 *   await eventBus().publish(evt);
 */
export function buildFimsEvent(
  name: FimEvent,
  aggregateId: UUID,
  payload: Readonly<Record<string, unknown>>,
  meta?: FimsEventMeta,
): DomainEvent {
  const eventType = FIMS_EVENTS[name];
  const aggregateType = eventType.split(".", 2)[0] ?? "Fims";
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
