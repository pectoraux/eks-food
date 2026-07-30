import { describe, expect, it } from "vitest";
import { FOOD_DOMAIN_AUDIT_ACTIONS } from "../audit-actions";

const SNAKE_CASE_RE = /^[A-Z][A-Z0-9_]*$/;

describe("FOOD_DOMAIN_AUDIT_ACTIONS", () => {
  it("contains at least 35 audit action codes", () => {
    const keys = Object.keys(FOOD_DOMAIN_AUDIT_ACTIONS);
    expect(keys.length).toBeGreaterThanOrEqual(35);
  });

  it("every code is uppercase SNAKE_CASE", () => {
    for (const [key, value] of Object.entries(FOOD_DOMAIN_AUDIT_ACTIONS)) {
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
    for (const [key, value] of Object.entries(FOOD_DOMAIN_AUDIT_ACTIONS)) {
      expect(key).toBe(value);
    }
  });

  it("has no duplicate codes", () => {
    const values = Object.values(FOOD_DOMAIN_AUDIT_ACTIONS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("has no duplicate keys (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(FOOD_DOMAIN_AUDIT_ACTIONS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers every spec-mandated food-domain audit action", () => {
    const expected = [
      "CUSTOMER_CREATED",
      "CUSTOMER_UPDATED",
      "HOUSEHOLD_CREATED",
      "HOUSEHOLD_MEMBER_ADDED",
      "COOK_PROFILE_CREATED",
      "COOK_CERTIFIED",
      "RESTAURANT_REGISTERED",
      "KITCHEN_CREATED",
      "KITCHEN_CERTIFIED",
      "INGREDIENT_ADDED",
      "INGREDIENT_UPDATED",
      "RECIPE_CREATED",
      "RECIPE_UPDATED",
      "RECIPE_VERSION_PUBLISHED",
      "MENU_ITEM_ADDED",
      "MENU_UPDATED",
      "INVENTORY_ADJUSTED",
      "INVENTORY_BATCH_RECEIVED",
      "EQUIPMENT_REGISTERED",
      "VEHICLE_REGISTERED",
      "SUPPLIER_REGISTERED",
      "VENDOR_REGISTERED",
      "CERTIFICATION_ISSUED",
      "CERTIFICATION_EXPIRED",
      "CERTIFICATION_REVOKED",
      "INSPECTION_SCHEDULED",
      "INSPECTION_COMPLETED",
      "FOOD_SAFETY_INCIDENT_REPORTED",
      "FOOD_SAFETY_INCIDENT_RESOLVED",
      "NUTRITION_PROFILE_CREATED",
      "RELATIONSHIP_CREATED",
      "RELATIONSHIP_REMOVED",
      "GRAPH_NODE_CREATED",
      "GRAPH_EDGE_CREATED",
      "ENTITY_VERSION_CREATED",
      "ENTITY_IMPORTED",
      "ENTITY_EXPORTED",
      "SEARCH_INDEXED",
      "ENTITY_DELETED",
    ] as const;
    for (const code of expected) {
      expect(FOOD_DOMAIN_AUDIT_ACTIONS).toHaveProperty(code, code);
    }
  });

  it("includes negative-outcome codes that have no corresponding mutating domain event", () => {
    // Audit captures negative outcomes that never mutate an aggregate
    // (certification expiry/revocation, food-safety incident reporting)
    // — these MUST be present so SIEM/compliance can pivot on negative
    // outcomes.
    expect(FOOD_DOMAIN_AUDIT_ACTIONS.CERTIFICATION_EXPIRED).toBe("CERTIFICATION_EXPIRED");
    expect(FOOD_DOMAIN_AUDIT_ACTIONS.CERTIFICATION_REVOKED).toBe("CERTIFICATION_REVOKED");
    expect(FOOD_DOMAIN_AUDIT_ACTIONS.FOOD_SAFETY_INCIDENT_REPORTED).toBe(
      "FOOD_SAFETY_INCIDENT_REPORTED",
    );
    expect(FOOD_DOMAIN_AUDIT_ACTIONS.ENTITY_DELETED).toBe("ENTITY_DELETED");
  });

  it("captures the full customer lifecycle (created → updated)", () => {
    const lifecycle = [
      FOOD_DOMAIN_AUDIT_ACTIONS.CUSTOMER_CREATED,
      FOOD_DOMAIN_AUDIT_ACTIONS.CUSTOMER_UPDATED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full certification lifecycle (issued → expired | revoked)", () => {
    const lifecycle = [
      FOOD_DOMAIN_AUDIT_ACTIONS.CERTIFICATION_ISSUED,
      FOOD_DOMAIN_AUDIT_ACTIONS.CERTIFICATION_EXPIRED,
      FOOD_DOMAIN_AUDIT_ACTIONS.CERTIFICATION_REVOKED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full food-safety incident lifecycle (reported → resolved)", () => {
    const lifecycle = [
      FOOD_DOMAIN_AUDIT_ACTIONS.FOOD_SAFETY_INCIDENT_REPORTED,
      FOOD_DOMAIN_AUDIT_ACTIONS.FOOD_SAFETY_INCIDENT_RESOLVED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full Food Intelligence Graph mutation surface", () => {
    const graphActions = [
      FOOD_DOMAIN_AUDIT_ACTIONS.GRAPH_NODE_CREATED,
      FOOD_DOMAIN_AUDIT_ACTIONS.GRAPH_EDGE_CREATED,
      FOOD_DOMAIN_AUDIT_ACTIONS.RELATIONSHIP_CREATED,
      FOOD_DOMAIN_AUDIT_ACTIONS.RELATIONSHIP_REMOVED,
    ];
    expect(new Set(graphActions).size).toBe(graphActions.length);
    for (const code of graphActions) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });
});
