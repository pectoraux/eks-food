import { describe, expect, it } from "vitest";

/**
 * @file connectors/__tests__/normalization.spec.ts
 *
 * Behavioural spec for the M5 connector normalization layer.
 *
 * Each external connector (Maps, Weather, Calendar, Procurement, …)
 * returns data in its own bespoke schema. Before the rest of the
 * Eks-Food platform can consume that data, it must be normalized to a
 * canonical domain object. The `Normalizer` class under test is
 * implemented in-file because the production `@eks/connectors` package
 * only ships the event/action vocabularies in this milestone.
 *
 * Normalization contract this spec pins down:
 *  1. **Field mapping**: provider-specific field names are remapped to
 *     canonical field names via a per-provider mapping table.
 *  2. **Unit conversion**: distance (km ↔ mi) and temperature (°C ↔ °F)
 *     are converted to the canonical unit (metric).
 *  3. **Timezone normalization**: every timestamp is converted to UTC
 *     ISO-8601 (`Z` suffix) regardless of the source timezone.
 *  4. **Metadata stripping**: provider-internal fields (anything not
 *     in the canonical schema) are dropped from the output.
 *  5. **Required-field validation**: missing required fields cause the
 *     normalizer to throw a `NormalizationError` rather than silently
 *     emit a partial record.
 */

/** Canonical units. */
const CANONICAL_DISTANCE_UNIT = "km" as const;
const CANONICAL_TEMP_UNIT = "C" as const;

/** Canonical route record (the contract downstream code relies on). */
interface CanonicalRoute {
  readonly distance: number; // kilometres
  readonly distanceUnit: typeof CANONICAL_DISTANCE_UNIT;
  readonly durationSeconds: number;
  readonly originAddress: string;
  readonly destinationAddress: string;
  readonly calculatedAt: string; // ISO-8601 UTC, ends in Z
}

/** Canonical weather record. */
interface CanonicalWeather {
  readonly temperature: number; // °C
  readonly temperatureUnit: typeof CANONICAL_TEMP_UNIT;
  readonly humidity: number; // 0..1
  readonly condition: string;
  readonly location: string;
  readonly observedAt: string; // ISO-8601 UTC
}

/** Union of every canonical domain object the normalizer can produce. */
type Canonical = CanonicalRoute | CanonicalWeather;

/** Per-provider field mapping: provider field → canonical field. */
type FieldMapping<Provider extends Record<string, unknown>> = {
  readonly [CanonicalKey in keyof Canonical]?: keyof Provider;
};

/** Specification for how to normalize a single provider's record. */
interface NormalizationSpec<P extends Record<string, unknown>, C extends Canonical> {
  readonly provider: string;
  readonly fields: FieldMapping<P>;
  readonly required: ReadonlyArray<keyof C>;
  readonly distanceUnit?: "km" | "mi"; // unit the provider emits distances in
  readonly tempUnit?: "C" | "F"; // unit the provider emits temperatures in
  readonly timezone?: string; // IANA tz the provider emits timestamps in
  readonly timestampField?: keyof P; // field that carries the timestamp
}

/** Error raised when normalization fails (missing required field, etc.). */
class NormalizationError extends Error {
  readonly provider: string;
  readonly field: string;
  constructor(provider: string, field: string, message: string) {
    super(`[${provider}] ${message} (field: ${field})`);
    this.name = "NormalizationError";
    this.provider = provider;
    this.field = field;
  }
}

const KM_PER_MI = 1.609344;
const MS_PER_SECOND = 1000;

/** Convert miles → km (no-op if already km). */
function toKm(distance: number, unit: "km" | "mi" | undefined): number {
  if (unit === "mi") return distance * KM_PER_MI;
  return distance;
}

/** Convert Fahrenheit → Celsius (no-op if already C). */
function toC(temp: number, unit: "C" | "F" | undefined): number {
  if (unit === "F") return (temp - 32) * (5 / 9);
  return temp;
}

