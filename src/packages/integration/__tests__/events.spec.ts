import { describe, expect, it } from "vitest";
import {
  INTEGRATION_EVENTS,
  buildIntegrationEvent,
  type IntegrationEvent,
} from "../events";
import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, uuid, asISODate, type UUID } from "@eks/common";

/** UUID v4 shape: 8-4-4-4-12 hex digits. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO-8601 UTC shape, e.g. `2024-01-01T00:00:00.000Z`. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

describe("INTEGRATION_EVENTS registry", () => {
  it("contains at least 28 canonical events", () => {
    const keys = Object.keys(INTEGRATION_EVENTS);
    expect(keys.length).toBeGreaterThanOrEqual(28);
  });

  it("every value follows the {Aggregate}.{PastTenseVerb} convention", () => {
    for (const [key, value] of Object.entries(INTEGRATION_EVENTS)) {
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
    const values = Object.values(INTEGRATION_EVENTS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("covers the canonical integration-platform lifecycle events", () => {
    const expected: readonly IntegrationEvent[] = [
      "ConnectorInstalled",
      "ConnectorActivated",
      "ConnectorDeactivated",
      "ConnectorRemoved",
      "ConnectorUpgraded",
      "ConnectorExecutionStarted",
      "ConnectorExecutionCompleted",
      "ConnectorExecutionFailed",
      "SynchronizationStarted",
      "SynchronizationCompleted",
      "SynchronizationFailed",
      "SynchronizationResumed",
      "WebhookReceived",
      "WebhookDelivered",
      "WebhookDeliveryFailed",
      "PollingExecuted",
      "PollingFailed",
      "SchemaUpdated",
      "SchemaValidated",
      "MappingValidated",
      "TransformationApplied",
      "RetryTriggered",
      "RetryExhausted",
      "RateLimited",
      "HealthCheckPassed",
      "HealthCheckFailed",
      "CredentialRotated",
      "ScheduleTriggered",
    ];
    for (const name of expected) {
      expect(INTEGRATION_EVENTS[name]).toBeDefined();
      expect(typeof INTEGRATION_EVENTS[name]).toBe("string");
    }
  });
});

describe("buildIntegrationEvent", () => {
  const aggregateId: UUID = asUUID("11111111-1111-4111-8111-111111111111");
  const payload = {
    connectorId: "stripe-payment-connector",
    operation: "sync",
    durationMs: 142,
    ok: true,
  };

  it("produces an object that satisfies the DomainEvent contract", () => {
    const evt = buildIntegrationEvent("ConnectorExecutionCompleted", aggregateId, payload);
    const _: DomainEvent = evt; // type-level check
    expect(_).toBe(evt);
    expect(evt.tier).toBe("domain");
    expect(evt.version).toBe(EVENT_VERSION);
    expect(evt.version).toBe(1);
  });

  it("assigns a fresh v4 uuid as eventId", () => {
    const evt = buildIntegrationEvent("ConnectorExecutionCompleted", aggregateId, payload);
    expect(typeof evt.eventId).toBe("string");
    expect(UUID_RE.test(evt.eventId)).toBe(true);
  });

  it("assigns a fresh ISO-8601 occurredAt", () => {
    const before = Date.now();
    const evt = buildIntegrationEvent("ConnectorExecutionCompleted", aggregateId, payload);
    const after = Date.now();
    expect(typeof evt.occurredAt).toBe("string");
    expect(ISO_RE.test(evt.occurredAt)).toBe(true);
    const ts = Date.parse(evt.occurredAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("produces a fresh correlationId when no request context is active", () => {
    const evt = buildIntegrationEvent("ConnectorExecutionCompleted", aggregateId, payload);
    expect(UUID_RE.test(evt.correlationId)).toBe(true);
  });

  it("defaults causationId to null outside a request context", () => {
    const evt = buildIntegrationEvent("ConnectorExecutionCompleted", aggregateId, payload);
    expect(evt.causationId).toBeNull();
  });

  it("sets aggregateType from the canonical name (everything before the dot)", () => {
    const cases: ReadonlyArray<{ name: IntegrationEvent; expectedType: string }> = [
      { name: "ConnectorInstalled", expectedType: "Connector" },
      { name: "ConnectorActivated", expectedType: "Connector" },
      { name: "ConnectorDeactivated", expectedType: "Connector" },
      { name: "ConnectorRemoved", expectedType: "Connector" },
      { name: "ConnectorUpgraded", expectedType: "Connector" },
      { name: "ConnectorExecutionStarted", expectedType: "ConnectorExecution" },
      { name: "ConnectorExecutionCompleted", expectedType: "ConnectorExecution" },
      { name: "ConnectorExecutionFailed", expectedType: "ConnectorExecution" },
      { name: "SynchronizationStarted", expectedType: "Synchronization" },
      { name: "SynchronizationCompleted", expectedType: "Synchronization" },
      { name: "SynchronizationFailed", expectedType: "Synchronization" },
      { name: "SynchronizationResumed", expectedType: "Synchronization" },
      { name: "WebhookReceived", expectedType: "Webhook" },
      { name: "WebhookDelivered", expectedType: "Webhook" },
      { name: "WebhookDeliveryFailed", expectedType: "Webhook" },
      { name: "PollingExecuted", expectedType: "Polling" },
      { name: "PollingFailed", expectedType: "Polling" },
      { name: "SchemaUpdated", expectedType: "Schema" },
      { name: "SchemaValidated", expectedType: "Schema" },
      { name: "MappingValidated", expectedType: "Mapping" },
      { name: "TransformationApplied", expectedType: "Transformation" },
      { name: "RetryTriggered", expectedType: "Retry" },
      { name: "RetryExhausted", expectedType: "Retry" },
      { name: "RateLimited", expectedType: "Rate" },
      { name: "HealthCheckPassed", expectedType: "HealthCheck" },
      { name: "HealthCheckFailed", expectedType: "HealthCheck" },
      { name: "CredentialRotated", expectedType: "Credential" },
      { name: "ScheduleTriggered", expectedType: "Schedule" },
    ];
    for (const { name, expectedType } of cases) {
      const evt = buildIntegrationEvent(name, aggregateId, payload);
      expect(evt.aggregateType).toBe(expectedType);
      expect(evt.eventType).toBe(INTEGRATION_EVENTS[name]);
    }
  });

  it("carries the supplied aggregateId and payload verbatim", () => {
    const evt = buildIntegrationEvent("ConnectorExecutionCompleted", aggregateId, payload);
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

    const evt = buildIntegrationEvent(
      "SynchronizationStarted",
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
    const evt = buildIntegrationEvent("ConnectorExecutionCompleted", aggregateId, payload);
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
    const a = buildIntegrationEvent("ConnectorExecutionCompleted", aggregateId, payload);
    const b = buildIntegrationEvent("ConnectorExecutionCompleted", aggregateId, payload);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventType).toBe(b.eventType);
    expect(a.aggregateType).toBe(b.aggregateType);
  });

  it("works for every event in the registry (exhaustive smoke)", () => {
    const names = Object.keys(INTEGRATION_EVENTS) as readonly IntegrationEvent[];
    expect(names.length).toBeGreaterThanOrEqual(28);
    for (const name of names) {
      const evt = buildIntegrationEvent(name, aggregateId, { name });
      expect(evt.tier).toBe("domain");
      expect(evt.version).toBe(1);
      expect(evt.eventType).toBe(INTEGRATION_EVENTS[name]);
      expect(evt.aggregateType).toBe(INTEGRATION_EVENTS[name].split(".", 2)[0]);
      expect(evt.aggregateId).toBe(aggregateId);
      expect(evt.payload).toEqual({ name });
      expect(UUID_RE.test(evt.eventId)).toBe(true);
    }
  });
});
