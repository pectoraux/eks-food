import { describe, expect, it } from "vitest";
import { EventBus } from "../bus";
import type { DomainEvent } from "../types";
import {
  INTEGRATION_EVENTS,
  buildIntegrationEvent,
} from "@eks/integration";
import { asUUID, uuid, type UUID } from "@eks/common";

/**
 * Integration test: a `ConnectorExecutionCompleted` event built via
 * `buildIntegrationEvent` flows through a fresh `EventBus` and reaches
 * a subscriber with the correct `eventType` and `aggregateId`. Then
 * verify the bus's idempotency guarantee: re-publishing the SAME
 * event (same `eventId`) does NOT re-deliver to the subscriber.
 *
 * Mirrors the structure of identity-events.spec.ts and
 * developer-events.spec.ts but exercises the @eks/integration event
 * registry end-to-end.
 */

describe("EventBus ↔ @eks/integration integration", () => {
  it("delivers a buildIntegrationEvent-produced event to a matching subscriber", async () => {
    const bus = new EventBus();
    const connectorId: UUID = asUUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const payload = {
      connectorName: "stripe-payment-connector",
      operation: "sync",
      durationMs: 142,
      ok: true,
    };

    const event = buildIntegrationEvent(
      "ConnectorExecutionCompleted",
      connectorId,
      payload,
    );

    // Type-level check: buildIntegrationEvent's output IS a DomainEvent.
    const _typeCheck: DomainEvent = event;
    expect(_typeCheck).toBe(event);

    const received: DomainEvent[] = [];
    bus.subscribe(INTEGRATION_EVENTS.ConnectorExecutionCompleted, async (e) => {
      received.push(e as DomainEvent);
    });

    await bus.publish(event);

    expect(received).toHaveLength(1);
    const got = received[0];
    if (got === undefined) {
      throw new Error("subscriber did not receive the event");
    }
    expect(got.eventType).toBe("ConnectorExecution.Completed");
    expect(got.aggregateId).toBe(connectorId);
    expect(got.aggregateType).toBe("ConnectorExecution");
    expect(got.tier).toBe("domain");
    expect(got.version).toBe(1);
    expect(got.payload).toEqual(payload);
    expect(got.eventId).toBe(event.eventId);
  });

  it("does not deliver to a subscriber of a different integration event type", async () => {
    const bus = new EventBus();
    const connectorId: UUID = asUUID("11111111-1111-4111-8111-111111111111");

    const completedReceived: string[] = [];
    const failedReceived: string[] = [];

    bus.subscribe(INTEGRATION_EVENTS.ConnectorExecutionCompleted, async (e) => {
      completedReceived.push(e.eventId);
    });
    bus.subscribe(INTEGRATION_EVENTS.ConnectorExecutionFailed, async (e) => {
      failedReceived.push(e.eventId);
    });

    const completed = buildIntegrationEvent(
      "ConnectorExecutionCompleted",
      connectorId,
      { ok: true },
    );
    await bus.publish(completed);

    expect(completedReceived).toEqual([completed.eventId]);
    expect(failedReceived).toEqual([]);
  });

  it("idempotent re-publish does not re-deliver (same eventId → single delivery)", async () => {
    const bus = new EventBus();
    const syncId: UUID = asUUID("22222222-2222-4222-8222-222222222222");

    let deliveryCount = 0;
    const seenEventIds: string[] = [];

    bus.subscribe(INTEGRATION_EVENTS.SynchronizationStarted, async (e) => {
      deliveryCount += 1;
      seenEventIds.push(e.eventId);
    });

    const event = buildIntegrationEvent(
      "SynchronizationStarted",
      syncId,
      { connectorName: "shopify", direction: "inbound" },
    );

    await bus.publish(event);
    expect(deliveryCount).toBe(1);

    // Re-publish the SAME event instance (same eventId) — the bus's
    // idempotency log MUST suppress the second and third deliveries.
    await bus.publish(event);
    await bus.publish(event);

    expect(deliveryCount).toBe(1);
    expect(seenEventIds).toEqual([event.eventId]);
  });

  it("two distinct integration events (different eventIds) both get delivered", async () => {
    const bus = new EventBus();
    const connectorId: UUID = asUUID("33333333-3333-4333-8333-333333333333");

    const seen: string[] = [];
    bus.subscribe(INTEGRATION_EVENTS.ConnectorUpgraded, async (e) => {
      seen.push(e.eventId);
    });

    const a = buildIntegrationEvent("ConnectorUpgraded", connectorId, {
      from: "1.0.0",
      to: "1.1.0",
    });
    const b = buildIntegrationEvent("ConnectorUpgraded", connectorId, {
      from: "1.1.0",
      to: "1.2.0",
    });

    expect(a.eventId).not.toBe(b.eventId);

    await bus.publish(a);
    await bus.publish(b);

    expect(seen).toEqual([a.eventId, b.eventId]);
  });

  it("a subscriber that throws is dead-lettered but does not crash the bus", async () => {
    const bus = new EventBus();
    const connectorId: UUID = asUUID("44444444-4444-4444-8444-444444444444");

    let goodCount = 0;
    bus.subscribe(
      INTEGRATION_EVENTS.ConnectorRemoved,
      async () => {
        throw new Error("subscriber failure");
      },
      { maxAttempts: 1 },
    );
    bus.subscribe(INTEGRATION_EVENTS.ConnectorRemoved, async () => {
      goodCount += 1;
    });

    const event = buildIntegrationEvent("ConnectorRemoved", connectorId, {
      reason: "deprecated",
    });
    await expect(bus.publish(event)).resolves.toBeUndefined();
    // The healthy subscriber still received the event; the failing
    // one was dead-lettered (see dlq.ts).
    expect(goodCount).toBe(1);
  });

  it("preserves correlation/trace metadata from explicit meta across delivery", async () => {
    const bus = new EventBus();
    const connectorId: UUID = asUUID("55555555-5555-4555-8555-555555555555");

    const received: DomainEvent[] = [];
    bus.subscribe(INTEGRATION_EVENTS.HealthCheckFailed, async (e) => {
      received.push(e as DomainEvent);
    });

    const correlationId = uuid();
    const traceId = uuid();
    const actorUserId = uuid();
    const organizationId = uuid();

    const event = buildIntegrationEvent(
      "HealthCheckFailed",
      connectorId,
      {
        connectorName: "stripe-payment-connector",
        endpoint: "/v1/health",
        error: "timeout",
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

  it("every event in INTEGRATION_EVENTS can be built and published without error", async () => {
    const bus = new EventBus();
    const aggregateId: UUID = asUUID("66666666-6666-4666-8666-666666666666");

    const delivered: string[] = [];
    // Subscribe to every integration event type.
    for (const eventType of Object.values(INTEGRATION_EVENTS)) {
      bus.subscribe(eventType, async (e) => {
        delivered.push(e.eventType);
      });
    }

    const names = Object.keys(INTEGRATION_EVENTS) as readonly (keyof typeof INTEGRATION_EVENTS)[];
    for (const name of names) {
      const event = buildIntegrationEvent(name, aggregateId, { name });
      await bus.publish(event);
    }

    // Each event was delivered exactly once.
    expect(delivered).toHaveLength(names.length);
    expect(new Set(delivered).size).toBe(names.length);
    // And the set of delivered event types matches the registry.
    expect(new Set(delivered)).toEqual(new Set(Object.values(INTEGRATION_EVENTS)));
  });
});
