import { describe, expect, it } from "vitest";
import { EventBus } from "../bus";
import type { DomainEvent } from "../types";
import {
  DEVELOPER_EVENTS,
  buildDeveloperEvent,
} from "@eks/developer";
import { asUUID, uuid, type UUID } from "@eks/common";

/**
 * Integration test: a `ConnectorExecuted` event built via
 * `buildDeveloperEvent` flows through a fresh `EventBus` and reaches a
 * subscriber with the correct `eventType` and `aggregateId`. Then
 * verify the bus's idempotency guarantee: re-publishing the SAME event
 * (same `eventId`) does NOT re-deliver to the subscriber.
 *
 * Mirrors the structure of `identity-events.spec.ts` but exercises the
 * @eks/developer event registry end-to-end.
 */

describe("EventBus ↔ @eks/developer integration", () => {
  it("delivers a buildDeveloperEvent-produced event to a matching subscriber", async () => {
    const bus = new EventBus();
    const connectorId: UUID = asUUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const payload = {
      connectorName: "stripe-payment-connector",
      operation: "createPaymentIntent",
      durationMs: 142,
      ok: true,
    };

    const event = buildDeveloperEvent("ConnectorExecuted", connectorId, payload);

    // Type-level check: buildDeveloperEvent's output IS a DomainEvent.
    const _typeCheck: DomainEvent = event;
    expect(_typeCheck).toBe(event);

    const received: DomainEvent[] = [];
    bus.subscribe(DEVELOPER_EVENTS.ConnectorExecuted, async (e) => {
      received.push(e as DomainEvent);
    });

    await bus.publish(event);

    expect(received).toHaveLength(1);
    const got = received[0];
    if (got === undefined) {
      throw new Error("subscriber did not receive the event");
    }
    expect(got.eventType).toBe("Connector.Executed");
    expect(got.aggregateId).toBe(connectorId);
    expect(got.aggregateType).toBe("Connector");
    expect(got.tier).toBe("domain");
    expect(got.version).toBe(1);
    expect(got.payload).toEqual(payload);
    expect(got.eventId).toBe(event.eventId);
  });

  it("does not deliver to a subscriber of a different developer event type", async () => {
    const bus = new EventBus();
    const extensionId: UUID = asUUID("11111111-1111-4111-8111-111111111111");

    const installedReceived: string[] = [];
    const activatedReceived: string[] = [];

    bus.subscribe(DEVELOPER_EVENTS.ExtensionInstalled, async (e) => {
      installedReceived.push(e.eventId);
    });
    bus.subscribe(DEVELOPER_EVENTS.ExtensionActivated, async (e) => {
      activatedReceived.push(e.eventId);
    });

    const installed = buildDeveloperEvent("ExtensionInstalled", extensionId, {
      version: "1.0.0",
    });
    await bus.publish(installed);

    expect(installedReceived).toEqual([installed.eventId]);
    expect(activatedReceived).toEqual([]);
  });

  it("idempotent re-publish does not re-deliver (same eventId → single delivery)", async () => {
    const bus = new EventBus();
    const workflowId: UUID = asUUID("22222222-2222-4222-8222-222222222222");

    let deliveryCount = 0;
    const seenEventIds: string[] = [];

    bus.subscribe(DEVELOPER_EVENTS.WorkflowStarted, async (e) => {
      deliveryCount += 1;
      seenEventIds.push(e.eventId);
    });

    const event = buildDeveloperEvent("WorkflowStarted", workflowId, {
      workflowName: "onboard-cook",
      trigger: "manual",
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

  it("two distinct developer events (different eventIds) both get delivered", async () => {
    const bus = new EventBus();
    const extensionId: UUID = asUUID("33333333-3333-4333-8333-333333333333");

    const seen: string[] = [];
    bus.subscribe(DEVELOPER_EVENTS.ExtensionUpgraded, async (e) => {
      seen.push(e.eventId);
    });

    const a = buildDeveloperEvent("ExtensionUpgraded", extensionId, {
      from: "1.0.0",
      to: "1.1.0",
    });
    const b = buildDeveloperEvent("ExtensionUpgraded", extensionId, {
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
    const extensionId: UUID = asUUID("44444444-4444-4444-8444-444444444444");

    let goodCount = 0;
    bus.subscribe(
      DEVELOPER_EVENTS.ExtensionRemoved,
      async () => {
        throw new Error("subscriber failure");
      },
      { maxAttempts: 1 },
    );
    bus.subscribe(DEVELOPER_EVENTS.ExtensionRemoved, async () => {
      goodCount += 1;
    });

    const event = buildDeveloperEvent("ExtensionRemoved", extensionId, {
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
    bus.subscribe(DEVELOPER_EVENTS.ConnectorFailed, async (e) => {
      received.push(e as DomainEvent);
    });

    const correlationId = uuid();
    const traceId = uuid();
    const actorUserId = uuid();
    const organizationId = uuid();

    const event = buildDeveloperEvent(
      "ConnectorFailed",
      connectorId,
      {
        connectorName: "stripe-payment-connector",
        operation: "createPaymentIntent",
        error: "rate limited",
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

  it("every event in DEVELOPER_EVENTS can be built and published without error", async () => {
    const bus = new EventBus();
    const aggregateId: UUID = asUUID("66666666-6666-4666-8666-666666666666");

    const delivered: string[] = [];
    // Subscribe to every developer event type.
    for (const eventType of Object.values(DEVELOPER_EVENTS)) {
      bus.subscribe(eventType, async (e) => {
        delivered.push(e.eventType);
      });
    }

    const names = Object.keys(DEVELOPER_EVENTS) as readonly (keyof typeof DEVELOPER_EVENTS)[];
    for (const name of names) {
      const event = buildDeveloperEvent(name, aggregateId, { name });
      await bus.publish(event);
    }

    // Each event was delivered exactly once.
    expect(delivered).toHaveLength(names.length);
    expect(new Set(delivered).size).toBe(names.length);
    // And the set of delivered event types matches the registry.
    expect(new Set(delivered)).toEqual(new Set(Object.values(DEVELOPER_EVENTS)));
  });
});
