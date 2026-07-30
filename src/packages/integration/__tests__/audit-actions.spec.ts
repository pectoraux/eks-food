import { describe, expect, it } from "vitest";
import { INTEGRATION_AUDIT_ACTIONS } from "../audit-actions";

const SNAKE_CASE_RE = /^[A-Z][A-Z0-9_]*$/;

describe("INTEGRATION_AUDIT_ACTIONS", () => {
  it("contains at least 28 audit action codes", () => {
    const keys = Object.keys(INTEGRATION_AUDIT_ACTIONS);
    expect(keys.length).toBeGreaterThanOrEqual(28);
  });

  it("every code is uppercase SNAKE_CASE", () => {
    for (const [key, value] of Object.entries(INTEGRATION_AUDIT_ACTIONS)) {
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
    for (const [key, value] of Object.entries(INTEGRATION_AUDIT_ACTIONS)) {
      expect(key).toBe(value);
    }
  });

  it("has no duplicate codes", () => {
    const values = Object.values(INTEGRATION_AUDIT_ACTIONS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("has no duplicate keys (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(INTEGRATION_AUDIT_ACTIONS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers the canonical integration-platform audit surface", () => {
    const expected = [
      "CONNECTOR_INSTALLED",
      "CONNECTOR_ACTIVATED",
      "CONNECTOR_DEACTIVATED",
      "CONNECTOR_REMOVED",
      "CONNECTOR_UPGRADED",
      "CONNECTOR_EXECUTION_STARTED",
      "CONNECTOR_EXECUTION_COMPLETED",
      "CONNECTOR_EXECUTION_FAILED",
      "SYNC_STARTED",
      "SYNC_COMPLETED",
      "SYNC_FAILED",
      "SYNC_RESUMED",
      "SYNC_PAUSED",
      "WEBHOOK_RECEIVED",
      "WEBHOOK_DELIVERED",
      "WEBHOOK_DELIVERY_FAILED",
      "WEBHOOK_REPLAYED",
      "POLLING_EXECUTED",
      "POLLING_FAILED",
      "SCHEMA_UPDATED",
      "SCHEMA_VALIDATED",
      "MAPPING_VALIDATED",
      "TRANSFORMATION_APPLIED",
      "RETRY_TRIGGERED",
      "RETRY_EXHAUSTED",
      "RATE_LIMITED",
      "HEALTH_CHECK_FAILED",
      "CREDENTIAL_ROTATED",
      "CREDENTIAL_ACCESSED",
      "SANDBOX_VIOLATION",
    ] as const;
    for (const code of expected) {
      expect(INTEGRATION_AUDIT_ACTIONS).toHaveProperty(code, code);
    }
  });

  it("includes failure / denial / violation codes that have no corresponding domain event", () => {
    // Audit captures negative outcomes that never mutate an aggregate
    // (e.g. failed sync, failed webhook delivery, exhausted retries,
    // rate limited, failed health check, sandbox violation) — these
    // MUST be present.
    expect(INTEGRATION_AUDIT_ACTIONS.SYNC_FAILED).toBe("SYNC_FAILED");
    expect(INTEGRATION_AUDIT_ACTIONS.WEBHOOK_DELIVERY_FAILED).toBe("WEBHOOK_DELIVERY_FAILED");
    expect(INTEGRATION_AUDIT_ACTIONS.POLLING_FAILED).toBe("POLLING_FAILED");
    expect(INTEGRATION_AUDIT_ACTIONS.RETRY_EXHAUSTED).toBe("RETRY_EXHAUSTED");
    expect(INTEGRATION_AUDIT_ACTIONS.RATE_LIMITED).toBe("RATE_LIMITED");
    expect(INTEGRATION_AUDIT_ACTIONS.HEALTH_CHECK_FAILED).toBe("HEALTH_CHECK_FAILED");
    expect(INTEGRATION_AUDIT_ACTIONS.SANDBOX_VIOLATION).toBe("SANDBOX_VIOLATION");
  });

  it("captures the full connector lifecycle (install → activate → upgrade → deactivate → remove)", () => {
    const lifecycle = [
      INTEGRATION_AUDIT_ACTIONS.CONNECTOR_INSTALLED,
      INTEGRATION_AUDIT_ACTIONS.CONNECTOR_ACTIVATED,
      INTEGRATION_AUDIT_ACTIONS.CONNECTOR_UPGRADED,
      INTEGRATION_AUDIT_ACTIONS.CONNECTOR_DEACTIVATED,
      INTEGRATION_AUDIT_ACTIONS.CONNECTOR_REMOVED,
    ];
    // Every lifecycle step is a distinct code.
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full synchronization lifecycle (start → resume | pause → complete | fail)", () => {
    const lifecycle = [
      INTEGRATION_AUDIT_ACTIONS.SYNC_STARTED,
      INTEGRATION_AUDIT_ACTIONS.SYNC_RESUMED,
      INTEGRATION_AUDIT_ACTIONS.SYNC_PAUSED,
      INTEGRATION_AUDIT_ACTIONS.SYNC_COMPLETED,
      INTEGRATION_AUDIT_ACTIONS.SYNC_FAILED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the webhook delivery & replay lifecycle", () => {
    const lifecycle = [
      INTEGRATION_AUDIT_ACTIONS.WEBHOOK_RECEIVED,
      INTEGRATION_AUDIT_ACTIONS.WEBHOOK_DELIVERED,
      INTEGRATION_AUDIT_ACTIONS.WEBHOOK_DELIVERY_FAILED,
      INTEGRATION_AUDIT_ACTIONS.WEBHOOK_REPLAYED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });
});
