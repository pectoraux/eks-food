import { describe, expect, it } from "vitest";
import {
  DEVELOPER_EVENTS,
  buildDeveloperEvent,
  type DeveloperEvent,
} from "../events";
import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, uuid, asISODate, type UUID } from "@eks/common";

/** UUID v4 shape: 8-4-4-4-12 hex digits. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO-8601 UTC shape, e.g. `2024-01-01T00:00:00.000Z`. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

describe("DEVELOPER_EVENTS registry", () => {
  it("contains at least 19 canonical events", () => {
    const keys = Object.keys(DEVELOPER_EVENTS);
    expect(keys.length).toBeGreaterThanOrEqual(19);
  });

  it("every value follows the {Aggregate}.{PastTenseVerb} convention", () => {
    for (const [key, value] of Object.entries(DEVELOPER_EVENTS)) {
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
    const values = Object.values(DEVELOPER_EVENTS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("covers the canonical developer-platform lifecycle events", () => {
    const expected: readonly DeveloperEvent[] = [
      "ExtensionInstalled",
      "ExtensionActivated",
      "ExtensionSuspended",
      "ExtensionRemoved",
      "ExtensionUpgraded",
      "ExtensionRolledBack",
      "ConnectorExecuted",
      "ConnectorFailed",
      "WorkflowStarted",
      "WorkflowCompleted",
      "WorkflowFailed",
      "EventReplayed",
      "ManifestValidated",
      "ManifestValidationFailed",
      "PackagePublished",
      "PackageSignatureVerified",
      "SecretRotated",
      "ExtensionHealthChanged",
      "ExtensionLogEmitted",
    ];
    for (const name of expected) {
      expect(DEVELOPER_EVENTS[name]).toBeDefined();
      expect(typeof DEVELOPER_EVENTS[name]).toBe("string");
    }
  });
});

describe("buildDeveloperEvent", () => {
  const aggregateId: UUID = asUUID("11111111-1111-4111-8111-111111111111");
  const payload = {
    extensionId: "ext-payment-retry",
    version: "1.0.0",
    publisherId: "22222222-2222-4222-8222-222222222222",
  };

  it("produces an object that satisfies the DomainEvent contract", () => {
    const evt = buildDeveloperEvent("ExtensionInstalled", aggregateId, payload);
    const _: DomainEvent = evt; // type-level check
    expect(_).toBe(evt);
    expect(evt.tier).toBe("domain");
    expect(evt.version).toBe(EVENT_VERSION);
    expect(evt.version).toBe(1);
  });

  it("assigns a fresh v4 uuid as eventId", () => {
    const evt = buildDeveloperEvent("ExtensionInstalled", aggregateId, payload);
    expect(typeof evt.eventId).toBe("string");
    expect(UUID_RE.test(evt.eventId)).toBe(true);
  });

  it("assigns a fresh ISO-8601 occurredAt", () => {
    const before = Date.now();
    const evt = buildDeveloperEvent("ExtensionInstalled", aggregateId, payload);
    const after = Date.now();
    expect(typeof evt.occurredAt).toBe("string");
    expect(ISO_RE.test(evt.occurredAt)).toBe(true);
    const ts = Date.parse(evt.occurredAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("produces a fresh correlationId when no request context is active", () => {
    const evt = buildDeveloperEvent("ExtensionInstalled", aggregateId, payload);
    expect(UUID_RE.test(evt.correlationId)).toBe(true);
  });

  it("defaults causationId to null outside a request context", () => {
    const evt = buildDeveloperEvent("ExtensionInstalled", aggregateId, payload);
    expect(evt.causationId).toBeNull();
  });

  it("sets aggregateType from the canonical name (everything before the dot)", () => {
    const cases: ReadonlyArray<{ name: DeveloperEvent; expectedType: string }> = [
      { name: "ExtensionInstalled", expectedType: "Extension" },
      { name: "ExtensionRolledBack", expectedType: "Extension" },
      { name: "ExtensionHealthChanged", expectedType: "Extension" },
      { name: "ConnectorExecuted", expectedType: "Connector" },
      { name: "ConnectorFailed", expectedType: "Connector" },
      { name: "WorkflowStarted", expectedType: "Workflow" },
      { name: "WorkflowCompleted", expectedType: "Workflow" },
      { name: "WorkflowFailed", expectedType: "Workflow" },
      { name: "EventReplayed", expectedType: "Event" },
      { name: "ManifestValidated", expectedType: "Manifest" },
      { name: "ManifestValidationFailed", expectedType: "Manifest" },
      { name: "PackagePublished", expectedType: "Package" },
      { name: "PackageSignatureVerified", expectedType: "Package" },
      { name: "SecretRotated", expectedType: "Secret" },
    ];
    for (const { name, expectedType } of cases) {
      const evt = buildDeveloperEvent(name, aggregateId, payload);
      expect(evt.aggregateType).toBe(expectedType);
      expect(evt.eventType).toBe(DEVELOPER_EVENTS[name]);
    }
  });

  it("carries the supplied aggregateId and payload verbatim", () => {
    const evt = buildDeveloperEvent("ConnectorExecuted", aggregateId, payload);
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

    const evt = buildDeveloperEvent("WorkflowStarted", aggregateId, payload, {
      eventId,
      occurredAt,
      correlationId,
      causationId,
      traceId,
      actorUserId,
      organizationId,
    });

    expect(evt.eventId).toBe(eventId);
    expect(evt.occurredAt).toBe(occurredAt);
    expect(evt.correlationId).toBe(correlationId);
    expect(evt.causationId).toBe(causationId);
    expect(evt.traceId).toBe(traceId);
    expect(evt.actorUserId).toBe(actorUserId);
    expect(evt.organizationId).toBe(organizationId);
  });

  it("the envelope has exactly the DomainEvent-required fields, no extras", () => {
    const evt = buildDeveloperEvent("ExtensionInstalled", aggregateId, payload);
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
    const a = buildDeveloperEvent("ExtensionInstalled", aggregateId, payload);
    const b = buildDeveloperEvent("ExtensionInstalled", aggregateId, payload);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventType).toBe(b.eventType);
    expect(a.aggregateType).toBe(b.aggregateType);
  });

  it("works for every event in the registry (exhaustive smoke)", () => {
    const names = Object.keys(DEVELOPER_EVENTS) as readonly DeveloperEvent[];
    expect(names.length).toBeGreaterThanOrEqual(19);
    for (const name of names) {
      const evt = buildDeveloperEvent(name, aggregateId, { name });
      expect(evt.tier).toBe("domain");
      expect(evt.version).toBe(1);
      expect(evt.eventType).toBe(DEVELOPER_EVENTS[name]);
      expect(evt.aggregateType).toBe(DEVELOPER_EVENTS[name].split(".", 2)[0]);
      expect(evt.aggregateId).toBe(aggregateId);
      expect(evt.payload).toEqual({ name });
      expect(UUID_RE.test(evt.eventId)).toBe(true);
    }
  });
});
