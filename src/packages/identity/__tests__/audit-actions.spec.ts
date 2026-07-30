import { describe, expect, it } from "vitest";
import { IDENTITY_AUDIT_ACTIONS } from "../audit-actions";

const SNAKE_CASE_RE = /^[A-Z][A-Z0-9_]*$/;

describe("IDENTITY_AUDIT_ACTIONS", () => {
  it("contains at least 25 audit action codes", () => {
    const keys = Object.keys(IDENTITY_AUDIT_ACTIONS);
    expect(keys.length).toBeGreaterThanOrEqual(25);
  });

  it("every code is uppercase SNAKE_CASE", () => {
    for (const [key, value] of Object.entries(IDENTITY_AUDIT_ACTIONS)) {
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
    for (const [key, value] of Object.entries(IDENTITY_AUDIT_ACTIONS)) {
      expect(key).toBe(value);
    }
  });

  it("has no duplicate codes", () => {
    const values = Object.values(IDENTITY_AUDIT_ACTIONS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("has no duplicate keys (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(IDENTITY_AUDIT_ACTIONS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers the canonical identity audit surface", () => {
    // Spot-check the headline codes the spec called out.
    const expected = [
      "USER_REGISTERED",
      "USER_LOGIN",
      "USER_LOGIN_FAILED",
      "USER_LOGOUT",
      "PASSWORD_CHANGED",
      "MFA_ENABLED",
      "ROLE_ASSIGNED",
      "MEMBERSHIP_ADDED",
      "INVITATION_ACCEPTED",
      "SESSION_REVOKED",
      "ORGANIZATION_CREATED",
      "ORGANIZATION_SUSPENDED",
      "ACCOUNT_LOCKED",
    ] as const;
    for (const code of expected) {
      expect(IDENTITY_AUDIT_ACTIONS).toHaveProperty(code, code);
    }
  });

  it("includes failure / denial codes that have no corresponding domain event", () => {
    // Audit captures negative outcomes that never mutate an aggregate
    // (e.g. failed login, denied permission) — these MUST be present.
    expect(IDENTITY_AUDIT_ACTIONS.USER_LOGIN_FAILED).toBe("USER_LOGIN_FAILED");
    expect(IDENTITY_AUDIT_ACTIONS.PERMISSION_DENIED).toBe("PERMISSION_DENIED");
    expect(IDENTITY_AUDIT_ACTIONS.ACCOUNT_LOCKED).toBe("ACCOUNT_LOCKED");
  });

  it("captures the full identity lifecycle (register → login → mfa → role → suspend → delete)", () => {
    const lifecycle = [
      IDENTITY_AUDIT_ACTIONS.USER_REGISTERED,
      IDENTITY_AUDIT_ACTIONS.USER_VERIFIED,
      IDENTITY_AUDIT_ACTIONS.USER_LOGIN,
      IDENTITY_AUDIT_ACTIONS.MFA_ENABLED,
      IDENTITY_AUDIT_ACTIONS.ROLE_ASSIGNED,
      IDENTITY_AUDIT_ACTIONS.PASSWORD_CHANGED,
      IDENTITY_AUDIT_ACTIONS.ACCOUNT_LOCKED,
      IDENTITY_AUDIT_ACTIONS.ACCOUNT_SUSPENDED,
      IDENTITY_AUDIT_ACTIONS.ACCOUNT_DELETED,
    ];
    // Every lifecycle step is a distinct code.
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    // Each is a non-empty string.
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });
});
