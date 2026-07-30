import { describe, expect, it } from "vitest";

/**
 * RelationshipValidator — validates that a relationship of a given
 * `type` is permitted between a `from` entity type and a `to` entity
 * type, per a declarative rule table. Powers the Food Intelligence
 * Graph's edge-insertion guard rails. Implemented in-file for testing
 * the pure-logic contract before the production validator ships under
 * @eks/food-domain.
 *
 * A rule declares:
 *  - from:    source entity type
 *  - to:      target entity type
 *  - type:    the relationship type string (e.g. "member_of",
 *             "works_at", "contains")
 *  - bidirectional?: when true, the rule also permits the reversed
 *             pair (to→from with the same type).
 *  - allowSelf?: when true, a relationship where from-instance ===
 *             to-instance is allowed. Defaults to false (self-relations
 *             rejected). Useful for relationship types like "similar_to"
 *             between two recipes.
 */

export type EntityType =
  | "CUSTOMER"
  | "HOUSEHOLD"
  | "COOK"
  | "KITCHEN"
  | "RESTAURANT"
  | "RECIPE"
  | "INGREDIENT"
  | "MENU"
  | "MENU_ITEM"
  | "SUPPLIER"
  | "VENDOR"
  | "EQUIPMENT"
  | "VEHICLE"
  | "CERTIFICATION"
  | "INSPECTION";

export interface RelationshipRule {
  readonly from: EntityType;
  readonly to: EntityType;
  readonly type: string;
  readonly bidirectional?: boolean;
  readonly allowSelf?: boolean;
}

export interface Relationship {
  readonly fromId: string;
  readonly fromType: EntityType;
  readonly toId: string;
  readonly toType: EntityType;
  readonly type: string;
}

export class RelationshipValidator {
  private readonly rules: ReadonlyArray<RelationshipRule>;
  private readonly ruleIndex: Map<string, RelationshipRule>;

  constructor(rules: ReadonlyArray<RelationshipRule>) {
    this.rules = rules;
    this.ruleIndex = new Map();
    for (const r of rules) {
      this.ruleIndex.set(ruleKey(r.from, r.to, r.type), r);
    }
  }

  /** Returns true iff the relationship is permitted by the rule table. */
  isValid(rel: Relationship): boolean {
    // Self-relationship: reject unless the rule explicitly allows it.
    if (rel.fromId === rel.toId && rel.fromType === rel.toType) {
      const rule = this.lookup(rel.fromType, rel.toType, rel.type);
      if (!rule || !rule.allowSelf) {
        return false;
      }
      return true;
    }
    return this.lookup(rel.fromType, rel.toType, rel.type) !== undefined;
  }

  /** Throws if the relationship is invalid; returns true otherwise. */
  validate(rel: Relationship): true {
    if (!this.isValid(rel)) {
      throw new RelationshipValidationError(
        `invalid relationship: ${rel.fromType}(${rel.fromId}) -[${rel.type}]-> ${rel.toType}(${rel.toId})`,
      );
    }
    return true;
  }

  /** All rule keys (test helper). */
  ruleCount(): number {
    return this.rules.length;
  }

  private lookup(from: EntityType, to: EntityType, type: string): RelationshipRule | undefined {
    // Direct match first.
    const direct = this.ruleIndex.get(ruleKey(from, to, type));
    if (direct) {
      return direct;
    }
    // Then check whether any bidirectional rule covers the reversed pair.
    for (const r of this.rules) {
      if (r.bidirectional && r.type === type) {
        if (r.from === to && r.to === from) {
          return r;
        }
      }
    }
    return undefined;
  }
}

export class RelationshipValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelationshipValidationError";
  }
}

function ruleKey(from: EntityType, to: EntityType, type: string): string {
  return `${from}|${to}|${type}`;
}

// --- canonical rule table used by the tests ---

