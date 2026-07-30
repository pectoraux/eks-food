import { describe, expect, it } from "vitest";
import { CONNECTOR_AUDIT_ACTIONS } from "../audit-actions";

const SNAKE_CASE_RE = /^[A-Z][A-Z0-9_]*$/;

describe("CONNECTOR_AUDIT_ACTIONS", () => {
  it("contains at least 30 audit action codes", () => {
    const keys = Object.keys(CONNECTOR_AUDIT_ACTIONS);
    expect(keys.length).toBeGreaterThanOrEqual(30);
  });

  it("every code is uppercase SNAKE_CASE", () => {
    for (const [key, value] of Object.entries(CONNECTOR_AUDIT_ACTIONS)) {
      expect(typeof value).toBe("string");
      expect(
        SNAKE_CASE_RE.test(value),
        `code "${value}" (key ${key}) must be uppercase SNAKE_CASE`,
      ).toBe(true);
      // No double underscores, no trailing/leading underscores.
      expect(value).not.toContain("__");
      expect(value.startsWith("_")).toBe(false);
      expect(value.endsWith("_")).toBe(false);
    }
  });

  it("every key equals its value (self-documenting constant)", () => {
    for (const [key, value] of Object.entries(CONNECTOR_AUDIT_ACTIONS)) {
      expect(key).toBe(value);
    }
  });

  it("has no duplicate codes", () => {
    const values = Object.values(CONNECTOR_AUDIT_ACTIONS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("has no duplicate keys (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(CONNECTOR_AUDIT_ACTIONS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers the canonical connector audit surface", () => {
    const expected = [
      "PROVIDER_REGISTERED",
      "PROVIDER_ACTIVATED",
      "PROVIDER_DEACTIVATED",
      "PROVIDER_HEALTH_CHANGED",
      "PROVIDER_FAILOVER_TRIGGERED",
      "PROVIDER_SELECTED",
      "SYNC_STARTED",
      "SYNC_COMPLETED",
      "SYNC_FAILED",
      "CALENDAR_SYNCED",
      "WEATHER_UPDATED",
      "WEATHER_ALERT_RECEIVED",
      "ROUTE_CALCULATED",
      "GEOCODING_RESOLVED",
      "PLACE_LOOKUP_COMPLETED",
      "PROCUREMENT_CATALOG_UPDATED",
      "PROCUREMENT_ORDER_PLACED",
      "RESTAURANT_MENU_UPDATED",
      "RESTAURANT_RESERVATION_SYNCED",
      "MERCHANT_CONTRACT_IMPORTED",
      "MERCHANT_ORDER_CREATED",
      "GOVERNMENT_VERIFICATION_COMPLETED",
      "GOVERNMENT_LICENSE_VERIFIED",
      "NOTIFICATION_SENT",
      "NOTIFICATION_FAILED",
      "COMMUNICATION_DELIVERED",
      "COMMUNICATION_FAILED",
      "IDENTITY_PROVIDER_LINKED",
      "IDENTITY_PROVIDER_UNLINKED",
      "CACHE_INVALIDATED",
      "RATE_LIMIT_TRIGGERED",
      "CREDENTIAL_ACCESSED",
      "CREDENTIAL_ROTATED",
      "CIRCUIT_BREAKER_OPENED",
      "CONNECTOR_VERSION_PUBLISHED",
    ] as const;
    for (const code of expected) {
      expect(CONNECTOR_AUDIT_ACTIONS).toHaveProperty(code, code);
    }
  });

  it("includes failure / negative-outcome codes that have no corresponding mutating domain event", () => {
    // Audit captures negative outcomes that never mutate an aggregate
    // (e.g. failed sync, failed notification, failed communication,
    // rate-limit triggered, circuit breaker opened) — these MUST be
    // present so SIEM/compliance can pivot on negative outcomes.
    expect(CONNECTOR_AUDIT_ACTIONS.SYNC_FAILED).toBe("SYNC_FAILED");
    expect(CONNECTOR_AUDIT_ACTIONS.NOTIFICATION_FAILED).toBe("NOTIFICATION_FAILED");
    expect(CONNECTOR_AUDIT_ACTIONS.COMMUNICATION_FAILED).toBe("COMMUNICATION_FAILED");
    expect(CONNECTOR_AUDIT_ACTIONS.RATE_LIMIT_TRIGGERED).toBe("RATE_LIMIT_TRIGGERED");
    expect(CONNECTOR_AUDIT_ACTIONS.CIRCUIT_BREAKER_OPENED).toBe("CIRCUIT_BREAKER_OPENED");
  });

  it("captures the full provider lifecycle (register → activate → health → failover → deactivate)", () => {
    const lifecycle = [
      CONNECTOR_AUDIT_ACTIONS.PROVIDER_REGISTERED,
      CONNECTOR_AUDIT_ACTIONS.PROVIDER_ACTIVATED,
      CONNECTOR_AUDIT_ACTIONS.PROVIDER_HEALTH_CHANGED,
      CONNECTOR_AUDIT_ACTIONS.PROVIDER_FAILOVER_TRIGGERED,
      CONNECTOR_AUDIT_ACTIONS.PROVIDER_DEACTIVATED,
    ];
    // Every lifecycle step is a distinct code.
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full synchronization lifecycle (start → complete | fail)", () => {
    const lifecycle = [
      CONNECTOR_AUDIT_ACTIONS.SYNC_STARTED,
      CONNECTOR_AUDIT_ACTIONS.SYNC_COMPLETED,
      CONNECTOR_AUDIT_ACTIONS.SYNC_FAILED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the credential lifecycle (accessed → rotated)", () => {
    const credentialActions = [
      CONNECTOR_AUDIT_ACTIONS.CREDENTIAL_ACCESSED,
      CONNECTOR_AUDIT_ACTIONS.CREDENTIAL_ROTATED,
    ];
    expect(new Set(credentialActions).size).toBe(credentialActions.length);
    for (const code of credentialActions) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });
});
