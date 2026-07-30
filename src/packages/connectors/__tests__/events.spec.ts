import { describe, expect, it } from "vitest";
import {
  CONNECTOR_EVENTS,
  buildConnectorEvent,
  type ConnectorEvent,
} from "../events";
import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, uuid, asISODate, type UUID } from "@eks/common";

/** UUID v4 shape: 8-4-4-4-12 hex digits. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO-8601 UTC shape, e.g. `2024-01-01T00:00:00.000Z`. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

describe("CONNECTOR_EVENTS registry", () => {
  it("contains at least 35 canonical events", () => {
    const keys = Object.keys(CONNECTOR_EVENTS);
    expect(keys.length).toBeGreaterThanOrEqual(35);
  });

  it("every value follows the {Aggregate}.{PastTenseVerb} convention", () => {
    for (const [key, value] of Object.entries(CONNECTOR_EVENTS)) {
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
    const values = Object.values(CONNECTOR_EVENTS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("every key is unique (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(CONNECTOR_EVENTS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers the canonical connector lifecycle events", () => {
    // Spot-check the headline events the spec called out.
    const expected: readonly ConnectorEvent[] = [
      "ProviderRegistered",
      "ProviderActivated",
      "ProviderDeactivated",
      "ProviderHealthChanged",
      "ProviderFailoverTriggered",
      "ProviderSelected",
      "SynchronizationStarted",
      "SynchronizationCompleted",
      "SynchronizationFailed",
      "CalendarSynchronized",
      "WeatherUpdated",
      "WeatherAlertReceived",
      "RouteCalculated",
      "GeocodingResolved",
      "PlaceLookupCompleted",
      "ProcurementCatalogUpdated",
      "ProcurementOrderPlaced",
      "RestaurantMenuUpdated",
      "RestaurantReservationSynced",
      "MerchantContractImported",
      "MerchantOrderCreated",
      "GovernmentVerificationCompleted",
      "GovernmentLicenseVerified",
      "NotificationSent",
      "NotificationFailed",
      "CommunicationDelivered",
      "CommunicationFailed",
      "IdentityProviderLinked",
      "IdentityProviderUnlinked",
      "CacheHit",
      "CacheMiss",
      "CacheInvalidated",
      "RateLimitTriggered",
      "CircuitBreakerOpened",
      "CircuitBreakerClosed",
      "ConnectorVersionPublished",
    ];
    for (const name of expected) {
      expect(CONNECTOR_EVENTS[name]).toBeDefined();
      expect(typeof CONNECTOR_EVENTS[name]).toBe("string");
    }
  });
});

describe("buildConnectorEvent", () => {
  const aggregateId: UUID = asUUID("11111111-1111-4111-8111-111111111111");
  const payload = {
    provider: "google-maps",
    distanceMeters: 8420,
    durationSeconds: 932,
  };

  it("produces an object that satisfies the DomainEvent contract", () => {
    const evt = buildConnectorEvent("RouteCalculated", aggregateId, payload);
    const _: DomainEvent = evt; // type-level check
    expect(_).toBe(evt);
    expect(evt.tier).toBe("domain");
    expect(evt.version).toBe(EVENT_VERSION);
    expect(evt.version).toBe(1);
  });

  it("assigns a fresh v4 uuid as eventId", () => {
    const evt = buildConnectorEvent("RouteCalculated", aggregateId, payload);
    expect(typeof evt.eventId).toBe("string");
    expect(UUID_RE.test(evt.eventId)).toBe(true);
  });

  it("assigns a fresh ISO-8601 occurredAt", () => {
    const before = Date.now();
    const evt = buildConnectorEvent("RouteCalculated", aggregateId, payload);
    const after = Date.now();
    expect(typeof evt.occurredAt).toBe("string");
    expect(ISO_RE.test(evt.occurredAt)).toBe(true);
    const ts = Date.parse(evt.occurredAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("produces a fresh correlationId when no request context is active", () => {
    const evt = buildConnectorEvent("RouteCalculated", aggregateId, payload);
    expect(UUID_RE.test(evt.correlationId)).toBe(true);
  });

  it("defaults causationId to null outside a request context", () => {
    const evt = buildConnectorEvent("RouteCalculated", aggregateId, payload);
    expect(evt.causationId).toBeNull();
  });

  it("sets aggregateType from the canonical name (everything before the dot)", () => {
    const cases: ReadonlyArray<{ name: ConnectorEvent; expectedType: string }> = [
      { name: "ProviderRegistered", expectedType: "Provider" },
      { name: "ProviderFailoverTriggered", expectedType: "Provider" },
      { name: "SynchronizationStarted", expectedType: "Synchronization" },
      { name: "SynchronizationCompleted", expectedType: "Synchronization" },
      { name: "SynchronizationFailed", expectedType: "Synchronization" },
      { name: "CalendarSynchronized", expectedType: "Calendar" },
      { name: "WeatherUpdated", expectedType: "Weather" },
      { name: "WeatherAlertReceived", expectedType: "Weather" },
      { name: "RouteCalculated", expectedType: "Route" },
      { name: "GeocodingResolved", expectedType: "Geocoding" },
      { name: "PlaceLookupCompleted", expectedType: "PlaceLookup" },
      { name: "ProcurementCatalogUpdated", expectedType: "ProcurementCatalog" },
      { name: "ProcurementOrderPlaced", expectedType: "ProcurementOrder" },
      { name: "RestaurantMenuUpdated", expectedType: "RestaurantMenu" },
      { name: "RestaurantReservationSynced", expectedType: "RestaurantReservation" },
      { name: "MerchantContractImported", expectedType: "MerchantContract" },
      { name: "MerchantOrderCreated", expectedType: "MerchantOrder" },
      { name: "GovernmentVerificationCompleted", expectedType: "GovernmentVerification" },
      { name: "GovernmentLicenseVerified", expectedType: "GovernmentLicense" },
      { name: "NotificationSent", expectedType: "Notification" },
      { name: "NotificationFailed", expectedType: "Notification" },
      { name: "CommunicationDelivered", expectedType: "Communication" },
      { name: "CommunicationFailed", expectedType: "Communication" },
      { name: "IdentityProviderLinked", expectedType: "IdentityProvider" },
      { name: "IdentityProviderUnlinked", expectedType: "IdentityProvider" },
      { name: "CacheHit", expectedType: "Cache" },
      { name: "CacheMiss", expectedType: "Cache" },
      { name: "CacheInvalidated", expectedType: "Cache" },
      { name: "RateLimitTriggered", expectedType: "RateLimit" },
      { name: "CircuitBreakerOpened", expectedType: "CircuitBreaker" },
      { name: "CircuitBreakerClosed", expectedType: "CircuitBreaker" },
      { name: "ConnectorVersionPublished", expectedType: "ConnectorVersion" },
    ];
    for (const { name, expectedType } of cases) {
      const evt = buildConnectorEvent(name, aggregateId, payload);
      expect(evt.aggregateType).toBe(expectedType);
      expect(evt.eventType).toBe(CONNECTOR_EVENTS[name]);
    }
  });

  it("carries the supplied aggregateId and payload verbatim", () => {
    const evt = buildConnectorEvent("RouteCalculated", aggregateId, payload);
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

    const evt = buildConnectorEvent("ProviderFailoverTriggered", aggregateId, payload, {
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
    const evt = buildConnectorEvent("RouteCalculated", aggregateId, payload);
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
    const a = buildConnectorEvent("RouteCalculated", aggregateId, payload);
    const b = buildConnectorEvent("RouteCalculated", aggregateId, payload);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventType).toBe(b.eventType);
    expect(a.aggregateType).toBe(b.aggregateType);
  });

  it("works for every event in the registry (exhaustive smoke)", () => {
    const names = Object.keys(CONNECTOR_EVENTS) as readonly ConnectorEvent[];
    expect(names.length).toBeGreaterThanOrEqual(35);
    for (const name of names) {
      const evt = buildConnectorEvent(name, aggregateId, { name });
      expect(evt.tier).toBe("domain");
      expect(evt.version).toBe(1);
      expect(evt.eventType).toBe(CONNECTOR_EVENTS[name]);
      expect(evt.aggregateType).toBe(CONNECTOR_EVENTS[name].split(".", 2)[0]);
      expect(evt.aggregateId).toBe(aggregateId);
      expect(evt.payload).toEqual({ name });
      expect(UUID_RE.test(evt.eventId)).toBe(true);
    }
  });

  it("two distinct connector events of the same type carry distinct eventIds", () => {
    const a = buildConnectorEvent("WeatherAlertReceived", aggregateId, {
      severity: "warning",
    });
    const b = buildConnectorEvent("WeatherAlertReceived", aggregateId, {
      severity: "watch",
    });
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventType).toBe(b.eventType);
    expect(a.aggregateId).toBe(b.aggregateId);
  });
});
