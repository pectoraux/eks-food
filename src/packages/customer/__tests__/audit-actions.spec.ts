import { describe, expect, it } from "vitest";
import { CUSTOMER_AUDIT_ACTIONS } from "../audit-actions";

const SNAKE_CASE_RE = /^[A-Z][A-Z0-9_]*$/;

describe("CUSTOMER_AUDIT_ACTIONS", () => {
  it("contains at least 35 audit action codes", () => {
    const keys = Object.keys(CUSTOMER_AUDIT_ACTIONS);
    expect(keys.length).toBeGreaterThanOrEqual(35);
  });

  it("every code is uppercase SNAKE_CASE", () => {
    for (const [key, value] of Object.entries(CUSTOMER_AUDIT_ACTIONS)) {
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
    for (const [key, value] of Object.entries(CUSTOMER_AUDIT_ACTIONS)) {
      expect(key).toBe(value);
    }
  });

  it("has no duplicate codes", () => {
    const values = Object.values(CUSTOMER_AUDIT_ACTIONS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("has no duplicate keys (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(CUSTOMER_AUDIT_ACTIONS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers every spec-mandated customer audit action", () => {
    const expected = [
      "HOUSEHOLD_CREATED",
      "HOUSEHOLD_UPDATED",
      "HOUSEHOLD_MEMBER_ADDED",
      "HOUSEHOLD_MEMBER_REMOVED",
      "HOUSEHOLD_RELATIONSHIP_CREATED",
      "ADDRESS_ADDED",
      "ADDRESS_VALIDATED",
      "PREFERENCE_UPDATED",
      "CUISINE_PREFERENCE_SET",
      "INGREDIENT_PREFERENCE_SET",
      "DIETARY_PROFILE_ASSIGNED",
      "ALLERGY_RECORDED",
      "NUTRITION_GOAL_SET",
      "MEAL_HISTORY_RECORDED",
      "MEAL_PLAN_CREATED",
      "MEAL_PLANNED",
      "SHOPPING_LIST_CREATED",
      "SHOPPING_LIST_ITEM_ADDED",
      "SHOPPING_LIST_COMPLETED",
      "PANTRY_UPDATED",
      "PANTRY_ITEM_ADDED",
      "PANTRY_ITEM_EXPIRED",
      "FAVORITE_ADDED",
      "FAVORITE_REMOVED",
      "REVIEW_SUBMITTED",
      "REVIEW_MODERATED",
      "RATING_SUBMITTED",
      "NOTIFICATION_PREFERENCE_UPDATED",
      "HOUSEHOLD_INVITATION_SENT",
      "HOUSEHOLD_INVITATION_ACCEPTED",
      "HOUSEHOLD_DELETED",
      "REVIEW_DELETED",
      "PANTRY_ITEM_REMOVED",
      "SHOPPING_LIST_DELETED",
      "MEAL_PLAN_DELETED",
    ] as const;
    for (const code of expected) {
      expect(CUSTOMER_AUDIT_ACTIONS).toHaveProperty(code, code);
    }
  });

  it("includes negative-outcome codes that have no corresponding mutating domain event", () => {
    // Audit captures negative outcomes that never mutate an aggregate
    // (pantry item expiration, shopping list completion, review
    // moderation) — these MUST be present so SIEM/compliance can
    // pivot on negative outcomes.
    expect(CUSTOMER_AUDIT_ACTIONS.PANTRY_ITEM_EXPIRED).toBe("PANTRY_ITEM_EXPIRED");
    expect(CUSTOMER_AUDIT_ACTIONS.SHOPPING_LIST_COMPLETED).toBe(
      "SHOPPING_LIST_COMPLETED",
    );
    expect(CUSTOMER_AUDIT_ACTIONS.REVIEW_MODERATED).toBe("REVIEW_MODERATED");
    expect(CUSTOMER_AUDIT_ACTIONS.HOUSEHOLD_DELETED).toBe("HOUSEHOLD_DELETED");
  });

  it("captures the full household lifecycle (create → update → delete + member + relationship)", () => {
    const lifecycle = [
      CUSTOMER_AUDIT_ACTIONS.HOUSEHOLD_CREATED,
      CUSTOMER_AUDIT_ACTIONS.HOUSEHOLD_UPDATED,
      CUSTOMER_AUDIT_ACTIONS.HOUSEHOLD_DELETED,
      CUSTOMER_AUDIT_ACTIONS.HOUSEHOLD_MEMBER_ADDED,
      CUSTOMER_AUDIT_ACTIONS.HOUSEHOLD_MEMBER_REMOVED,
      CUSTOMER_AUDIT_ACTIONS.HOUSEHOLD_RELATIONSHIP_CREATED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full pantry lifecycle (update → add → expire → remove)", () => {
    const lifecycle = [
      CUSTOMER_AUDIT_ACTIONS.PANTRY_UPDATED,
      CUSTOMER_AUDIT_ACTIONS.PANTRY_ITEM_ADDED,
      CUSTOMER_AUDIT_ACTIONS.PANTRY_ITEM_EXPIRED,
      CUSTOMER_AUDIT_ACTIONS.PANTRY_ITEM_REMOVED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full shopping list lifecycle (create → item add → complete → delete)", () => {
    const lifecycle = [
      CUSTOMER_AUDIT_ACTIONS.SHOPPING_LIST_CREATED,
      CUSTOMER_AUDIT_ACTIONS.SHOPPING_LIST_ITEM_ADDED,
      CUSTOMER_AUDIT_ACTIONS.SHOPPING_LIST_COMPLETED,
      CUSTOMER_AUDIT_ACTIONS.SHOPPING_LIST_DELETED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the meal-planning surface (history → plan create → meal planned → plan delete)", () => {
    const surface = [
      CUSTOMER_AUDIT_ACTIONS.MEAL_HISTORY_RECORDED,
      CUSTOMER_AUDIT_ACTIONS.MEAL_PLAN_CREATED,
      CUSTOMER_AUDIT_ACTIONS.MEAL_PLANNED,
      CUSTOMER_AUDIT_ACTIONS.MEAL_PLAN_DELETED,
    ];
    expect(new Set(surface).size).toBe(surface.length);
    for (const code of surface) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the dietary & preferences surface", () => {
    const surface = [
      CUSTOMER_AUDIT_ACTIONS.PREFERENCE_UPDATED,
      CUSTOMER_AUDIT_ACTIONS.CUISINE_PREFERENCE_SET,
      CUSTOMER_AUDIT_ACTIONS.INGREDIENT_PREFERENCE_SET,
      CUSTOMER_AUDIT_ACTIONS.DIETARY_PROFILE_ASSIGNED,
      CUSTOMER_AUDIT_ACTIONS.ALLERGY_RECORDED,
      CUSTOMER_AUDIT_ACTIONS.NUTRITION_GOAL_SET,
    ];
    expect(new Set(surface).size).toBe(surface.length);
    for (const code of surface) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the reviews & ratings surface", () => {
    const surface = [
      CUSTOMER_AUDIT_ACTIONS.REVIEW_SUBMITTED,
      CUSTOMER_AUDIT_ACTIONS.REVIEW_MODERATED,
      CUSTOMER_AUDIT_ACTIONS.REVIEW_DELETED,
      CUSTOMER_AUDIT_ACTIONS.RATING_SUBMITTED,
    ];
    expect(new Set(surface).size).toBe(surface.length);
    for (const code of surface) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });
});
