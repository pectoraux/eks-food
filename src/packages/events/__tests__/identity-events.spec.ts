import { describe, expect, it } from "vitest";
import { EventBus } from "../bus";
import type { DomainEvent } from "../types";
import {
  IDENTITY_EVENTS,
  buildIdentityEvent,
} from "@eks/identity";
import { asUUID, uuid, type UUID } from "@eks/common";

/**
 * Integration test: a `UserRegistered` event built via
 * `buildIdentityEvent` flows through a fresh `EventBus` and reaches a
 * subscriber with the correct `eventType` and `aggregateId`. Then
 * verify the bus's idempotency guarantee: re-publishing the SAME event
 * (same `eventId`) does NOT re-deliver to the subscriber.
 */

describe("EventBus ↔ @eks/identity integration", () => {
  it("delivers a buildIdentityEvent-produced event to a matching subscriber", async () => {
    const bus = new EventBus();
    const userId: UUID = asUUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const payload = {
      email: "amara@example.com",
      displayName: "Amara Mensah",
      tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };

    const event = buildIdentityEvent("UserRegistered", userId, payload);

    // Type-level check: buildIdentityEvent's output IS a DomainEvent.
    const _typeCheck: DomainEvent = event;
    expect(_typeCheck).toBe(event);

    const received: DomainEvent[] = [];
    bus.subscribe(IDENTITY_EVENTS.UserRegistered, async (e) => {
      received.push(e as DomainEvent);
    });

    await bus.publish(event);

    expect(received).toHaveLength(1);
    const got = received[0];
    if (got === undefined) {
      throw new Error("subscriber did not receive the event");
    }
    expect(got.eventType).toBe("User.Registered");
    expect(got.aggregateId).toBe(userId);
    expect(got.aggregateType).toBe("User");
    expect(got.tier).toBe("domain");
    expect(got.version).toBe(1);
    expect(got.payload).toEqual(payload);
    expect(got.eventId).toBe(event.eventId);
  });

  it("does not deliver to a subscriber of a different identity event type", async () => {
    const bus = new EventBus();
    const userId: UUID = asUUID("11111111-1111-4111-8111-111111111111");

    const registeredReceived: string[] = [];
    const loggedInReceived: string[] = [];

    bus.subscribe(IDENTITY_EVENTS.UserRegistered, async (e) => {
      registeredReceived.push(e.eventId);
    });
    bus.subscribe(IDENTITY_EVENTS.UserLoggedIn, async (e) => {
      loggedInReceived.push(e.eventId);
    });

    const reg = buildIdentityEvent("UserRegistered", userId, { email: "a@b.co" });
    await bus.publish(reg);

    expect(registeredReceived).toEqual([reg.eventId]);
    expect(loggedInReceived).toEqual([]);
  });

  it("idempotent re-publish does not re-deliver (same eventId → single delivery)", async () => {
    const bus = new EventBus();
    const userId: UUID = asUUID("22222222-2222-4222-8222-222222222222");

    let deliveryCount = 0;
    const seenEventIds: string[] = [];

    bus.subscribe(IDENTITY_EVENTS.UserRegistered, async (e) => {
      deliveryCount += 1;
      seenEventIds.push(e.eventId);
    });

    const event = buildIdentityEvent("UserRegistered", userId, {
      email: "kwame@example.com",
    });

    await bus.publish(event);
    expect(deliveryCount).toBe(1);

    // Re-publish the SAME event instance (same eventId) — the bus's
    // idempotency log MUST suppress the second delivery.
    await bus.publish(event);
    await bus.publish(event);

    expect(deliveryCount).toBe(1);
    expect(seenEventIds).toEqual([event.eventId]);
  });

  it("two distinct identity events (different eventIds) both get delivered", async () => {
    const bus = new EventBus();
    const userId: UUID = asUUID("33333333-3333-4333-8333-333333333333");

    const seen: string[] = [];
    bus.subscribe(IDENTITY_EVENTS.UserRegistered, async (e) => {
      seen.push(e.eventId);
    });

    const a = buildIdentityEvent("UserRegistered", userId, { n: 1 });
    const b = buildIdentityEvent("UserRegistered", userId, { n: 2 });

    expect(a.eventId).not.toBe(b.eventId);

    await bus.publish(a);
    await bus.publish(b);

    expect(seen).toEqual([a.eventId, b.eventId]);
  });

  it("a subscriber that throws is dead-lettered but does not crash the bus", async () => {
    const bus = new EventBus();
    const userId: UUID = asUUID("44444444-4444-4444-8444-444444444444");

    let goodCount = 0;
    bus.subscribe(IDENTITY_EVENTS.UserVerified, async () => {
      throw new Error("subscriber failure");
    }, { maxAttempts: 1 });
    bus.subscribe(IDENTITY_EVENTS.UserVerified, async () => {
      goodCount += 1;
    });

    const event = buildIdentityEvent("UserVerified", userId, { at: "now" });
    await expect(bus.publish(event)).resolves.toBeUndefined();
    // The healthy subscriber still received the event; the failing
    // one was dead-lettered (see dlq.ts).
    expect(goodCount).toBe(1);
  });

  it("preserves correlation/trace metadata from the request context across delivery", async () => {
    const bus = new EventBus();
    const userId: UUID = asUUID("55555555-5555-4555-8555-555555555555");

    const received: DomainEvent[] = [];
    bus.subscribe(IDENTITY_EVENTS.RoleAssigned, async (e) => {
      received.push(e as DomainEvent);
    });

    const correlationId = uuid();
    const traceId = uuid();
    const actorUserId = uuid();
    const organizationId = uuid();

    const event = buildIdentityEvent("RoleAssigned", userId, {
      roleId: "role-admin",
      grantedBy: "system",
    }, { correlationId, traceId, actorUserId, organizationId });

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

  it("every event in IDENTITY_EVENTS can be built and published without error", async () => {
    const bus = new EventBus();
    const aggregateId: UUID = asUUID("66666666-6666-4666-8666-666666666666");

    const delivered: string[] = [];
    // Subscribe to every identity event type.
    for (const eventType of Object.values(IDENTITY_EVENTS)) {
      bus.subscribe(eventType, async (e) => {
        delivered.push(e.eventType);
      });
    }

    const names = Object.keys(IDENTITY_EVENTS) as readonly (keyof typeof IDENTITY_EVENTS)[];
    for (const name of names) {
      const event = buildIdentityEvent(name, aggregateId, { name });
      await bus.publish(event);
    }

    // Each event was delivered exactly once.
    expect(delivered).toHaveLength(names.length);
    expect(new Set(delivered).size).toBe(names.length);
    // And the set of delivered event types matches the registry.
    expect(new Set(delivered)).toEqual(new Set(Object.values(IDENTITY_EVENTS)));
  });
});
