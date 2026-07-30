import { describe, expect, it } from "vitest";
import { FIMS_AUDIT_ACTIONS } from "../audit-actions";

const SNAKE_CASE_RE = /^[A-Z][A-Z0-9_]*$/;

describe("FIMS_AUDIT_ACTIONS", () => {
  it("contains at least 35 audit action codes", () => {
    const keys = Object.keys(FIMS_AUDIT_ACTIONS);
    expect(keys.length).toBeGreaterThanOrEqual(35);
  });

  it("every code is uppercase SNAKE_CASE", () => {
    for (const [key, value] of Object.entries(FIMS_AUDIT_ACTIONS)) {
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
    for (const [key, value] of Object.entries(FIMS_AUDIT_ACTIONS)) {
      expect(key).toBe(value);
    }
  });

  it("has no duplicate codes", () => {
    const values = Object.values(FIMS_AUDIT_ACTIONS);
    const set = new Set(values);
    expect(set.size).toBe(values.length);
  });

  it("has no duplicate keys (sanity — guaranteed by object literal)", () => {
    const keys = Object.keys(FIMS_AUDIT_ACTIONS);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("covers every spec-mandated FIMS audit action", () => {
    const expected = [
      "CATALOG_ITEM_ADDED",
      "CATALOG_ITEM_UPDATED",
      "CATALOG_ITEM_PUBLISHED",
      "INGREDIENT_VARIANT_CREATED",
      "RECIPE_CREATED",
      "RECIPE_UPDATED",
      "RECIPE_PUBLISHED",
      "RECIPE_VERSION_CREATED",
      "RECIPE_SCALED",
      "RECIPE_STAGE_ADDED",
      "MENU_CREATED",
      "MENU_UPDATED",
      "MENU_PUBLISHED",
      "MENU_VERSION_CREATED",
      "MENU_ITEM_ADDED",
      "MENU_BUNDLE_CREATED",
      "NUTRITION_CALCULATED",
      "ALLERGEN_DETECTED",
      "DIETARY_CLASSIFIED",
      "INVENTORY_ADJUSTED",
      "INVENTORY_RECEIVED",
      "INVENTORY_TRANSFERRED",
      "BATCH_CREATED",
      "BATCH_EXPIRED",
      "WASTE_RECORDED",
      "STOCK_MOVEMENT_RECORDED",
      "INVENTORY_RESERVED",
      "INVENTORY_AUDIT_COMPLETED",
      "CATALOG_IMPORTED",
      "CATALOG_EXPORTED",
      "MEASUREMENT_CONVERTED",
      "TAXONOMY_UPDATED",
      "RECIPE_DELETED",
      "MENU_DELETED",
      "INVENTORY_DELETED",
    ] as const;
    for (const code of expected) {
      expect(FIMS_AUDIT_ACTIONS).toHaveProperty(code, code);
    }
  });

  it("includes negative-outcome codes that have no corresponding mutating domain event", () => {
    // Audit captures negative outcomes that never mutate an aggregate
    // (batch expiration, waste recording, inventory audit completion) —
    // these MUST be present so SIEM/compliance can pivot on negative
    // outcomes.
    expect(FIMS_AUDIT_ACTIONS.BATCH_EXPIRED).toBe("BATCH_EXPIRED");
    expect(FIMS_AUDIT_ACTIONS.WASTE_RECORDED).toBe("WASTE_RECORDED");
    expect(FIMS_AUDIT_ACTIONS.INVENTORY_AUDIT_COMPLETED).toBe(
      "INVENTORY_AUDIT_COMPLETED",
    );
    expect(FIMS_AUDIT_ACTIONS.INVENTORY_DELETED).toBe("INVENTORY_DELETED");
  });

  it("captures the full catalog lifecycle (added → updated → published)", () => {
    const lifecycle = [
      FIMS_AUDIT_ACTIONS.CATALOG_ITEM_ADDED,
      FIMS_AUDIT_ACTIONS.CATALOG_ITEM_UPDATED,
      FIMS_AUDIT_ACTIONS.CATALOG_ITEM_PUBLISHED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full recipe lifecycle (create → update → publish → version → scale → stage → delete)", () => {
    const lifecycle = [
      FIMS_AUDIT_ACTIONS.RECIPE_CREATED,
      FIMS_AUDIT_ACTIONS.RECIPE_UPDATED,
      FIMS_AUDIT_ACTIONS.RECIPE_PUBLISHED,
      FIMS_AUDIT_ACTIONS.RECIPE_VERSION_CREATED,
      FIMS_AUDIT_ACTIONS.RECIPE_SCALED,
      FIMS_AUDIT_ACTIONS.RECIPE_STAGE_ADDED,
      FIMS_AUDIT_ACTIONS.RECIPE_DELETED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full menu lifecycle (create → update → publish → version → item → bundle → delete)", () => {
    const lifecycle = [
      FIMS_AUDIT_ACTIONS.MENU_CREATED,
      FIMS_AUDIT_ACTIONS.MENU_UPDATED,
      FIMS_AUDIT_ACTIONS.MENU_PUBLISHED,
      FIMS_AUDIT_ACTIONS.MENU_VERSION_CREATED,
      FIMS_AUDIT_ACTIONS.MENU_ITEM_ADDED,
      FIMS_AUDIT_ACTIONS.MENU_BUNDLE_CREATED,
      FIMS_AUDIT_ACTIONS.MENU_DELETED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the full inventory lifecycle (adjust → receive → transfer → reserve → audit → delete)", () => {
    const lifecycle = [
      FIMS_AUDIT_ACTIONS.INVENTORY_ADJUSTED,
      FIMS_AUDIT_ACTIONS.INVENTORY_RECEIVED,
      FIMS_AUDIT_ACTIONS.INVENTORY_TRANSFERRED,
      FIMS_AUDIT_ACTIONS.INVENTORY_RESERVED,
      FIMS_AUDIT_ACTIONS.INVENTORY_AUDIT_COMPLETED,
      FIMS_AUDIT_ACTIONS.INVENTORY_DELETED,
    ];
    expect(new Set(lifecycle).size).toBe(lifecycle.length);
    for (const code of lifecycle) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("captures the food-intelligence surface (nutrition, allergens, dietary, measurement, taxonomy)", () => {
    const intelligence = [
      FIMS_AUDIT_ACTIONS.NUTRITION_CALCULATED,
      FIMS_AUDIT_ACTIONS.ALLERGEN_DETECTED,
      FIMS_AUDIT_ACTIONS.DIETARY_CLASSIFIED,
      FIMS_AUDIT_ACTIONS.MEASUREMENT_CONVERTED,
      FIMS_AUDIT_ACTIONS.TAXONOMY_UPDATED,
    ];
    expect(new Set(intelligence).size).toBe(intelligence.length);
    for (const code of intelligence) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });
});
