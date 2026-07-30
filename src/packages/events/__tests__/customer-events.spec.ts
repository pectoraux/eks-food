import { describe, expect, it } from "vitest";
import { EventBus } from "../bus";
import type { DomainEvent } from "../types";
import {
  CUSTOMER_EVENTS,
  buildCustomerEvent,
} from "@eks/customer";
import { asUUID, uuid, type UUID } from "@eks/common";

/**
 * Integration test: a `HouseholdCreated` event built via
 * `buildCustomerEvent` flows through a fresh `EventBus` and reaches a
 * subscriber with the correct `eventType` and `aggregateId`. Then
 * verify the bus's idempotency guarantee: re-publishing the SAME event
 * (same `eventId`) does NOT re-deliver to the subscriber.
 *
 * Mirrors the structure of identity-events.spec.ts,
 * developer-events.spec.ts, integration-events.spec.ts,
 * food-domain-events.spec.ts and connector-events.spec.ts but
 * exercises the @eks/customer event registry end-to-end.
 */

describe("EventBus ↔ @eks/customer integration", () => {
  it("delivers a buildCustomerEvent-produced HouseholdCreated event to a matching subscriber", async () => {
    const bus = new EventBus();
    const householdId: UUID = asUUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const payload = {
      name: "Mensah Household",
      headOfHousehold: "Amara Mensah",
      locale: "tw",
      householdType: "FAMILY",
    };

    const event = buildCustomerEvent("HouseholdCreated", householdId, payload);

    // Type-level check: buildCustomerEvent's output IS a DomainEvent.
    const _typeCheck: DomainEvent = event;
    expect(_typeCheck).toBe(event);

    const received: DomainEvent[] = [];
    bus.subscribe(CUSTOMER_EVENTS.HouseholdCreated, async (e) => {
      received.push(e as DomainEvent);
    });

    await bus.publish(event);

    expect(received).toHaveLength(1);
    const got = received[0];
    if (got === undefined) {
      throw new Error("subscriber did not receive the event");
    }
    expect(got.eventType).toBe("Household.Created");
    expect(got.aggregateId).toBe(householdId);
    expect(got.aggregateType).toBe("Household");
    expect(got.tier).toBe("domain");
    expect(got.version).toBe(1);
    expect(got.payload).toEqual(payload);
    expect(got.eventId).toBe(event.eventId);
  });

  it("does not deliver to a subscriber of a different customer event type", async () => {
    const bus = new EventBus();
    const householdId: UUID = asUUID("11111111-1111-4111-8111-111111111111");

    const createdReceived: string[] = [];
    const updatedReceived: string[] = [];

    bus.subscribe(CUSTOMER_EVENTS.HouseholdCreated, async (e) => {
      createdReceived.push(e.eventId);
    });
    bus.subscribe(CUSTOMER_EVENTS.HouseholdUpdated, async (e) => {
      updatedReceived.push(e.eventId);
    });

    const created = buildCustomerEvent("HouseholdCreated", householdId, {
      name: "Mensah Household",
    });
    await bus.publish(created);

    expect(createdReceived).toEqual([created.eventId]);
    expect(updatedReceived).toEqual([]);
  });

  it("idempotent re-publish does not re-deliver (same eventId → single delivery)", async () => {
    const bus = new EventBus();
    const householdId: UUID = asUUID("22222222-2222-4222-8222-222222222222");

    let deliveryCount = 0;
    const seenEventIds: string[] = [];

    bus.subscribe(CUSTOMER_EVENTS.HouseholdCreated, async (e) => {
      deliveryCount += 1;
      seenEventIds.push(e.eventId);
    });

    const event = buildCustomerEvent("HouseholdCreated", householdId, {
      name: "Owusu Household",
      locale: "en",
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

  it("two distinct customer events (different eventIds) both get delivered", async () => {
    const bus = new EventBus();
    const householdId: UUID = asUUID("33333333-3333-4333-8333-333333333333");

    const seen: string[] = [];
    bus.subscribe(CUSTOMER_EVENTS.HouseholdCreated, async (e) => {
      seen.push(e.eventId);
    });

    const a = buildCustomerEvent("HouseholdCreated", householdId, { n: 1 });
    const b = buildCustomerEvent("HouseholdCreated", householdId, { n: 2 });

    expect(a.eventId).not.toBe(b.eventId);

    await bus.publish(a);
    await bus.publish(b);

    expect(seen).toEqual([a.eventId, b.eventId]);
  });

  it("a subscriber that throws is dead-lettered but does not crash the bus", async () => {
    const bus = new EventBus();
    const householdId: UUID = asUUID("44444444-4444-4444-8444-444444444444");

    let goodCount = 0;
    bus.subscribe(
      CUSTOMER_EVENTS.HouseholdMemberAdded,
      async () => {
        throw new Error("subscriber failure");
      },
      { maxAttempts: 1 },
    );
    bus.subscribe(CUSTOMER_EVENTS.HouseholdMemberAdded, async () => {
      goodCount += 1;
    });

    const event = buildCustomerEvent("HouseholdMemberAdded", householdId, {
      userId: uuid(),
      role: "ADMIN",
    });
    await expect(bus.publish(event)).resolves.toBeUndefined();
    // The healthy subscriber still received the event; the failing
    // one was dead-lettered (see dlq.ts).
    expect(goodCount).toBe(1);
  });

  it("preserves correlation/trace metadata from explicit meta across delivery", async () => {
    const bus = new EventBus();
    const pantryId: UUID = asUUID("55555555-5555-4555-8555-555555555555");

    const received: DomainEvent[] = [];
    bus.subscribe(CUSTOMER_EVENTS.PantryItemAdded, async (e) => {
      received.push(e as DomainEvent);
    });

    const correlationId = uuid();
    const traceId = uuid();
    const actorUserId = uuid();
    const organizationId = uuid();

    const event = buildCustomerEvent(
      "PantryItemAdded",
      pantryId,
      {
        name: "Tomatoes",
        quantity: 6,
        unit: "UNIT",
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

  it("every event in CUSTOMER_EVENTS can be built and published without error", async () => {
    const bus = new EventBus();
    const aggregateId: UUID = asUUID("66666666-6666-4666-8666-666666666666");

    const delivered: string[] = [];
    // Subscribe to every customer event type.
    for (const eventType of Object.values(CUSTOMER_EVENTS)) {
      bus.subscribe(eventType, async (e) => {
        delivered.push(e.eventType);
      });
    }

    const names = Object.keys(CUSTOMER_EVENTS) as readonly (keyof typeof CUSTOMER_EVENTS)[];
    for (const name of names) {
      const event = buildCustomerEvent(name, aggregateId, { name });
      await bus.publish(event);
    }

    // Each event was delivered exactly once.
    expect(delivered).toHaveLength(names.length);
    expect(new Set(delivered).size).toBe(names.length);
    // And the set of delivered event types matches the registry.
    expect(new Set(delivered)).toEqual(new Set(Object.values(CUSTOMER_EVENTS)));
  });

  it("aggregateType is parsed correctly for the Household aggregate family", async () => {
    const bus = new EventBus();
    const householdId: UUID = asUUID("77777777-7777-4777-8777-777777777777");

    const seen: Array<{ eventType: string; aggregateType: string }> = [];
    const householdEvents: ReadonlyArray<keyof typeof CUSTOMER_EVENTS> = [
      "HouseholdCreated",
      "HouseholdUpdated",
      "HouseholdMemberAdded",
      "HouseholdMemberRemoved",
      "HouseholdRelationshipCreated",
      "HouseholdInvitationSent",
      "HouseholdInvitationAccepted",
    ];
    for (const name of householdEvents) {
      bus.subscribe(CUSTOMER_EVENTS[name], async (e) => {
        const evt = e as DomainEvent;
        seen.push({ eventType: evt.eventType, aggregateType: evt.aggregateType });
      });
    }
    for (const name of householdEvents) {
      const event = buildCustomerEvent(name, householdId, { name });
      await bus.publish(event);
    }

    expect(seen).toHaveLength(householdEvents.length);
    // All household family events carry the Household aggregateType or
    // a sub-aggregate derived from the canonical name.
    const aggregateTypes = new Set(seen.map((s) => s.aggregateType));
    expect(aggregateTypes.has("Household")).toBe(true);
    expect(aggregateTypes.has("HouseholdMember")).toBe(true);
    expect(aggregateTypes.has("HouseholdRelationship")).toBe(true);
    expect(aggregateTypes.has("HouseholdInvitation")).toBe(true);
  });
});