const CANONICAL_RULES: ReadonlyArray<RelationshipRule> = [
  // Customer ↔ Household
  { from: "CUSTOMER", to: "HOUSEHOLD", type: "member_of", bidirectional: false },
  { from: "HOUSEHOLD", to: "CUSTOMER", type: "has_member", bidirectional: false },

  // Cook ↔ Kitchen
  { from: "COOK", to: "KITCHEN", type: "works_at", bidirectional: false },
  { from: "KITCHEN", to: "COOK", type: "employs", bidirectional: false },

  // Cook ↔ Restaurant
  { from: "COOK", to: "RESTAURANT", type: "employed_by", bidirectional: false },

  // Recipe ↔ Ingredient
  { from: "RECIPE", to: "INGREDIENT", type: "contains", bidirectional: false },

  // Menu ↔ Menu Item
  { from: "MENU", to: "MENU_ITEM", type: "includes", bidirectional: false },

  // Menu Item ↔ Recipe
  { from: "MENU_ITEM", to: "RECIPE", type: "based_on", bidirectional: false },

  // Restaurant ↔ Kitchen
  { from: "RESTAURANT", to: "KITCHEN", type: "operates", bidirectional: false },

  // Supplier ↔ Ingredient (supplies)
  { from: "SUPPLIER", to: "INGREDIENT", type: "supplies", bidirectional: false },

  // Vendor ↔ Equipment
  { from: "VENDOR", to: "EQUIPMENT", type: "sells", bidirectional: false },

  // Vendor ↔ Vehicle
  { from: "VENDOR", to: "VEHICLE", type: "sells", bidirectional: false },

  // Certification ↔ Cook (bidirectional: a cook holds a certification)
  { from: "COOK", to: "CERTIFICATION", type: "holds", bidirectional: true },

  // Certification ↔ Kitchen
  { from: "KITCHEN", to: "CERTIFICATION", type: "holds", bidirectional: true },

  // Inspection ↔ Kitchen
  { from: "INSPECTION", to: "KITCHEN", type: "inspected", bidirectional: false },

  // Inspection ↔ Restaurant
  { from: "INSPECTION", to: "RESTAURANT", type: "inspected", bidirectional: false },

  // Recipe ↔ Recipe: similar_to is the ONLY relationship type where
  // a self-relationship (same recipe id on both ends) is explicitly
  // allowed.
  { from: "RECIPE", to: "RECIPE", type: "similar_to", bidirectional: true, allowSelf: true },

  // Recipe ↔ Recipe: derived_from (NOT a self-relationship — must be distinct recipes).
  { from: "RECIPE", to: "RECIPE", type: "derived_from", bidirectional: false },
];

function makeValidator(): RelationshipValidator {
  return new RelationshipValidator(CANONICAL_RULES);
}

describe("RelationshipValidator — valid relationships pass", () => {
  it("CUSTOMER → HOUSEHOLD with type 'member_of' is valid", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "c1",
        fromType: "CUSTOMER",
        toId: "h1",
        toType: "HOUSEHOLD",
        type: "member_of",
      }),
    ).toBe(true);
  });

  it("COOK → KITCHEN with type 'works_at' is valid", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "ck1",
        fromType: "COOK",
        toId: "k1",
        toType: "KITCHEN",
        type: "works_at",
      }),
    ).toBe(true);
  });

  it("RECIPE → INGREDIENT with type 'contains' is valid", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "r1",
        fromType: "RECIPE",
        toId: "i1",
        toType: "INGREDIENT",
        type: "contains",
      }),
    ).toBe(true);
  });

  it("MENU → MENU_ITEM with type 'includes' is valid", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "m1",
        fromType: "MENU",
        toId: "mi1",
        toType: "MENU_ITEM",
        type: "includes",
      }),
    ).toBe(true);
  });

  it("SUPPLIER → INGREDIENT with type 'supplies' is valid", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "s1",
        fromType: "SUPPLIER",
        toId: "i1",
        toType: "INGREDIENT",
        type: "supplies",
      }),
    ).toBe(true);
  });

  it("validate() returns true for a valid relationship", () => {
    const v = makeValidator();
    expect(
      v.validate({
        fromId: "c1",
        fromType: "CUSTOMER",
        toId: "h1",
        toType: "HOUSEHOLD",
        type: "member_of",
      }),
    ).toBe(true);
  });
});

