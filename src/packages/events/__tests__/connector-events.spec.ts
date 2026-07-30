import { describe, expect, it } from "vitest";
import { EventBus } from "../bus";
import type { DomainEvent } from "../types";
import {
  CONNECTOR_EVENTS,
  buildConnectorEvent,
} from "@eks/connectors";
import { asUUID, uuid, type UUID } from "@eks/common";

/**
 * Integration test: a `RouteCalculated` event built via
 * `buildConnectorEvent` flows through a fresh `EventBus` and reaches a
 * subscriber with the correct `eventType` and `aggregateId`. Then
 * verify the bus's idempotency guarantee: re-publishing the SAME event
 * (same `eventId`) does NOT re-deliver to the subscriber.
 *
 * Mirrors the structure of `integration-events.spec.ts`,
 * `identity-events.spec.ts`, and `developer-events.spec.ts` but
 * exercises the @eks/connectors event registry end-to-end.
 */

describe("EventBus ↔ @eks/connectors integration", () => {
  it("delivers a buildConnectorEvent-produced RouteCalculated event to a matching subscriber", async () => {
    const bus = new EventBus();
    const routeId: UUID = asUUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const payload = {
      provider: "google-maps",
      distanceMeters: 8420,
      durationSeconds: 932,
      origin: "Accra",
      destination: "Kumasi",
    };

    const event = buildConnectorEvent("RouteCalculated", routeId, payload);

    // Type-level check: buildConnectorEvent's output IS a DomainEvent.
    const _typeCheck: DomainEvent = event;
    expect(_typeCheck).toBe(event);

    const received: DomainEvent[] = [];
    bus.subscribe(CONNECTOR_EVENTS.RouteCalculated, async (e) => {
      received.push(e as DomainEvent);
    });

    await bus.publish(event);

    expect(received).toHaveLength(1);
    const got = received[0];
    if (got === undefined) {
      throw new Error("subscriber did not receive the event");
    }
    expect(got.eventType).toBe("Route.Calculated");
    expect(got.aggregateId).toBe(routeId);
    expect(got.aggregateType).toBe("Route");
    expect(got.tier).toBe("domain");
    expect(got.version).toBe(1);
    expect(got.payload).toEqual(payload);
    expect(got.eventId).toBe(event.eventId);
  });

  it("does not deliver to a subscriber of a different connector event type", async () => {
    const bus = new EventBus();
    const routeId: UUID = asUUID("11111111-1111-4111-8111-111111111111");

    const routeReceived: string[] = [];
    const geocodingReceived: string[] = [];

    bus.subscribe(CONNECTOR_EVENTS.RouteCalculated, async (e) => {
      routeReceived.push(e.eventId);
    });
    bus.subscribe(CONNECTOR_EVENTS.GeocodingResolved, async (e) => {
      geocodingReceived.push(e.eventId);
    });

    const route = buildConnectorEvent("RouteCalculated", routeId, {
      provider: "google-maps",
      distanceMeters: 1000,
    });
    await bus.publish(route);

    expect(routeReceived).toEqual([route.eventId]);
    expect(geocodingReceived).toEqual([]);
  });

  it("idempotent re-publish does not re-deliver (same eventId → single delivery)", async () => {
    const bus = new EventBus();
    const routeId: UUID = asUUID("22222222-2222-4222-8222-222222222222");

    let deliveryCount = 0;
    const seenEventIds: string[] = [];

    bus.subscribe(CONNECTOR_EVENTS.RouteCalculated, async (e) => {
      deliveryCount += 1;
      seenEventIds.push(e.eventId);
    });

    const event = buildConnectorEvent("RouteCalculated", routeId, {
      provider: "mapbox",
      distanceMeters: 5400,
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

  it("two distinct connector events (different eventIds) both get delivered", async () => {
    const bus = new EventBus();
    const routeId: UUID = asUUID("33333333-3333-4333-8333-333333333333");

    const seen: string[] = [];
    bus.subscribe(CONNECTOR_EVENTS.WeatherAlertReceived, async (e) => {
      seen.push(e.eventId);
    });

    const a = buildConnectorEvent("WeatherAlertReceived", routeId, {
      severity: "warning",
      headline: "Thunderstorm watch",
    });
    const b = buildConnectorEvent("WeatherAlertReceived", routeId, {
      severity: "watch",
      headline: "Heavy rain possible",
    });

    expect(a.eventId).not.toBe(b.eventId);

    await bus.publish(a);
    await bus.publish(b);

    expect(seen).toEqual([a.eventId, b.eventId]);
  });

  it("a subscriber that throws is dead-lettered but does not crash the bus", async () => {
    const bus = new EventBus();
    const routeId: UUID = asUUID("44444444-4444-4444-8444-444444444444");

    let goodCount = 0;
    bus.subscribe(
      CONNECTOR_EVENTS.ProviderDeactivated,
      async () => {
        throw new Error("subscriber failure");
      },
      { maxAttempts: 1 },
    );
    bus.subscribe(CONNECTOR_EVENTS.ProviderDeactivated, async () => {
      goodCount += 1;
    });

    const event = buildConnectorEvent("ProviderDeactivated", routeId, {
      providerId: "twilio-sms",
      reason: "deprecated",
    });
    await expect(bus.publish(event)).resolves.toBeUndefined();
    // The healthy subscriber still received the event; the failing
    // one was dead-lettered (see dlq.ts).
    expect(goodCount).toBe(1);
  });

  it("preserves correlation/trace metadata from explicit meta across delivery", async () => {
    const bus = new EventBus();
    const routeId: UUID = asUUID("55555555-5555-4555-8555-555555555555");

    const received: DomainEvent[] = [];
    bus.subscribe(CONNECTOR_EVENTS.NotificationFailed, async (e) => {
      received.push(e as DomainEvent);
    });

    const correlationId = uuid();
    const traceId = uuid();
    const actorUserId = uuid();
    const organizationId = uuid();

    const event = buildConnectorEvent(
      "NotificationFailed",
      routeId,
      {
        channel: "sms",
        recipient: "+233500000000",
        error: "carrier rejected",
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

  it("every event in CONNECTOR_EVENTS can be built and published without error", async () => {
    const bus = new EventBus();
    const aggregateId: UUID = asUUID("66666666-6666-4666-8666-666666666666");

    const delivered: string[] = [];
    // Subscribe to every connector event type.
    for (const eventType of Object.values(CONNECTOR_EVENTS)) {
      bus.subscribe(eventType, async (e) => {
        delivered.push(e.eventType);
      });
    }

    const names = Object.keys(CONNECTOR_EVENTS) as readonly (keyof typeof CONNECTOR_EVENTS)[];
    for (const name of names) {
      const event = buildConnectorEvent(name, aggregateId, { name });
      await bus.publish(event);
    }

    // Each event was delivered exactly once.
    expect(delivered).toHaveLength(names.length);
    expect(new Set(delivered).size).toBe(names.length);
    // And the set of delivered event types matches the registry.
    expect(new Set(delivered)).toEqual(new Set(Object.values(CONNECTOR_EVENTS)));
  });

  it("delivers a CalendarSynchronized event with a complex payload intact", async () => {
    const bus = new EventBus();
    const calendarId: UUID = asUUID("77777777-7777-4777-8777-777777777777");
    const payload = {
      provider: "google-calendar",
      externalCalendarId: "amara@eks-food.com",
      eventsAdded: 3,
      eventsUpdated: 1,
      eventsDeleted: 0,
      syncWindowStart: "2024-06-01T00:00:00.000Z",
      syncWindowEnd: "2024-06-30T23:59:59.000Z",
    };
    const event = buildConnectorEvent("CalendarSynchronized", calendarId, payload);
    const received: DomainEvent[] = [];
    bus.subscribe(CONNECTOR_EVENTS.CalendarSynchronized, async (e) => {
      received.push(e as DomainEvent);
    });
    await bus.publish(event);
    expect(received).toHaveLength(1);
    expect(received[0]?.aggregateType).toBe("Calendar");
    expect(received[0]?.payload).toEqual(payload);
  });

  it("resilience events (CacheInvalidated, CircuitBreakerOpened, RateLimitTriggered) all flow through", async () => {
    const bus = new EventBus();
    const providerId: UUID = asUUID("88888888-8888-4888-8888-888888888888");

    const seen: string[] = [];
    bus.subscribe(CONNECTOR_EVENTS.CacheInvalidated, async (e) => {
      seen.push(e.eventType);
    });
    bus.subscribe(CONNECTOR_EVENTS.CircuitBreakerOpened, async (e) => {
      seen.push(e.eventType);
    });
    bus.subscribe(CONNECTOR_EVENTS.RateLimitTriggered, async (e) => {
      seen.push(e.eventType);
    });

    await bus.publish(
      buildConnectorEvent("CacheInvalidated", providerId, { keys: ["k1", "k2"] }),
    );
    await bus.publish(
      buildConnectorEvent("CircuitBreakerOpened", providerId, {
        failureCount: 5,
        threshold: 3,
      }),
    );
    await bus.publish(
      buildConnectorEvent("RateLimitTriggered", providerId, {
        provider: "google-maps",
        retryAfterMs: 1000,
      }),
    );

    expect(seen.sort()).toEqual(
      [
        CONNECTOR_EVENTS.CacheInvalidated,
        CONNECTOR_EVENTS.CircuitBreakerOpened,
        CONNECTOR_EVENTS.RateLimitTriggered,
      ].sort(),
    );
  });
});
