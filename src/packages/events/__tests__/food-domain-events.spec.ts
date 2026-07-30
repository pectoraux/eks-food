import { describe, expect, it } from "vitest";
import { EventBus } from "../bus";
import type { DomainEvent } from "../types";
import {
  FOOD_DOMAIN_EVENTS,
  buildFoodDomainEvent,
} from "@eks/food-domain";
import { asUUID, uuid, type UUID } from "@eks/common";

/**
 * Integration test: a `RecipeCreated` event built via
 * `buildFoodDomainEvent` flows through a fresh `EventBus` and reaches
 * a subscriber with the correct `eventType` and `aggregateId`. Then
 * verify the bus's idempotency guarantee: re-publishing the SAME
 * event (same `eventId`) does NOT re-deliver to the subscriber.
 *
 * Mirrors the structure of `integration-events.spec.ts`,
 * `identity-events.spec.ts`, `developer-events.spec.ts`, and
 * `connector-events.spec.ts` but exercises the @eks/food-domain event
 * registry end-to-end.
 */

describe("EventBus ↔ @eks/food-domain integration", () => {
  it("delivers a buildFoodDomainEvent-produced RecipeCreated event to a matching subscriber", async () => {
    const bus = new EventBus();
    const recipeId: UUID = asUUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const payload = {
      name: "Jollof Rice",
      cuisine: "Ghanaian",
      servings: 4,
      cookTimeMinutes: 45,
    };

    const event = buildFoodDomainEvent("RecipeCreated", recipeId, payload);

    // Type-level check: buildFoodDomainEvent's output IS a DomainEvent.
    const _typeCheck: DomainEvent = event;
    expect(_typeCheck).toBe(event);

    const received: DomainEvent[] = [];
    bus.subscribe(FOOD_DOMAIN_EVENTS.RecipeCreated, async (e) => {
      received.push(e as DomainEvent);
    });

    await bus.publish(event);

    expect(received).toHaveLength(1);
    const got = received[0];
    if (got === undefined) {
      throw new Error("subscriber did not receive the event");
    }
    expect(got.eventType).toBe("Recipe.Created");
    expect(got.aggregateId).toBe(recipeId);
    expect(got.aggregateType).toBe("Recipe");
    expect(got.tier).toBe("domain");
    expect(got.version).toBe(1);
    expect(got.payload).toEqual(payload);
    expect(got.eventId).toBe(event.eventId);
  });

  it("does not deliver to a subscriber of a different food-domain event type", async () => {
    const bus = new EventBus();
    const recipeId: UUID = asUUID("11111111-1111-4111-8111-111111111111");

    const recipeReceived: string[] = [];
    const ingredientReceived: string[] = [];

    bus.subscribe(FOOD_DOMAIN_EVENTS.RecipeCreated, async (e) => {
      recipeReceived.push(e.eventId);
    });
    bus.subscribe(FOOD_DOMAIN_EVENTS.IngredientAdded, async (e) => {
      ingredientReceived.push(e.eventId);
    });

    const recipe = buildFoodDomainEvent("RecipeCreated", recipeId, {
      name: "Jollof Rice",
      cuisine: "Ghanaian",
    });
    await bus.publish(recipe);

    expect(recipeReceived).toEqual([recipe.eventId]);
    expect(ingredientReceived).toEqual([]);
  });

  it("idempotent re-publish does not re-deliver (same eventId → single delivery)", async () => {
    const bus = new EventBus();
    const recipeId: UUID = asUUID("22222222-2222-4222-8222-222222222222");

    let deliveryCount = 0;
    const seenEventIds: string[] = [];

    bus.subscribe(FOOD_DOMAIN_EVENTS.RecipeCreated, async (e) => {
      deliveryCount += 1;
      seenEventIds.push(e.eventId);
    });

    const event = buildFoodDomainEvent("RecipeCreated", recipeId, {
      name: "Fried Plantain",
      cuisine: "Ghanaian",
    });

    await bus.publish(event);
    expect(deliveryCount).toBe(1);

    // Re-publish the SAME event instance (same eventId) — the bus's
    // idempotency log MUST suppress the second and third deliveries.
    await bus.publish(event);
    await bus.publish(event);

    expect(deliveryCount).toBe(1);
    expect(seenEventIds).toEqual([event.eventId]);
  });

  it("two distinct food-domain events (different eventIds) both get delivered", async () => {
    const bus = new EventBus();
    const incidentId: UUID = asUUID("33333333-3333-4333-8333-333333333333");

    const seen: string[] = [];
    bus.subscribe(FOOD_DOMAIN_EVENTS.FoodSafetyIncidentReported, async (e) => {
      seen.push(e.eventId);
    });

    const a = buildFoodDomainEvent("FoodSafetyIncidentReported", incidentId, {
      severity: "critical",
      summary: "Cross-contamination observed in prep area",
    });
    const b = buildFoodDomainEvent("FoodSafetyIncidentReported", incidentId, {
      severity: "moderate",
      summary: "Cold-storage temperature log missing",
    });

    expect(a.eventId).not.toBe(b.eventId);

    await bus.publish(a);
    await bus.publish(b);

    expect(seen).toEqual([a.eventId, b.eventId]);
  });

  it("a subscriber that throws is dead-lettered but does not crash the bus", async () => {
    const bus = new EventBus();
    const kitchenId: UUID = asUUID("44444444-4444-4444-8444-444444444444");

    let goodCount = 0;
    bus.subscribe(
      FOOD_DOMAIN_EVENTS.KitchenCertified,
      async () => {
        throw new Error("subscriber failure");
      },
      { maxAttempts: 1 },
    );
    bus.subscribe(FOOD_DOMAIN_EVENTS.KitchenCertified, async () => {
      goodCount += 1;
    });

    const event = buildFoodDomainEvent("KitchenCertified", kitchenId, {
      certificationId: "fda-2024-001",
      inspectorId: "inspector-7",
      expiresAt: "2025-12-31T23:59:59.000Z",
    });
    await expect(bus.publish(event)).resolves.toBeUndefined();
    // The healthy subscriber still received the event; the failing
    // one was dead-lettered (see dlq.ts).
    expect(goodCount).toBe(1);
  });

  it("preserves correlation/trace metadata from explicit meta across delivery", async () => {
    const bus = new EventBus();
    const customerId: UUID = asUUID("55555555-5555-4555-8555-555555555555");

    const received: DomainEvent[] = [];
    bus.subscribe(FOOD_DOMAIN_EVENTS.CustomerCreated, async (e) => {
      received.push(e as DomainEvent);
    });

    const correlationId = uuid();
    const traceId = uuid();
    const actorUserId = uuid();
    const organizationId = uuid();

    const event = buildFoodDomainEvent(
      "CustomerCreated",
      customerId,
      {
        displayName: "Amara Mensah",
        email: "amara@eks-food.com",
        locale: "tw",
      },
      { correlationId, traceId, actorUserId, organizationId },
    );

    await bus.publish(event);

    expect(received).toHaveLength(1);
    const got = received[0];
    if (got === undefined) {
      throw new Error("subscriber did not receive the event");
    }
    expect(got.correlationId).toBe(correlationId);
    expect(got.traceId).toBe(traceId);
    expect(got.actorUserId).toBe(actorUserId);
    expect(got.organizationId).toBe(organizationId);
  });

  it("every event in FOOD_DOMAIN_EVENTS can be built and published without error", async () => {
    const bus = new EventBus();
    const aggregateId: UUID = asUUID("66666666-6666-4666-8666-666666666666");

    const delivered: string[] = [];
    // Subscribe to every food-domain event type.
    for (const eventType of Object.values(FOOD_DOMAIN_EVENTS)) {
      bus.subscribe(eventType, async (e) => {
        delivered.push(e.eventType);
      });
    }

    const names = Object.keys(FOOD_DOMAIN_EVENTS) as readonly (keyof typeof FOOD_DOMAIN_EVENTS)[];
    for (const name of names) {
      const event = buildFoodDomainEvent(name, aggregateId, { name });
      await bus.publish(event);
    }

    // Each event was delivered exactly once.
    expect(delivered).toHaveLength(names.length);
    expect(new Set(delivered).size).toBe(names.length);
    // And the set of delivered event types matches the registry.
    expect(new Set(delivered)).toEqual(new Set(Object.values(FOOD_DOMAIN_EVENTS)));
  });

  it("delivers a RecipeVersionPublished event with a complex payload intact", async () => {
    const bus = new EventBus();
    const versionId: UUID = asUUID("77777777-7777-4777-8777-777777777777");
    const payload = {
      recipeId: asUUID("88888888-8888-4888-8888-888888888888"),
      version: 3,
      changelog: "Reduced oil by 20%; added smoked paprika",
      publishedBy: asUUID("99999999-9999-4999-8999-999999999999"),
      publishedAt: "2024-06-01T10:00:00.000Z",
      ingredients: [
        { id: "i-rice", quantity: 500, unit: "g" },
        { id: "i-tomato", quantity: 6, unit: "whole" },
        { id: "i-onion", quantity: 2, unit: "whole" },
      ],
    };
    const event = buildFoodDomainEvent("RecipeVersionPublished", versionId, payload);
    const received: DomainEvent[] = [];
    bus.subscribe(FOOD_DOMAIN_EVENTS.RecipeVersionPublished, async (e) => {
      received.push(e as DomainEvent);
    });
    await bus.publish(event);
    expect(received).toHaveLength(1);
    expect(received[0]?.aggregateType).toBe("RecipeVersion");
    expect(received[0]?.payload).toEqual(payload);
  });

  it("Food Intelligence Graph events (GraphNodeCreated, GraphEdgeCreated, RelationshipCreated, RelationshipRemoved) all flow through", async () => {
    const bus = new EventBus();
    const graphId: UUID = asUUID("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");

    const seen: string[] = [];
    bus.subscribe(FOOD_DOMAIN_EVENTS.GraphNodeCreated, async (e) => {
      seen.push(e.eventType);
    });
    bus.subscribe(FOOD_DOMAIN_EVENTS.GraphEdgeCreated, async (e) => {
      seen.push(e.eventType);
    });
    bus.subscribe(FOOD_DOMAIN_EVENTS.RelationshipCreated, async (e) => {
      seen.push(e.eventType);
    });
    bus.subscribe(FOOD_DOMAIN_EVENTS.RelationshipRemoved, async (e) => {
      seen.push(e.eventType);
    });

    await bus.publish(
      buildFoodDomainEvent("GraphNodeCreated", graphId, {
        nodeType: "Recipe",
        nodeId: asUUID("11111111-2222-4333-8444-555555555555"),
      }),
    );
    await bus.publish(
      buildFoodDomainEvent("GraphEdgeCreated", graphId, {
        edgeType: "contains",
        fromNodeId: asUUID("11111111-2222-4333-8444-555555555555"),
        toNodeId: asUUID("22222222-3333-4444-8555-666666666666"),
      }),
    );
    await bus.publish(
      buildFoodDomainEvent("RelationshipCreated", graphId, {
        type: "member_of",
        fromType: "CUSTOMER",
        fromId: asUUID("33333333-4444-4555-8666-777777777777"),
        toType: "HOUSEHOLD",
        toId: asUUID("44444444-5555-4666-8777-888888888888"),
      }),
    );
    await bus.publish(
      buildFoodDomainEvent("RelationshipRemoved", graphId, {
        type: "works_at",
        fromId: asUUID("55555555-6666-4777-8888-999999999999"),
        toId: asUUID("66666666-7777-4888-9999-aaaaaaaaaaaa"),
      }),
    );

    expect(seen.sort()).toEqual(
      [
        FOOD_DOMAIN_EVENTS.GraphNodeCreated,
        FOOD_DOMAIN_EVENTS.GraphEdgeCreated,
        FOOD_DOMAIN_EVENTS.RelationshipCreated,
        FOOD_DOMAIN_EVENTS.RelationshipRemoved,
      ].sort(),
    );
  });
});