describe("RelationshipValidator — invalid relationships are rejected", () => {
  it("CUSTOMER → KITCHEN with type 'member_of' is invalid (wrong target type)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "c1",
        fromType: "CUSTOMER",
        toId: "k1",
        toType: "KITCHEN",
        type: "member_of",
      }),
    ).toBe(false);
  });

  it("CUSTOMER → HOUSEHOLD with type 'works_at' is invalid (wrong type)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "c1",
        fromType: "CUSTOMER",
        toId: "h1",
        toType: "HOUSEHOLD",
        type: "works_at",
      }),
    ).toBe(false);
  });

  it("INGREDIENT → RECIPE with type 'contains' is invalid (wrong direction — not bidirectional)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "i1",
        fromType: "INGREDIENT",
        toId: "r1",
        toType: "RECIPE",
        type: "contains",
      }),
    ).toBe(false);
  });

  it("RECIPE → INGREDIENT with type 'supplies' is invalid (wrong type for that pair)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "r1",
        fromType: "RECIPE",
        toId: "i1",
        toType: "INGREDIENT",
        type: "supplies",
      }),
    ).toBe(false);
  });

  it("validate() throws RelationshipValidationError on invalid relationship", () => {
    const v = makeValidator();
    expect(() =>
      v.validate({
        fromId: "c1",
        fromType: "CUSTOMER",
        toId: "k1",
        toType: "KITCHEN",
        type: "member_of",
      }),
    ).toThrow(RelationshipValidationError);
  });
});

describe("RelationshipValidator — bidirectional relationships", () => {
  it("COOK → CERTIFICATION with type 'holds' is valid (forward)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "ck1",
        fromType: "COOK",
        toId: "cert1",
        toType: "CERTIFICATION",
        type: "holds",
      }),
    ).toBe(true);
  });

  it("CERTIFICATION → COOK with type 'holds' is valid (reverse — bidirectional)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "cert1",
        fromType: "CERTIFICATION",
        toId: "ck1",
        toType: "COOK",
        type: "holds",
      }),
    ).toBe(true);
  });

  it("KITCHEN → CERTIFICATION with type 'holds' is valid (forward)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "k1",
        fromType: "KITCHEN",
        toId: "cert1",
        toType: "CERTIFICATION",
        type: "holds",
      }),
    ).toBe(true);
  });

  it("CERTIFICATION → KITCHEN with type 'holds' is valid (reverse — bidirectional)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "cert1",
        fromType: "CERTIFICATION",
        toId: "k1",
        toType: "KITCHEN",
        type: "holds",
      }),
    ).toBe(true);
  });

  it("RECIPE → RECIPE with type 'similar_to' is valid both forward and reverse (bidirectional)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "r1",
        fromType: "RECIPE",
        toId: "r2",
        toType: "RECIPE",
        type: "similar_to",
      }),
    ).toBe(true);
    expect(
      v.isValid({
        fromId: "r2",
        fromType: "RECIPE",
        toId: "r1",
        toType: "RECIPE",
        type: "similar_to",
      }),
    ).toBe(true);
  });
});

describe("RelationshipValidator — self-relationships", () => {
  it("rejects a self-relationship when the rule does not allow self", () => {
    // derived_from is RECIPE→RECIPE but explicitly NOT allowSelf.
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "r1",
        fromType: "RECIPE",
        toId: "r1",
        toType: "RECIPE",
        type: "derived_from",
      }),
    ).toBe(false);
  });

  it("rejects a self-relationship when the same id+type pair is used with a different type that has no rule", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "r1",
        fromType: "RECIPE",
        toId: "r1",
        toType: "RECIPE",
        type: "contains",
      }),
    ).toBe(false);
  });

  it("rejects a self-relationship for non-self-capable pairs (COOK→COOK with any type)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "ck1",
        fromType: "COOK",
        toId: "ck1",
        toType: "COOK",
        type: "works_at",
      }),
    ).toBe(false);
  });

  it("allows a self-relationship when the rule explicitly allows it (RECIPE similar_to itself)", () => {
    const v = makeValidator();
    expect(
      v.isValid({
        fromId: "r1",
        fromType: "RECIPE",
        toId: "r1",
        toType: "RECIPE",
        type: "similar_to",
      }),
    ).toBe(true);
  });

  it("validate() throws on a disallowed self-relationship", () => {
    const v = makeValidator();
    expect(() =>
      v.validate({
        fromId: "r1",
        fromType: "RECIPE",
        toId: "r1",
        toType: "RECIPE",
        type: "derived_from",
      }),
    ).toThrow(RelationshipValidationError);
  });
});

describe("RelationshipValidator — rule table integrity", () => {
  it("the canonical rule table is non-empty", () => {
    const v = makeValidator();
    expect(v.ruleCount()).toBeGreaterThan(0);
  });
});
