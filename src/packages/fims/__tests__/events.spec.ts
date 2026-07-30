import { describe, expect, it } from "vitest";
import {
  FIMS_EVENTS,
  buildFimsEvent,
  type FimEvent,
} from "../events";
import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, uuid, asISODate, type UUID } from "@eks/common";

/** UUID v4 shape: 8-4-4-4-12 hex digits. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO-8601 UTC shape, e.g. `2024-01-01T00:00:00.000Z`. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

describe("FIMS_EVENTS registry", () => {
  it("contains at least 33 canonical events", () => {
    const keys = Object.keys(FIMS_EVENTS);
    expect(keys.length).toBeGreaterThanOrEqual(33);
  });

  it("every value follows the {Aggregate}.{PastTenseVerb} convention", () => {
    for (const [key, value] of Object.entries(FIMS_EVENTS)) {
      expect(typeof value).toBe("string");
      // Exactly one dot, with non-empty aggregate and verb.
      const parts = value.split(".");
      expect(parts, `event ${key} = "${value}" must have one dot`).toHaveLength(2);
      expect(parts[0]?.length, `aggregate part of "${value}"`).toBeGreaterThan(0);
      expect(parts[1]?.length, `verb part of "${value}"`).toBeGreaterThan(0);
      // Aggregate is PascalCase (starts uppercase), verb starts uppercase too.
      expect(parts[0]?.[0]).toMatch(/^[A-Z]$/);
      expect(parts[1]?.[0]).toMatch(/^[A-Z]$/);
    }
  });

  it("every value is unique (no two events share an eventType)", () => {
    const values = Object.values(FIMS_EVENTS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("every key is unique (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(FIMS_EVENTS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers every spec-mandated FIMS event", () => {
    const expected: readonly FimEvent[] = [
      "CatalogItemAdded",
      "CatalogItemUpdated",
      "CatalogItemPublished",
      "IngredientVariantCreated",
      "RecipeCreated",
      "RecipeUpdated",
      "RecipePublished",
      "RecipeVersionCreated",
      "RecipeScaled",
      "RecipeStageAdded",
      "MenuCreated",
      "MenuUpdated",
      "MenuPublished",
      "MenuVersionCreated",
      "MenuItemAdded",
      "MenuBundleCreated",
      "NutritionCalculated",
      "AllergenDetected",
      "DietaryClassified",
      "InventoryAdjusted",
      "InventoryReceived",
      "InventoryTransferred",
      "BatchCreated",
      "BatchExpired",
      "WasteRecorded",
      "StockMovementRecorded",
      "InventoryReserved",
      "InventoryAuditCompleted",
      "CatalogImported",
      "CatalogExported",
      "MeasurementConverted",
      "TaxonomyUpdated",
    ];
    for (const name of expected) {
      expect(FIMS_EVENTS[name]).toBeDefined();
      expect(typeof FIMS_EVENTS[name]).toBe("string");
    }
  });

  it("covers the catalog lifecycle (added → updated → published)", () => {
    const lifecycle = [
      FIMS_EVENTS.CatalogItemAdded,
      FIMS_EVENTS.CatalogItemUpdated,
      FIMS_EVENTS.CatalogItemPublished,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const evt of lifecycle) {
      expect(evt.startsWith("CatalogItem.")).toBe(true);
    }
  });

  it("covers the recipe lifecycle (create → update → publish → version → scale → stage)", () => {
    const lifecycle = [
      FIMS_EVENTS.RecipeCreated,
      FIMS_EVENTS.RecipeUpdated,
      FIMS_EVENTS.RecipePublished,
      FIMS_EVENTS.RecipeVersionCreated,
      FIMS_EVENTS.RecipeScaled,
      FIMS_EVENTS.RecipeStageAdded,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const evt of lifecycle) {
      expect(evt.startsWith("Recipe") || evt.startsWith("RecipeVersion") || evt.startsWith("RecipeStage")).toBe(true);
    }
  });

  it("covers the inventory lifecycle (adjust → receive → transfer → reserve → audit)", () => {
    const lifecycle = [
      FIMS_EVENTS.InventoryAdjusted,
      FIMS_EVENTS.InventoryReceived,
      FIMS_EVENTS.InventoryTransferred,
      FIMS_EVENTS.InventoryReserved,
      FIMS_EVENTS.InventoryAuditCompleted,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
  });

  it("covers the batch lifecycle (create → expire / recall)", () => {
    expect(FIMS_EVENTS.BatchCreated).toBe("Batch.Created");
    expect(FIMS_EVENTS.BatchExpired).toBe("Batch.Expired");
  });

  it("covers nutrition, allergen and dietary intelligence", () => {
    expect(FIMS_EVENTS.NutritionCalculated).toBe("Nutrition.Calculated");
    expect(FIMS_EVENTS.AllergenDetected).toBe("Allergen.Detected");
    expect(FIMS_EVENTS.DietaryClassified).toBe("Dietary.Classified");
  });
});

describe("buildFimsEvent", () => {
  const aggregateId: UUID = asUUID("22222222-2222-4222-8222-222222222222");
  const payload = {
    name: "Egusi Soup",
    servings: 4,
    cuisine: "Nigerian",
  };

  it("produces an object that satisfies the DomainEvent contract", () => {
    const evt = buildFimsEvent("RecipeCreated", aggregateId, payload);
    const _: DomainEvent = evt; // type-level check
    expect(_).toBe(evt);
    expect(evt.tier).toBe("domain");
    expect(evt.version).toBe(EVENT_VERSION);
    expect(evt.version).toBe(1);
  });

  it("assigns a fresh v4 uuid as eventId", () => {
    const evt = buildFimsEvent("RecipeCreated", aggregateId, payload);
    expect(typeof evt.eventId).toBe("string");
    expect(UUID_RE.test(evt.eventId)).toBe(true);
  });

  it("assigns a fresh ISO-8601 occurredAt", () => {
    const before = Date.now();
    const evt = buildFimsEvent("RecipeCreated", aggregateId, payload);
    const after = Date.now();
    expect(typeof evt.occurredAt).toBe("string");
    expect(ISO_RE.test(evt.occurredAt)).toBe(true);
    const ts = Date.parse(evt.occurredAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("produces a fresh correlationId when no request context is active", () => {
    const evt = buildFimsEvent("RecipeCreated", aggregateId, payload);
    expect(UUID_RE.test(evt.correlationId)).toBe(true);
  });

  it("defaults causationId to null outside a request context", () => {
    const evt = buildFimsEvent("RecipeCreated", aggregateId, payload);
    expect(evt.causationId).toBeNull();
  });

  it("sets aggregateType from the canonical name (everything before the dot)", () => {
    const cases: ReadonlyArray<{ name: FimEvent; expectedType: string }> = [
      { name: "CatalogItemAdded", expectedType: "CatalogItem" },
      { name: "CatalogItemUpdated", expectedType: "CatalogItem" },
      { name: "CatalogItemPublished", expectedType: "CatalogItem" },
      { name: "CatalogItemArchived", expectedType: "CatalogItem" },
      { name: "IngredientVariantCreated", expectedType: "IngredientVariant" },
      { name: "RecipeCreated", expectedType: "Recipe" },
      { name: "RecipeUpdated", expectedType: "Recipe" },
      { name: "RecipePublished", expectedType: "Recipe" },
      { name: "RecipeVersionCreated", expectedType: "RecipeVersion" },
      { name: "RecipeScaled", expectedType: "Recipe" },
      { name: "RecipeStageAdded", expectedType: "RecipeStage" },
      { name: "MenuCreated", expectedType: "Menu" },
      { name: "MenuUpdated", expectedType: "Menu" },
      { name: "MenuPublished", expectedType: "Menu" },
      { name: "MenuVersionCreated", expectedType: "MenuVersion" },
      { name: "MenuItemAdded", expectedType: "MenuItem" },
      { name: "MenuBundleCreated", expectedType: "MenuBundle" },
      { name: "NutritionCalculated", expectedType: "Nutrition" },
      { name: "AllergenDetected", expectedType: "Allergen" },
      { name: "DietaryClassified", expectedType: "Dietary" },
      { name: "InventoryAdjusted", expectedType: "Inventory" },
      { name: "InventoryReceived", expectedType: "Inventory" },
      { name: "InventoryTransferred", expectedType: "Inventory" },
      { name: "InventoryReserved", expectedType: "Inventory" },
      { name: "InventoryAuditCompleted", expectedType: "InventoryAudit" },
      { name: "InventoryDeleted", expectedType: "Inventory" },
      { name: "BatchCreated", expectedType: "Batch" },
      { name: "BatchExpired", expectedType: "Batch" },
      { name: "BatchRecalled", expectedType: "Batch" },
      { name: "WasteRecorded", expectedType: "Waste" },
      { name: "StockMovementRecorded", expectedType: "StockMovement" },
      { name: "CatalogImported", expectedType: "Catalog" },
      { name: "CatalogExported", expectedType: "Catalog" },
      { name: "MeasurementConverted", expectedType: "Measurement" },
      { name: "TaxonomyUpdated", expectedType: "Taxonomy" },
    ];
    for (const { name, expectedType } of cases) {
      const evt = buildFimsEvent(name, aggregateId, payload);
      expect(evt.aggregateType).toBe(expectedType);
      expect(evt.eventType).toBe(FIMS_EVENTS[name]);
    }
  });

  it("carries the supplied aggregateId and payload verbatim", () => {
    const evt = buildFimsEvent("RecipeCreated", aggregateId, payload);
    expect(evt.aggregateId).toBe(aggregateId);
    expect(evt.payload).toEqual(payload);
  });

  it("honours meta overrides for eventId, correlationId, causationId, traceId", () => {
    const eventId = uuid();
    const correlationId = uuid();
    const causationId = uuid();
    const traceId = uuid();
    const actorUserId = uuid();
    const organizationId = uuid();
    const occurredAt = asISODate("2024-06-01T12:00:00.000Z");

    const evt = buildFimsEvent(
      "RecipeScaled",
      aggregateId,
      { fromServings: 4, toServings: 10, factor: 2.5 },
      {
        eventId,
        occurredAt,
        correlationId,
        causationId,
        traceId,
        actorUserId,
        organizationId,
      },
    );

    expect(evt.eventId).toBe(eventId);
    expect(evt.occurredAt).toBe(occurredAt);
    expect(evt.correlationId).toBe(correlationId);
    expect(evt.causationId).toBe(causationId);
    expect(evt.traceId).toBe(traceId);
    expect(evt.actorUserId).toBe(actorUserId);
    expect(evt.organizationId).toBe(organizationId);
  });

  it("the envelope has exactly the DomainEvent-required fields, no extras", () => {
    const evt = buildFimsEvent("RecipeCreated", aggregateId, payload);
    const requiredKeys: readonly string[] = [
      "tier",
      "eventId",
      "occurredAt",
      "correlationId",
      "causationId",
      "version",
      "traceId",
      "actorUserId",
      "organizationId",
      "aggregateType",
      "aggregateId",
      "eventType",
      "payload",
    ];
    const actualKeys = Object.keys(evt).sort();
    expect(actualKeys).toEqual([...requiredKeys].sort());
    expect(actualKeys.length).toBe(requiredKeys.length);
  });

  it("two consecutive calls produce distinct eventIds", () => {
    const a = buildFimsEvent("RecipeCreated", aggregateId, payload);
    const b = buildFimsEvent("RecipeCreated", aggregateId, payload);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventType).toBe(b.eventType);
    expect(a.aggregateType).toBe(b.aggregateType);
  });

  it("works for every event in the registry (exhaustive smoke)", () => {
    const names = Object.keys(FIMS_EVENTS) as readonly FimEvent[];
    expect(names.length).toBeGreaterThanOrEqual(33);
    for (const name of names) {
      const evt = buildFimsEvent(name, aggregateId, { name });
      expect(evt.tier).toBe("domain");
      expect(evt.version).toBe(1);
      expect(evt.eventType).toBe(FIMS_EVENTS[name]);
      expect(evt.aggregateType).toBe(FIMS_EVENTS[name].split(".", 2)[0]);
      expect(evt.aggregateId).toBe(aggregateId);
      expect(evt.payload).toEqual({ name });
      expect(UUID_RE.test(evt.eventId)).toBe(true);
    }
  });

  it("two distinct FIMS events of the same type carry distinct eventIds", () => {
    const a = buildFimsEvent("BatchExpired", aggregateId, {
      batchId: "batch-1",
      reason: "shelf_life",
    });
    const b = buildFimsEvent("BatchExpired", aggregateId, {
      batchId: "batch-2",
      reason: "quality",
    });
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventType).toBe(b.eventType);
    expect(a.aggregateId).toBe(b.aggregateId);
  });
});
