import { describe, expect, it } from "vitest";

/**
 * Measurement conversion — pure-logic reference implementation for the
 * FIMS measurement-conversion service. Converts between mass and volume
 * units using both flat ratios (g↔oz, kg↔lb, ml↔cup, ml↔tbsp, L↔gal)
 * and density-aware volumetric→mass conversions (e.g. 1 cup of water
 * = 240 g, 1 cup of oil = 220 g, because different ingredients have
 * different densities).
 */

/** Units the converter understands. */
export type MassUnit = "g" | "kg" | "oz" | "lb";
export type VolumeUnit = "ml" | "L" | "tsp" | "tbsp" | "cup" | "gal";
export type Unit = MassUnit | VolumeUnit;

/** A measured quantity — a magnitude plus a unit. */
export interface Quantity {
  readonly amount: number;
  readonly unit: Unit;
}

/**
 * Conversion factors expressed relative to a canonical SI base unit:
 *  - mass is canonicalised to grams
 *  - volume is canonicalised to millilitres
 *
 * Converting from `A` to `B` is therefore a two-step process:
 *   1. canonicalise A → grams (or millilitres)
 *   2. de-canonicalise grams (or millilitres) → B
 */
const TO_GRAMS: Readonly<Record<MassUnit, number>> = {
  g: 1,
  kg: 1000,
  oz: 28.3495, // 1 oz = 28.3495 g  →  1 g = 1/28.3495 = 0.0353 oz (rounded)
  lb: 453.592, // 1 lb = 453.592 g  →  1 kg = 1000/453.592 = 2.2046 lb
};

const TO_MILLILITRES: Readonly<Record<VolumeUnit, number>> = {
  ml: 1,
  L: 1000,
  tsp: 5, // 1 tsp = 5 ml
  tbsp: 15, // 1 tbsp = 15 ml
  cup: 240, // 1 cup = 240 ml (US legal cup)
  gal: 3785.41, // 1 gal = 3.785 L = 3785.41 ml
};

/** Mass-in-grams of 1 ml of a named ingredient (density g/ml). */
const DENSITY_G_PER_ML: Readonly<Record<string, number>> = {
  water: 1.0, // 1 ml water = 1 g → 1 cup (240 ml) = 240 g
  oil: 0.917, // 1 ml oil ≈ 0.917 g → 1 cup (240 ml) ≈ 220 g
  milk: 1.03, // 1 ml milk ≈ 1.03 g → 1 cup ≈ 247 g
  honey: 1.42, // 1 ml honey ≈ 1.42 g → 1 cup ≈ 341 g
  flour: 0.529, // 1 ml flour (sifted) ≈ 0.529 g → 1 cup ≈ 127 g
};

const MASS_UNITS = new Set<MassUnit>(["g", "kg", "oz", "lb"]);
const VOLUME_UNITS = new Set<VolumeUnit>(["ml", "L", "tsp", "tbsp", "cup", "gal"]);

function isMass(u: Unit): u is MassUnit {
  return MASS_UNITS.has(u as MassUnit);
}
function isVolume(u: Unit): u is VolumeUnit {
  return VOLUME_UNITS.has(u as VolumeUnit);
}

/**
 * Converts between units. Supports mass↔mass, volume↔volume, and — when
 * an `ingredient` is supplied — volume→mass and mass→volume using that
 * ingredient's density.
 */
export class MeasurementConverter {
  /** Converts `amount` of `from` unit into `to` unit. */
  convert(
    amount: number,
    from: Unit,
    to: Unit,
    ingredient?: string,
  ): number {
    if (!Number.isFinite(amount)) {
      throw new Error(`amount must be finite, got: ${amount}`);
    }
    if (amount < 0) {
      throw new Error(`amount must be >= 0, got: ${amount}`);
    }

    // Same-unit short-circuit.
    if (from === to) return amount;

    const fromIsMass = isMass(from);
    const toIsMass = isMass(to);
    const fromIsVolume = isVolume(from);
    const toIsVolume = isVolume(to);

    if (fromIsMass && toIsMass) {
      return this.round4((amount * TO_GRAMS[from]) / TO_GRAMS[to]);
    }
    if (fromIsVolume && toIsVolume) {
      return this.round4((amount * TO_MILLILITRES[from]) / TO_MILLILITRES[to]);
    }

    // Cross-domain: we need a density.
    if (!ingredient) {
      throw new Error(
        `cannot convert ${from} → ${to} without an ingredient density (pass the ingredient name)`,
      );
    }
    const density = DENSITY_G_PER_ML[ingredient];
    if (density === undefined) {
      throw new Error(
        `no density registered for ingredient "${ingredient}" (known: ${Object.keys(
          DENSITY_G_PER_ML,
        ).join(", ")})`,
      );
    }

    if (fromIsVolume && toIsMass) {
      // volume → mass: amount_in_ml * density_g_per_ml = mass_in_g, then to target unit.
      const ml = amount * TO_MILLILITRES[from as VolumeUnit];
      const grams = ml * density;
      return this.round4(grams / TO_GRAMS[to as MassUnit]);
    }
    if (fromIsMass && toIsVolume) {
      // mass → volume: grams / density = ml, then to target unit.
      const grams = amount * TO_GRAMS[from as MassUnit];
      const ml = grams / density;
      return this.round4(ml / TO_MILLILITRES[to as VolumeUnit]);
    }

    // Unreachable: every Unit is either mass or volume.
    throw new Error(`unsupported conversion ${from} → ${to}`);
  }