/**
 * Convert an arbitrary timestamp (ISO-8601 with optional timezone, or
 * a unix-epoch millisecond number) to a canonical UTC ISO-8601 string
 * ending in `Z`.
 */
function toUTC(value: unknown, provider: string, field: string): string {
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (typeof value === "string") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new NormalizationError(provider, field, `unparseable timestamp "${value}"`);
    }
    return d.toISOString();
  }
  throw new NormalizationError(
    provider,
    field,
    `expected string or number timestamp, got ${typeof value}`,
  );
}

/**
 * Strip every key from `record` that does not appear in `keep`. Returns
 * a new object — the input is not mutated. This is the metadata-stripping
 * step: provider-internal keys (`_metadata`, `__raw`, `etag`, …) are
 * discarded before the canonical record is returned.
 */
function stripUnknown<T extends Record<string, unknown>>(
  record: T,
  keep: ReadonlyArray<string>,
): Record<string, unknown> {
  const keepSet = new Set(keep);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (keepSet.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Pure, side-effect-free normalizer. Each `NormalizationSpec` describes
 * one provider's mapping; the normalizer applies the spec to a single
 * provider record and returns the canonical object.
 */
class Normalizer {
  /** Normalize a single provider record into its canonical form. */
  normalize<P extends Record<string, unknown>, C extends Canonical>(
    spec: NormalizationSpec<P, C>,
    record: P,
  ): C {
    // Build the canonical object by walking the field mapping.
    const out: Record<string, unknown> = {};
    for (const [canonicalKey, providerKey] of Object.entries(spec.fields) as ReadonlyArray<
      [string, keyof P | undefined]
    >) {
      if (providerKey === undefined) continue;
      const value = record[providerKey];
      out[canonicalKey] = value;
    }

    // Unit conversions.
    if (spec.distanceUnit !== undefined && typeof out.distance === "number") {
      out.distance = toKm(out.distance, spec.distanceUnit);
    }
    if (spec.tempUnit !== undefined && typeof out.temperature === "number") {
      out.temperature = toC(out.temperature, spec.tempUnit);
    }

    // Timezone normalization: convert the provider timestamp → UTC.
    if (spec.timestampField !== undefined) {
      const tsValue = record[spec.timestampField];
      if (tsValue !== undefined) {
        out.calculatedAt = toUTC(tsValue, spec.provider, String(spec.timestampField));
        out.observedAt = toUTC(tsValue, spec.provider, String(spec.timestampField));
      }
    }

    // Stamp canonical units so downstream code never has to guess.
    if (out.distance !== undefined) out.distanceUnit = CANONICAL_DISTANCE_UNIT;
    if (out.temperature !== undefined) out.temperatureUnit = CANONICAL_TEMP_UNIT;

    // Required-field validation: every required canonical field must be present.
    for (const requiredKey of spec.required) {
      if (out[requiredKey as string] === undefined) {
        throw new NormalizationError(
          spec.provider,
          String(requiredKey),
          "missing required field",
        );
      }
    }

    // Metadata stripping: keep only the canonical keys. The auto-stamped
    // unit keys (`distanceUnit`, `temperatureUnit`) are part of the
    // canonical schema even though they're not listed in `spec.fields`.
    const keep = new Set<string>(Object.keys(spec.fields));
    if (out.distance !== undefined) keep.add("distanceUnit");
    if (out.temperature !== undefined) keep.add("temperatureUnit");
    const cleaned = stripUnknown(out, Array.from(keep));

    return cleaned as C;
  }
}

/** Helper: assert a string ends in `Z` (UTC marker). */
function isUTC(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(iso);
}

describe("Normalizer", () => {
  describe("field mapping", () => {
    it("maps provider-specific field names to canonical field names", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalRoute
      > = {
        provider: "google-maps",
        fields: {
          distance: "distanceMeters",
          durationSeconds: "durationSeconds",
          originAddress: "startAddress",
          destinationAddress: "endAddress",
          calculatedAt: "createdAt",
        },
        required: ["distance", "durationSeconds", "originAddress", "destinationAddress"],
        distanceUnit: "km",
        timestampField: "createdAt",
      };
      const record = {
        distanceMeters: 8.42,
        durationSeconds: 932,
        startAddress: "123 Main St",
        endAddress: "456 Oak Ave",
        createdAt: "2024-01-01T12:00:00.000Z",
        // Provider metadata that MUST be stripped:
        _metadata: { requestId: "abc" },
        __raw: "<xml/>",
        etag: "W/\"abc\"",
      };
      const result = normalizer.normalize(spec, record);
      expect(result.distance).toBe(8.42);
      expect(result.distanceUnit).toBe("km");
      expect(result.durationSeconds).toBe(932);
      expect(result.originAddress).toBe("123 Main St");
      expect(result.destinationAddress).toBe("456 Oak Ave");
      expect(result.calculatedAt).toBe("2024-01-01T12:00:00.000Z");
    });

    it("strips provider-internal metadata fields from the output", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalRoute
      > = {
        provider: "openrouteservice",
        fields: {
          distance: "dist",
          durationSeconds: "dur",
          originAddress: "from",
          destinationAddress: "to",
          calculatedAt: "ts",
        },
        required: ["distance", "durationSeconds", "originAddress", "destinationAddress"],
        distanceUnit: "km",
        timestampField: "ts",
      };
      const record = {
        dist: 5,
        dur: 600,
        from: "A",
        to: "B",
        ts: "2024-06-01T00:00:00.000Z",
        _internal: "should-be-stripped",
        __provider: "ors",
        requestId: "abc-123",
      };
      const result = normalizer.normalize(spec, record);
      const keys = Object.keys(result);
      expect(keys).not.toContain("_internal");
      expect(keys).not.toContain("__provider");
      expect(keys).not.toContain("requestId");
      // Only canonical keys remain.
      expect(keys.sort()).toEqual(
        [
          "distance",
          "distanceUnit",
          "durationSeconds",
          "originAddress",
          "destinationAddress",
          "calculatedAt",
        ].sort(),
      );
    });
  });

  describe("unit conversion", () => {
    it("converts miles to kilometres when the provider emits mi", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalRoute
      > = {
        provider: "mapbox",
        fields: {
          distance: "distanceMi",
          durationSeconds: "durationSec",
          originAddress: "fromAddr",
          destinationAddress: "toAddr",
          calculatedAt: "ts",
        },
        required: ["distance", "durationSeconds", "originAddress", "destinationAddress"],
        distanceUnit: "mi",
        timestampField: "ts",
      };
      const record = {
        distanceMi: 10, // 10 miles → 16.09344 km
        durationSec: 600,
        fromAddr: "A",
        toAddr: "B",
        ts: "2024-01-01T00:00:00.000Z",
      };
      const result = normalizer.normalize(spec, record);
      expect(result.distance).toBeCloseTo(16.09344, 5);
      expect(result.distanceUnit).toBe("km");
    });

    it("leaves kilometres unchanged when the provider already emits km", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalRoute
      > = {
        provider: "ors",
        fields: {
          distance: "dist",
          durationSeconds: "dur",
          originAddress: "from",
          destinationAddress: "to",
          calculatedAt: "ts",
        },
        required: ["distance", "durationSeconds", "originAddress", "destinationAddress"],
        distanceUnit: "km",
        timestampField: "ts",
      };
      const record = {
        dist: 5,
        dur: 600,
        from: "A",
        to: "B",
        ts: "2024-01-01T00:00:00.000Z",
      };
      const result = normalizer.normalize(spec, record);
      expect(result.distance).toBe(5);
      expect(result.distanceUnit).toBe("km");
    });

    it("converts Fahrenheit to Celsius for weather records", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalWeather
      > = {
        provider: "accuweather",
        fields: {
          temperature: "tempF",
          humidity: "hum",
          condition: "cond",
          location: "loc",
          observedAt: "ts",
        },
        required: ["temperature", "humidity", "condition", "location"],
        tempUnit: "F",
        timestampField: "ts",
      };
      const record = {
        tempF: 32, // 32°F → 0°C
        hum: 0.65,
        cond: "clear",
        loc: "Accra",
        ts: "2024-01-01T00:00:00.000Z",
      };
      const result = normalizer.normalize(spec, record);
      expect(result.temperature).toBeCloseTo(0, 5);
      expect(result.temperatureUnit).toBe("C");
    });

    it("converts a hot Fahrenheit reading (98.6°F → 37°C)", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalWeather
      > = {
        provider: "openweather",
        fields: {
          temperature: "tempF",
          humidity: "humidity",
          condition: "weatherMain",
          location: "name",
          observedAt: "dt",
        },
        required: ["temperature", "humidity", "condition", "location"],
        tempUnit: "F",
        timestampField: "dt",
      };
      const record = {
        tempF: 98.6,
        humidity: 0.5,
        weatherMain: "hot",
        name: "Lagos",
        dt: "2024-06-15T12:00:00.000Z",
      };
      const result = normalizer.normalize(spec, record);
      expect(result.temperature).toBeCloseTo(37, 1);
      expect(result.temperatureUnit).toBe("C");
    });

    it("leaves Celsius unchanged when the provider already emits C", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalWeather
      > = {
        provider: "metno",
        fields: {
          temperature: "tempC",
          humidity: "hum",
          condition: "cond",
          location: "loc",
          observedAt: "ts",
        },
        required: ["temperature", "humidity", "condition", "location"],
        tempUnit: "C",
        timestampField: "ts",
      };
      const record = {
        tempC: 25,
        hum: 0.7,
        cond: "sunny",
        loc: "Kumasi",
        ts: "2024-01-01T00:00:00.000Z",
      };
      const result = normalizer.normalize(spec, record);
      expect(result.temperature).toBe(25);
      expect(result.temperatureUnit).toBe("C");
    });
  });

  describe("timezone normalization", () => {
    it("converts an ISO timestamp with a non-UTC offset to UTC", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalRoute
      > = {
        provider: "p1",
        fields: {
          distance: "d",
          durationSeconds: "dur",
          originAddress: "from",
          destinationAddress: "to",
          calculatedAt: "ts",
        },
        required: ["distance", "durationSeconds", "originAddress", "destinationAddress"],
        distanceUnit: "km",
        timestampField: "ts",
      };
      // 2024-01-01T12:00:00-05:00 (US Eastern) == 2024-01-01T17:00:00.000Z
      const record = {
        d: 5,
        dur: 600,
        from: "A",
        to: "B",
        ts: "2024-01-01T12:00:00-05:00",
      };
      const result = normalizer.normalize(spec, record);
      expect(result.calculatedAt).toBe("2024-01-01T17:00:00.000Z");
      expect(isUTC(result.calculatedAt)).toBe(true);
    });

    it("converts a unix-epoch millisecond timestamp to UTC ISO-8601", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalWeather
      > = {
        provider: "p2",
        fields: {
          temperature: "temp",
          humidity: "hum",
          condition: "cond",
          location: "loc",
          observedAt: "ts",
        },
        required: ["temperature", "humidity", "condition", "location"],
        tempUnit: "C",
        timestampField: "ts",
      };
      // 1700000000000 ms = 2023-11-14T22:13:20.000Z
      const record = {
        temp: 20,
        hum: 0.6,
        cond: "cloudy",
        loc: "Tamale",
        ts: 1700000000000,
      };
      const result = normalizer.normalize(spec, record);
      expect(result.observedAt).toBe("2023-11-14T22:13:20.000Z");
      expect(isUTC(result.observedAt)).toBe(true);
    });

    it("throws on an unparseable timestamp string", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalRoute
      > = {
        provider: "bad-ts",
        fields: {
          distance: "d",
          durationSeconds: "dur",
          originAddress: "from",
          destinationAddress: "to",
          calculatedAt: "ts",
        },
        required: ["distance", "durationSeconds", "originAddress", "destinationAddress"],
        distanceUnit: "km",
        timestampField: "ts",
      };
      const record = {
        d: 5,
        dur: 600,
        from: "A",
        to: "B",
        ts: "not-a-date",
      };
      expect(() => normalizer.normalize(spec, record)).toThrowError(
        /unparseable timestamp/,
      );
    });
  });

  describe("required-field validation", () => {
    it("throws NormalizationError when a required field is missing", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalRoute
      > = {
        provider: "p3",
        fields: {
          distance: "d",
          durationSeconds: "dur",
          originAddress: "from",
          destinationAddress: "to",
          calculatedAt: "ts",
        },
        required: ["distance", "durationSeconds", "originAddress", "destinationAddress"],
        distanceUnit: "km",
        timestampField: "ts",
      };
      const record = {
        d: 5,
        dur: 600,
        from: "A",
        // missing `to`
        ts: "2024-01-01T00:00:00.000Z",
      };
      expect(() => normalizer.normalize(spec, record)).toThrowError(
        NormalizationError,
      );
      expect(() => normalizer.normalize(spec, record)).toThrowError(
        /missing required field/,
      );
    });

    it("the thrown error carries the provider name and the missing field", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalRoute
      > = {
        provider: "missing-prov",
        fields: {
          distance: "d",
          durationSeconds: "dur",
          originAddress: "from",
          destinationAddress: "to",
          calculatedAt: "ts",
        },
        required: ["distance", "durationSeconds", "originAddress", "destinationAddress"],
        distanceUnit: "km",
        timestampField: "ts",
      };
      const record = { d: 5, dur: 600, ts: "2024-01-01T00:00:00.000Z" };
      try {
        normalizer.normalize(spec, record);
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(NormalizationError);
        const ne = e as NormalizationError;
        expect(ne.provider).toBe("missing-prov");
        // One of the required fields is missing; the normalizer reports
        // the first missing one it encounters.
        expect(["originAddress", "destinationAddress"]).toContain(ne.field);
      }
    });

    it("does not throw when all required fields are present", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalWeather
      > = {
        provider: "ok",
        fields: {
          temperature: "temp",
          humidity: "hum",
          condition: "cond",
          location: "loc",
          observedAt: "ts",
        },
        required: ["temperature", "humidity", "condition", "location"],
        tempUnit: "C",
        timestampField: "ts",
      };
      const record = {
        temp: 22,
        hum: 0.55,
        cond: "partly-cloudy",
        loc: "Takoradi",
        ts: "2024-01-01T00:00:00.000Z",
      };
      expect(() => normalizer.normalize(spec, record)).not.toThrow();
    });
  });

  describe("purity", () => {
    it("does not mutate the input record", () => {
      const normalizer = new Normalizer();
      const spec: NormalizationSpec<
        Record<string, unknown>,
        CanonicalRoute
      > = {
        provider: "p4",
        fields: {
          distance: "d",
          durationSeconds: "dur",
          originAddress: "from",
          destinationAddress: "to",
          calculatedAt: "ts",
        },
        required: ["distance", "durationSeconds", "originAddress", "destinationAddress"],
        distanceUnit: "mi",
        timestampField: "ts",
      };
      const record = {
        d: 10,
        dur: 600,
        from: "A",
        to: "B",
        ts: "2024-01-01T00:00:00.000Z",
      };
      const snapshot = { ...record };
      normalizer.normalize(spec, record);
      expect(record).toEqual(snapshot);
    });
  });
});
