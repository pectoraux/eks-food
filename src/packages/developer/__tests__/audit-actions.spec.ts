import { describe, expect, it } from "vitest";
import { DEVELOPER_AUDIT_ACTIONS } from "../audit-actions";

const SNAKE_CASE_RE = /^[A-Z][A-Z0-9_]*$/;

describe("DEVELOPER_AUDIT_ACTIONS", () => {
  it("contains at least 25 audit action codes", () => {
    const keys = Object.keys(DEVELOPER_AUDIT_ACTIONS);
    expect(keys.length).toBeGreaterThanOrEqual(25);
  });

  it("every code is uppercase SNAKE_CASE", () => {
    for (const [key, value] of Object.entries(DEVELOPER_AUDIT_ACTIONS)) {
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
    for (const [key, value] of Object.entries(DEVELOPER_AUDIT_ACTIONS)) {
      expect(key).toBe(value);
    }
  });

  it("has no duplicate codes", () => {
    const values = Object.values(DEVELOPER_AUDIT_ACTIONS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("has no duplicate keys (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(DEVELOPER_AUDIT_ACTIONS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers the canonical developer-platform audit surface", () => {
    const expected = [
      "EXTENSION_INSTALLED",
      "EXTENSION_ACTIVATED",
      "EXTENSION_SUSPENDED",
      "EXTENSION_REMOVED",
      "EXTENSION_UPGRADED",
      "EXTENSION_ROLLED_BACK",
      "CONNECTOR_EXECUTED",
      "CONNECTOR_FAILED",
      "WORKFLOW_STARTED",
      "WORKFLOW_COMPLETED",
      "WORKFLOW_FAILED",
      "EVENT_REPLAYED",
      "MANIFEST_VALIDATED",
      "MANIFEST_VALIDATION_FAILED",
      "PACKAGE_PUBLISHED",
      "PACKAGE_SIGNATURE_VERIFIED",
      "SECRET_CREATED",
      "SECRET_ROTATED",
      "SECRET_ACCESSED",
      "PERMISSION_GRANTED",
      "PERMISSION_DENIED",
      "PUBLISHER_VERIFIED",
      "EXTENSION_HEALTH_CHECK",
      "EXTENSION_LOG_EMITTED",
      "SANDBOX_VIOLATION",
    ] as const;
    for (const code of expected) {
      expect(DEVELOPER_AUDIT_ACTIONS).toHaveProperty(code, code);
    }
  });

  it("includes failure / denial / violation codes that have no corresponding domain event", () => {
    // Audit captures negative outcomes that never mutate an aggregate
    // (e.g. failed connector, denied permission, sandbox violation) —
    // these MUST be present.
    expect(DEVELOPER_AUDIT_ACTIONS.CONNECTOR_FAILED).toBe("CONNECTOR_FAILED");
    expect(DEVELOPER_AUDIT_ACTIONS.MANIFEST_VALIDATION_FAILED).toBe("MANIFEST_VALIDATION_FAILED");
    expect(DEVELOPER_AUDIT_ACTIONS.PERMISSION_DENIED).toBe("PERMISSION_DENIED");
    expect(DEVELOPER_AUDIT_ACTIONS.SANDBOX_VIOLATION).toBe("SANDBOX_VIOLATION");
  });

  it("captures the full extension lifecycle (install → activate → upgrade → rollback → suspend → remove)", () => {
    const lifecycle = [
      DEVELOPER_AUDIT_ACTIONS.EXTENSION_INSTALLED,
      DEVELOPER_AUDIT_ACTIONS.EXTENSION_ACTIVATED,
      DEVELOPER_AUDIT_ACTIONS.EXTENSION_UPGRADED,
      DEVELOPER_AUDIT_ACTIONS.EXTENSION_ROLLED_BACK,
      DEVELOPER_AUDIT_ACTIONS.EXTENSION_SUSPENDED,
      DEVELOPER_AUDIT_ACTIONS.EXTENSION_REMOVED,
    ];
    // Every lifecycle step is a distinct code.
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full workflow lifecycle (start → complete | fail)", () => {
    const lifecycle = [
      DEVELOPER_AUDIT_ACTIONS.WORKFLOW_STARTED,
      DEVELOPER_AUDIT_ACTIONS.WORKFLOW_COMPLETED,
      DEVELOPER_AUDIT_ACTIONS.WORKFLOW_FAILED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });
});