  /** Converts a full {@link Quantity} to a target unit. */
  convertQuantity(q: Quantity, to: Unit, ingredient?: string): Quantity {
    return { amount: this.convert(q.amount, q.unit, to, ingredient), unit: to };
  }

  /** Lists the ingredient names that have a registered density. */
  knownIngredients(): readonly string[] {
    return Object.keys(DENSITY_G_PER_ML);
  }

  /** Rounds to 4 decimal places to preserve precision for tiny factors. */
  private round4(n: number): number {
    return Math.round((n + Number.EPSILON) * 10000) / 10000;
  }
}

describe("MeasurementConverter", () => {
  const c = new MeasurementConverter();

  describe("mass conversions", () => {
    it("converts grams → ounces (1 g = 0.0353 oz)", () => {
      // 100 g → 100 / 28.3495 = 3.5274 oz (rounded to 4 dp)
      expect(c.convert(100, "g", "oz")).toBeCloseTo(3.5274, 3);
      // Sanity: 28.3495 g ≈ 1 oz
      expect(c.convert(28.3495, "g", "oz")).toBeCloseTo(1, 3);
    });

    it("converts ounces → grams (round-trip)", () => {
      const original = 100; // grams
      const oz = c.convert(original, "g", "oz");
      const back = c.convert(oz, "oz", "g");
      expect(back).toBeCloseTo(original, 2);
    });

    it("converts kilograms → pounds (1 kg = 2.2046 lb)", () => {
      // 1 kg = 1000 g → 1000 / 453.592 = 2.2046 lb
      expect(c.convert(1, "kg", "lb")).toBeCloseTo(2.2046, 3);
      // 5 kg → 11.0231 lb
      expect(c.convert(5, "kg", "lb")).toBeCloseTo(11.0231, 3);
    });

    it("converts pounds → kilograms (round-trip)", () => {
      const original = 2.5; // kg
      const lb = c.convert(original, "kg", "lb");
      const back = c.convert(lb, "lb", "kg");
      expect(back).toBeCloseTo(original, 3);
    });
  });

  describe("volume conversions", () => {
    it("converts millilitres → cups (1 cup = 240 ml)", () => {
      expect(c.convert(240, "ml", "cup")).toBeCloseTo(1, 4);
      expect(c.convert(480, "ml", "cup")).toBeCloseTo(2, 4);
      expect(c.convert(120, "ml", "cup")).toBeCloseTo(0.5, 4);
    });

    it("converts cups → millilitres (round-trip)", () => {
      const original = 360; // ml
      const cups = c.convert(original, "ml", "cup");
      const back = c.convert(cups, "cup", "ml");
      expect(back).toBeCloseTo(original, 2);
    });

    it("converts millilitres → tablespoons (1 tbsp = 15 ml)", () => {
      expect(c.convert(15, "ml", "tbsp")).toBeCloseTo(1, 4);
      expect(c.convert(45, "ml", "tbsp")).toBeCloseTo(3, 4);
      expect(c.convert(7.5, "ml", "tbsp")).toBeCloseTo(0.5, 4);
    });

    it("converts litres → gallons (1 gal = 3.785 L)", () => {
      // 1 gal = 3.785 L → 3.785 L / 3.78541 ≈ 0.9999 gal
      expect(c.convert(3.78541, "L", "gal")).toBeCloseTo(1, 2);
      // 1 L ≈ 0.2642 gal
      expect(c.convert(1, "L", "gal")).toBeCloseTo(0.2642, 3);
    });

    it("converts gallons → litres (round-trip)", () => {
      const original = 7.5; // L
      const gal = c.convert(original, "L", "gal");
      const back = c.convert(gal, "gal", "L");
      expect(back).toBeCloseTo(original, 2);
    });

    it("converts teaspoons → millilitres (1 tsp = 5 ml)", () => {
      expect(c.convert(1, "tsp", "ml")).toBeCloseTo(5, 4);
      expect(c.convert(3, "tsp", "ml")).toBeCloseTo(15, 4);
    });

    it("converts tablespoons → cups (16 tbsp = 1 cup)", () => {
      // 16 tbsp × 15 ml = 240 ml = 1 cup
      expect(c.convert(16, "tbsp", "cup")).toBeCloseTo(1, 4);
      expect(c.convert(8, "tbsp", "cup")).toBeCloseTo(0.5, 4);
    });
  });

  describe("same-unit short-circuit", () => {
    it("returns the input amount unchanged when from === to", () => {
      expect(c.convert(123.456, "g", "g")).toBe(123.456);
      expect(c.convert(99, "ml", "ml")).toBe(99);
    });
  });

  describe("cross-domain conversions (density-aware)", () => {
    it("converts 1 cup of water → 240 g (density 1.0 g/ml)", () => {
      // 1 cup = 240 ml × 1.0 g/ml = 240 g
      expect(c.convert(1, "cup", "g", "water")).toBeCloseTo(240, 2);
    });

    it("converts 1 cup of oil → ~220 g (density 0.917 g/ml)", () => {
      // 1 cup = 240 ml × 0.917 g/ml = 220.08 g ≈ 220 g
      expect(c.convert(1, "cup", "g", "oil")).toBeCloseTo(220.08, 1);
      // The spec calls out "1 cup of oil = 220 g — different ingredient densities"
      expect(c.convert(1, "cup", "g", "oil")).toBeGreaterThan(218);
      expect(c.convert(1, "cup", "g", "oil")).toBeLessThan(222);
    });

    it("water and oil produce different masses for the same volume", () => {
      const waterMass = c.convert(1, "cup", "g", "water");
      const oilMass = c.convert(1, "cup", "g", "oil");
      expect(waterMass).not.toEqual(oilMass);
      expect(waterMass).toBeGreaterThan(oilMass); // water is denser than oil
    });

    it("converts mass → volume using density (round-trip for water)", () => {
      const original = 240; // grams of water
      const cups = c.convert(original, "g", "cup", "water");
      const back = c.convert(cups, "cup", "g", "water");
      expect(back).toBeCloseTo(original, 2);
    });

    it("converts 1 cup of honey → ~341 g (density 1.42 g/ml)", () => {
      // 240 ml × 1.42 g/ml = 340.8 g
      expect(c.convert(1, "cup", "g", "honey")).toBeCloseTo(340.8, 1);
    });

    it("converts 1 cup of flour → ~127 g (density 0.529 g/ml)", () => {
      // 240 ml × 0.529 g/ml = 126.96 g
      expect(c.convert(1, "cup", "g", "flour")).toBeCloseTo(126.96, 1);
    });
  });

  describe("error handling", () => {
    it("throws on unknown cross-domain conversion without an ingredient", () => {
      expect(() => c.convert(100, "g", "ml")).toThrowError(/ingredient density/i);
      expect(() => c.convert(1, "cup", "oz")).toThrowError(/ingredient density/i);
    });

    it("throws on unknown ingredient density", () => {
      expect(() => c.convert(1, "cup", "g", "unobtainium")).toThrowError(
        /no density registered for ingredient "unobtainium"/i,
      );
    });

    it("throws on negative amounts", () => {
      expect(() => c.convert(-5, "g", "oz")).toThrowError(/amount must be >= 0/i);
    });

    it("throws on non-finite amounts", () => {
      expect(() => c.convert(Number.NaN, "g", "oz")).toThrowError(/finite/i);
      expect(() => c.convert(Number.POSITIVE_INFINITY, "g", "oz")).toThrowError(
        /finite/i,
      );
    });
  });

  describe("convertQuantity (full-quantity API)", () => {
    it("returns a Quantity with the converted amount and target unit", () => {
      const q: Quantity = { amount: 500, unit: "g" };
      const result = c.convertQuantity(q, "oz");
      expect(result.unit).toBe("oz");
      expect(result.amount).toBeCloseTo(17.637, 2); // 500 g → 17.637 oz
    });

    it("preserves the unit when from === to", () => {
      const q: Quantity = { amount: 250, unit: "ml" };
      const result = c.convertQuantity(q, "ml");
      expect(result.amount).toBe(250);
      expect(result.unit).toBe("ml");
    });
  });

  describe("knownIngredients", () => {
    it("lists the ingredients with registered densities", () => {
      const known = c.knownIngredients();
      expect(known).toContain("water");
      expect(known).toContain("oil");
      expect(known).toContain("milk");
      expect(known).toContain("honey");
      expect(known).toContain("flour");
      expect(known.length).toBeGreaterThanOrEqual(5);
    });
  });
});
