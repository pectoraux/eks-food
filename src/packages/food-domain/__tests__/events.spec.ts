import { describe, expect, it } from "vitest";
import {
  FOOD_DOMAIN_EVENTS,
  buildFoodDomainEvent,
  type FoodDomainEvent,
} from "../events";
import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, uuid, asISODate, type UUID } from "@eks/common";

/** UUID v4 shape: 8-4-4-4-12 hex digits. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO-8601 UTC shape, e.g. `2024-01-01T00:00:00.000Z`. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

describe("FOOD_DOMAIN_EVENTS registry", () => {
  it("contains at least 38 canonical events", () => {
    const keys = Object.keys(FOOD_DOMAIN_EVENTS);
    expect(keys.length).toBeGreaterThanOrEqual(38);
  });

  it("every value follows the {Aggregate}.{PastTenseVerb} convention", () => {
    for (const [key, value] of Object.entries(FOOD_DOMAIN_EVENTS)) {
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
    const values = Object.values(FOOD_DOMAIN_EVENTS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("every key is unique (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(FOOD_DOMAIN_EVENTS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers every spec-mandated food-domain event", () => {
    const expected: readonly FoodDomainEvent[] = [
      "CustomerCreated",
      "CustomerUpdated",
      "HouseholdCreated",
      "HouseholdMemberAdded",
      "CookProfileCreated",
      "CookCertified",
      "RestaurantRegistered",
      "KitchenCreated",
      "KitchenCertified",
      "IngredientAdded",
      "IngredientUpdated",
      "RecipeCreated",
      "RecipeUpdated",
      "RecipeVersionPublished",
      "MenuItemAdded",
      "MenuUpdated",
      "InventoryAdjusted",
      "InventoryBatchReceived",
      "EquipmentRegistered",
      "VehicleRegistered",
      "SupplierRegistered",
      "VendorRegistered",
      "CertificationIssued",
      "CertificationExpired",
      "InspectionScheduled",
      "InspectionCompleted",
      "FoodSafetyIncidentReported",
      "FoodSafetyIncidentResolved",
      "NutritionProfileCreated",
      "RelationshipCreated",
      "RelationshipRemoved",
      "GraphNodeCreated",
      "GraphEdgeCreated",
      "EntityVersionCreated",
      "EntityImported",
      "EntityExported",
      "SearchIndexed",
    ];
    for (const name of expected) {
      expect(FOOD_DOMAIN_EVENTS[name]).toBeDefined();
      expect(typeof FOOD_DOMAIN_EVENTS[name]).toBe("string");
    }
  });
});

describe("buildFoodDomainEvent", () => {
  const aggregateId: UUID = asUUID("11111111-1111-4111-8111-111111111111");
  const payload = {
    name: "Jollof Rice",
    cuisine: "Ghanaian",
    servings: 4,
  };

  it("produces an object that satisfies the DomainEvent contract", () => {
    const evt = buildFoodDomainEvent("RecipeCreated", aggregateId, payload);
    const _: DomainEvent = evt; // type-level check
    expect(_).toBe(evt);
    expect(evt.tier).toBe("domain");
    expect(evt.version).toBe(EVENT_VERSION);
    expect(evt.version).toBe(1);
  });

  it("assigns a fresh v4 uuid as eventId", () => {
    const evt = buildFoodDomainEvent("RecipeCreated", aggregateId, payload);
    expect(typeof evt.eventId).toBe("string");
    expect(UUID_RE.test(evt.eventId)).toBe(true);
  });

  it("assigns a fresh ISO-8601 occurredAt", () => {
    const before = Date.now();
    const evt = buildFoodDomainEvent("RecipeCreated", aggregateId, payload);
    const after = Date.now();
    expect(typeof evt.occurredAt).toBe("string");
    expect(ISO_RE.test(evt.occurredAt)).toBe(true);
    const ts = Date.parse(evt.occurredAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("produces a fresh correlationId when no request context is active", () => {
    const evt = buildFoodDomainEvent("RecipeCreated", aggregateId, payload);
    expect(UUID_RE.test(evt.correlationId)).toBe(true);
  });

  it("defaults causationId to null outside a request context", () => {
    const evt = buildFoodDomainEvent("RecipeCreated", aggregateId, payload);
    expect(evt.causationId).toBeNull();
  });

  it("sets aggregateType from the canonical name (everything before the dot)", () => {
    const cases: ReadonlyArray<{ name: FoodDomainEvent; expectedType: string }> = [
      { name: "CustomerCreated", expectedType: "Customer" },
      { name: "CustomerUpdated", expectedType: "Customer" },
      { name: "CustomerDeleted", expectedType: "Customer" },
      { name: "HouseholdCreated", expectedType: "Household" },
      { name: "HouseholdMemberAdded", expectedType: "HouseholdMember" },
      { name: "HouseholdMemberRemoved", expectedType: "HouseholdMember" },
      { name: "CookProfileCreated", expectedType: "CookProfile" },
      { name: "CookCertified", expectedType: "Cook" },
      { name: "RestaurantRegistered", expectedType: "Restaurant" },
      { name: "KitchenCreated", expectedType: "Kitchen" },
      { name: "KitchenCertified", expectedType: "Kitchen" },
      { name: "IngredientAdded", expectedType: "Ingredient" },
      { name: "IngredientUpdated", expectedType: "Ingredient" },
      { name: "RecipeCreated", expectedType: "Recipe" },
      { name: "RecipeUpdated", expectedType: "Recipe" },
      { name: "RecipeVersionPublished", expectedType: "RecipeVersion" },
      { name: "MenuItemAdded", expectedType: "MenuItem" },
      { name: "MenuUpdated", expectedType: "Menu" },
      { name: "InventoryAdjusted", expectedType: "Inventory" },
      { name: "InventoryBatchReceived", expectedType: "InventoryBatch" },
      { name: "EquipmentRegistered", expectedType: "Equipment" },
      { name: "VehicleRegistered", expectedType: "Vehicle" },
      { name: "SupplierRegistered", expectedType: "Supplier" },
      { name: "VendorRegistered", expectedType: "Vendor" },
      { name: "CertificationIssued", expectedType: "Certification" },
      { name: "CertificationExpired", expectedType: "Certification" },
      { name: "CertificationRevoked", expectedType: "Certification" },
      { name: "InspectionScheduled", expectedType: "Inspection" },
      { name: "InspectionCompleted", expectedType: "Inspection" },
      { name: "FoodSafetyIncidentReported", expectedType: "FoodSafetyIncident" },
      { name: "FoodSafetyIncidentResolved", expectedType: "FoodSafetyIncident" },
      { name: "NutritionProfileCreated", expectedType: "NutritionProfile" },
      { name: "RelationshipCreated", expectedType: "Relationship" },
      { name: "RelationshipRemoved", expectedType: "Relationship" },
      { name: "GraphNodeCreated", expectedType: "GraphNode" },
      { name: "GraphEdgeCreated", expectedType: "GraphEdge" },
      { name: "EntityVersionCreated", expectedType: "EntityVersion" },
      { name: "EntityImported", expectedType: "Entity" },
      { name: "EntityExported", expectedType: "Entity" },
      { name: "SearchIndexed", expectedType: "Search" },
    ];
    for (const { name, expectedType } of cases) {
      const evt = buildFoodDomainEvent(name, aggregateId, payload);
      expect(evt.aggregateType).toBe(expectedType);
      expect(evt.eventType).toBe(FOOD_DOMAIN_EVENTS[name]);
    }
  });

  it("carries the supplied aggregateId and payload verbatim", () => {
    const evt = buildFoodDomainEvent("RecipeCreated", aggregateId, payload);
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
    const occurredAt = asISODate("2024-01-01T00:00:00.000Z");

    const evt = buildFoodDomainEvent(
      "RecipeVersionPublished",
      aggregateId,
      payload,
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
    const evt = buildFoodDomainEvent("RecipeCreated", aggregateId, payload);
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
    const a = buildFoodDomainEvent("RecipeCreated", aggregateId, payload);
    const b = buildFoodDomainEvent("RecipeCreated", aggregateId, payload);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventType).toBe(b.eventType);
    expect(a.aggregateType).toBe(b.aggregateType);
  });

  it("works for every event in the registry (exhaustive smoke)", () => {
    const names = Object.keys(FOOD_DOMAIN_EVENTS) as readonly FoodDomainEvent[];
    expect(names.length).toBeGreaterThanOrEqual(38);
    for (const name of names) {
      const evt = buildFoodDomainEvent(name, aggregateId, { name });
      expect(evt.tier).toBe("domain");
      expect(evt.version).toBe(1);
      expect(evt.eventType).toBe(FOOD_DOMAIN_EVENTS[name]);
      expect(evt.aggregateType).toBe(FOOD_DOMAIN_EVENTS[name].split(".", 2)[0]);
      expect(evt.aggregateId).toBe(aggregateId);
      expect(evt.payload).toEqual({ name });
      expect(UUID_RE.test(evt.eventId)).toBe(true);
    }
  });

  it("two distinct food-domain events of the same type carry distinct eventIds", () => {
    const a = buildFoodDomainEvent("FoodSafetyIncidentReported", aggregateId, {
      severity: "critical",
    });
    const b = buildFoodDomainEvent("FoodSafetyIncidentReported", aggregateId, {
      severity: "moderate",
    });
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventType).toBe(b.eventType);
    expect(a.aggregateId).toBe(b.aggregateId);
  });
});
