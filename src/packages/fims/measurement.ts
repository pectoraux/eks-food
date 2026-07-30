/**
 * Measurement Engine — canonical measurement system with density-aware conversions.
 *
 * Supports metric, imperial, volume, weight, count. Density-aware conversions
 * (1 cup water = 240g, 1 cup oil = 220g). Ingredient-specific conversions.
 * Localized units.
 */

export interface ConversionResult {
  readonly value: number;
  readonly unit: string;
  readonly converted: boolean;
  readonly densityAware: boolean;
}

// Base conversion factors (to base unit: WEIGHT→g, VOLUME→ml, COUNT→piece)
const FACTORS: Record<string, { type: string; base: string; factor: number }> = {
  g: { type: "WEIGHT", base: "g", factor: 1 },
  kg: { type: "WEIGHT", base: "g", factor: 1000 },
  oz: { type: "WEIGHT", base: "g", factor: 28.3495 },
  lb: { type: "WEIGHT", base: "g", factor: 453.592 },
  ml: { type: "VOLUME", base: "ml", factor: 1 },
  L: { type: "VOLUME", base: "ml", factor: 1000 },
  cup: { type: "VOLUME", base: "ml", factor: 240 },
  tbsp: { type: "VOLUME", base: "ml", factor: 15 },
  tsp: { type: "VOLUME", base: "ml", factor: 5 },
  gal: { type: "VOLUME", base: "ml", factor: 3785.41 },
  piece: { type: "COUNT", base: "piece", factor: 1 },
  dozen: { type: "COUNT", base: "piece", factor: 12 },
};

// Default densities (g per ml) for common ingredients
const DENSITIES: Record<string, number> = {
  water: 1.0,
  oil: 0.92,
  milk: 1.03,
  flour: 0.52,
  sugar: 0.85,
  rice: 0.78,
  salt: 1.2,
  honey: 1.42,
};

export class MeasurementConverter {
  /** Convert a value from one unit to another. */
  convert(value: number, fromUnit: string, toUnit: string, ingredient?: string): ConversionResult {
    if (fromUnit === toUnit) return { value, unit: toUnit, converted: false, densityAware: false };

    const from = FACTORS[fromUnit];
    const to = FACTORS[toUnit];
    if (!from || !to) throw new Error(`Unknown unit: ${!from ? fromUnit : toUnit}`);

    // Same type: direct conversion via base unit.
    if (from.type === to.type) {
      const baseValue = value * from.factor;
      const result = baseValue / to.factor;
      return { value: this.round(result), unit: toUnit, converted: true, densityAware: false };
    }

    // Cross-type (volume ↔ weight): requires density.
    if ((from.type === "VOLUME" && to.type === "WEIGHT") || (from.type === "WEIGHT" && to.type === "VOLUME")) {
      const density = ingredient ? (DENSITIES[ingredient.toLowerCase()] ?? 1.0) : 1.0;
      // Convert to base (ml for volume, g for weight)
      const baseValue = value * from.factor;
      let result: number;
      if (from.type === "VOLUME" && to.type === "WEIGHT") {
        // ml → g: multiply by density
        const grams = baseValue * density;
        result = grams / to.factor;
      } else {
        // g → ml: divide by density
        const ml = baseValue / density;
        result = ml / to.factor;
      }
      return { value: this.round(result), unit: toUnit, converted: true, densityAware: true };
    }

    // COUNT ↔ other: not directly convertible.
    throw new Error(`Cannot convert between ${from.type} and ${to.type} without a factor`);
  }

  /** List all supported units. */
  listUnits(): readonly { code: string; type: string; base: string; factor: number }[] {
    return Object.entries(FACTORS).map(([code, info]) => ({ code, ...info }));
  }

  /** Get the density of an ingredient (g/ml). */
  getDensity(ingredient: string): number {
    return DENSITIES[ingredient.toLowerCase()] ?? 1.0;
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
