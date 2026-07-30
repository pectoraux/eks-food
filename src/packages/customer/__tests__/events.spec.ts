import { describe, expect, it } from "vitest";
import {
  CUSTOMER_EVENTS,
  buildCustomerEvent,
  type CustomerEvent,
} from "../events";
import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, uuid, asISODate, type UUID } from "@eks/common";

/** UUID v4 shape: 8-4-4-4-12 hex digits. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO-8601 UTC shape, e.g. `2024-01-01T00:00:00.000Z`. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

describe("CUSTOMER_EVENTS registry", () => {
  it("contains at least 30 canonical events", () => {
    const keys = Object.keys(CUSTOMER_EVENTS);
    expect(keys.length).toBeGreaterThanOrEqual(30);
  });

  it("every value follows the {Aggregate}.{PastTenseVerb} convention", () => {
    for (const [key, value] of Object.entries(CUSTOMER_EVENTS)) {
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
    const values = Object.values(CUSTOMER_EVENTS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("every key is unique (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(CUSTOMER_EVENTS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers every spec-mandated customer event", () => {
    const expected: readonly CustomerEvent[] = [
      "HouseholdCreated",
      "HouseholdUpdated",
      "HouseholdMemberAdded",
      "HouseholdMemberRemoved",
      "HouseholdRelationshipCreated",
      "AddressAdded",
      "AddressValidated",
      "PreferenceUpdated",
      "CuisinePreferenceSet",
      "IngredientPreferenceSet",
      "DietaryProfileAssigned",
      "AllergyRecorded",
      "NutritionGoalSet",
      "MealHistoryRecorded",
      "MealPlanCreated",
      "MealPlanned",
      "ShoppingListCreated",
      "ShoppingListItemAdded",
      "ShoppingListCompleted",
      "PantryUpdated",
      "PantryItemAdded",
      "PantryItemExpired",
      "FavoriteAdded",
      "FavoriteRemoved",
      "ReviewSubmitted",
      "ReviewModerated",
      "RatingSubmitted",
      "NotificationPreferenceUpdated",
      "HouseholdInvitationSent",
      "HouseholdInvitationAccepted",
    ];
    for (const name of expected) {
      expect(CUSTOMER_EVENTS[name]).toBeDefined();
      expect(typeof CUSTOMER_EVENTS[name]).toBe("string");
    }
  });

  it("covers the household lifecycle (create → update → member add/remove → relationship)", () => {
    const lifecycle = [
      CUSTOMER_EVENTS.HouseholdCreated,
      CUSTOMER_EVENTS.HouseholdUpdated,
      CUSTOMER_EVENTS.HouseholdMemberAdded,
      CUSTOMER_EVENTS.HouseholdMemberRemoved,
      CUSTOMER_EVENTS.HouseholdRelationshipCreated,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const evt of lifecycle) {
      expect(evt.startsWith("Household")).toBe(true);
    }
  });

  it("covers the pantry lifecycle (update → add → expire)", () => {
    const lifecycle = [
      CUSTOMER_EVENTS.PantryUpdated,
      CUSTOMER_EVENTS.PantryItemAdded,
      CUSTOMER_EVENTS.PantryItemExpired,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const evt of lifecycle) {
      expect(evt.startsWith("Pantry")).toBe(true);
    }
  });

  it("covers the shopping list lifecycle (create → item add → complete)", () => {
    const lifecycle = [
      CUSTOMER_EVENTS.ShoppingListCreated,
      CUSTOMER_EVENTS.ShoppingListItemAdded,
      CUSTOMER_EVENTS.ShoppingListCompleted,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const evt of lifecycle) {
      expect(evt.startsWith("ShoppingList")).toBe(true);
    }
  });

  it("covers preferences, dietary, reviews and notifications", () => {
    expect(CUSTOMER_EVENTS.PreferenceUpdated).toBe("Preference.Updated");
    expect(CUSTOMER_EVENTS.CuisinePreferenceSet).toBe("CuisinePreference.Set");
    expect(CUSTOMER_EVENTS.DietaryProfileAssigned).toBe("DietaryProfile.Assigned");
    expect(CUSTOMER_EVENTS.AllergyRecorded).toBe("Allergy.Recorded");
    expect(CUSTOMER_EVENTS.ReviewSubmitted).toBe("Review.Submitted");
    expect(CUSTOMER_EVENTS.NotificationPreferenceUpdated).toBe(
      "NotificationPreference.Updated",
    );
  });
});

describe("buildCustomerEvent", () => {
  const aggregateId: UUID = asUUID("33333333-3333-4333-8333-333333333333");
  const payload = {
    name: "Mensah Household",
    headOfHousehold: "Amara Mensah",
    locale: "tw",
  };

  it("produces an object that satisfies the DomainEvent contract", () => {
    const evt = buildCustomerEvent("HouseholdCreated", aggregateId, payload);
    const _: DomainEvent = evt; // type-level check
    expect(_).toBe(evt);
    expect(evt.tier).toBe("domain");
    expect(evt.version).toBe(EVENT_VERSION);
    expect(evt.version).toBe(1);
  });

  it("assigns a fresh v4 uuid as eventId", () => {
    const evt = buildCustomerEvent("HouseholdCreated", aggregateId, payload);
    expect(typeof evt.eventId).toBe("string");
    expect(UUID_RE.test(evt.eventId)).toBe(true);
  });

  it("assigns a fresh ISO-8601 occurredAt", () => {
    const before = Date.now();
    const evt = buildCustomerEvent("HouseholdCreated", aggregateId, payload);
    const after = Date.now();
    expect(typeof evt.occurredAt).toBe("string");
    expect(ISO_RE.test(evt.occurredAt)).toBe(true);
    const ts = Date.parse(evt.occurredAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("produces a fresh correlationId when no request context is active", () => {
    const evt = buildCustomerEvent("HouseholdCreated", aggregateId, payload);
    expect(UUID_RE.test(evt.correlationId)).toBe(true);
  });

  it("defaults causationId to null outside a request context", () => {
    const evt = buildCustomerEvent("HouseholdCreated", aggregateId, payload);
    expect(evt.causationId).toBeNull();
  });

  it("sets aggregateType from the canonical name (everything before the dot)", () => {
    const cases: ReadonlyArray<{ name: CustomerEvent; expectedType: string }> = [
      { name: "HouseholdCreated", expectedType: "Household" },
      { name: "HouseholdUpdated", expectedType: "Household" },
      { name: "HouseholdMemberAdded", expectedType: "HouseholdMember" },
      { name: "HouseholdMemberRemoved", expectedType: "HouseholdMember" },
      { name: "HouseholdRelationshipCreated", expectedType: "HouseholdRelationship" },
      { name: "AddressAdded", expectedType: "Address" },
      { name: "AddressValidated", expectedType: "Address" },
      { name: "PreferenceUpdated", expectedType: "Preference" },
      { name: "CuisinePreferenceSet", expectedType: "CuisinePreference" },
      { name: "IngredientPreferenceSet", expectedType: "IngredientPreference" },
      { name: "DietaryProfileAssigned", expectedType: "DietaryProfile" },
      { name: "AllergyRecorded", expectedType: "Allergy" },
      { name: "NutritionGoalSet", expectedType: "NutritionGoal" },
      { name: "MealHistoryRecorded", expectedType: "MealHistory" },
      { name: "MealPlanCreated", expectedType: "MealPlan" },
      { name: "MealPlanned", expectedType: "Meal" },
      { name: "ShoppingListCreated", expectedType: "ShoppingList" },
      { name: "ShoppingListItemAdded", expectedType: "ShoppingListItem" },
      { name: "ShoppingListCompleted", expectedType: "ShoppingList" },
      { name: "PantryUpdated", expectedType: "Pantry" },
      { name: "PantryItemAdded", expectedType: "PantryItem" },
      { name: "PantryItemExpired", expectedType: "PantryItem" },
      { name: "FavoriteAdded", expectedType: "Favorite" },
      { name: "FavoriteRemoved", expectedType: "Favorite" },
      { name: "ReviewSubmitted", expectedType: "Review" },
      { name: "ReviewModerated", expectedType: "Review" },
      { name: "RatingSubmitted", expectedType: "Rating" },
      { name: "NotificationPreferenceUpdated", expectedType: "NotificationPreference" },
      { name: "HouseholdInvitationSent", expectedType: "HouseholdInvitation" },
      { name: "HouseholdInvitationAccepted", expectedType: "HouseholdInvitation" },
    ];
    for (const { name, expectedType } of cases) {
      const evt = buildCustomerEvent(name, aggregateId, payload);
      expect(evt.aggregateType).toBe(expectedType);
      expect(evt.eventType).toBe(CUSTOMER_EVENTS[name]);
    }
  });

  it("carries the supplied aggregateId and payload verbatim", () => {
    const evt = buildCustomerEvent("HouseholdCreated", aggregateId, payload);
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

    const evt = buildCustomerEvent(
      "HouseholdMemberAdded",
      aggregateId,
      { userId: uuid(), role: "ADMIN" },
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
    const evt = buildCustomerEvent("HouseholdCreated", aggregateId, payload);
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
    const a = buildCustomerEvent("HouseholdCreated", aggregateId, payload);
    const b = buildCustomerEvent("HouseholdCreated", aggregateId, payload);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventType).toBe(b.eventType);
    expect(a.aggregateType).toBe(b.aggregateType);
  });

  it("works for every event in the registry (exhaustive smoke)", () => {
    const names = Object.keys(CUSTOMER_EVENTS) as readonly CustomerEvent[];
    expect(names.length).toBeGreaterThanOrEqual(30);
    for (const name of names) {
      const evt = buildCustomerEvent(name, aggregateId, { name });
      expect(evt.tier).toBe("domain");
      expect(evt.version).toBe(1);
      expect(evt.eventType).toBe(CUSTOMER_EVENTS[name]);
      expect(evt.aggregateType).toBe(CUSTOMER_EVENTS[name].split(".", 2)[0]);
      expect(evt.aggregateId).toBe(aggregateId);
      expect(evt.payload).toEqual({ name });
      expect(UUID_RE.test(evt.eventId)).toBe(true);
    }
  });

  it("two distinct customer events of the same type carry distinct eventIds", () => {
    const a = buildCustomerEvent("PantryItemExpired", aggregateId, {
      ingredient: "rice",
      reason: "shelf_life",
    });
    const b = buildCustomerEvent("PantryItemExpired", aggregateId, {
      ingredient: "tomato",
      reason: "spoilage",
    });
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventType).toBe(b.eventType);
    expect(a.aggregateId).toBe(b.aggregateId);
  });
});
