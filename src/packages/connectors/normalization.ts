/**
 * Normalization Layer — standardizes provider-specific schemas to canonical
 * domain objects. Every subsystem receives the same shape regardless of which
 * provider was used.
 */
export interface CanonicalGeocode {
  readonly lat: number;
  readonly lng: number;
  readonly formattedAddress: string;
  readonly city?: string;
  readonly region?: string;
  readonly country?: string;
  readonly postalCode?: string;
  readonly provider: string;
}

export interface CanonicalRoute {
  readonly distanceKm: number;
  readonly durationMin: number;
  readonly polyline?: string;
  readonly steps: readonly { instruction: string; distanceKm: number; durationMin: number }[];
  readonly provider: string;
}

export interface CanonicalWeather {
  readonly temperatureC: number;
  readonly humidity: number;
  readonly windSpeedKph: number;
  readonly condition: string;
  readonly icon?: string;
  readonly observedAt: Date;
  readonly provider: string;
}

export interface CanonicalCalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly timezone: string;
  readonly attendees: readonly string[];
  readonly location?: string;
  readonly provider: string;
}

export interface CanonicalMenuItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly price: number;
  readonly currency: string;
  readonly category?: string;
  readonly available: boolean;
  readonly provider: string;
}

export interface CanonicalCatalogItem {
  readonly sku: string;
  readonly name: string;
  readonly description?: string;
  readonly price: number;
  readonly currency: string;
  readonly unit: string;
  readonly inStock: boolean;
  readonly provider: string;
}

/** Unit conversions. */
export function kmToMi(km: number): number { return Math.round(km * 0.621371 * 100) / 100; }
export function miToKm(mi: number): number { return Math.round(mi * 1.60934 * 100) / 100; }
export function cToF(c: number): number { return Math.round((c * 9 / 5 + 32) * 10) / 10; }
export function fToC(f: number): number { return Math.round(((f - 32) * 5 / 9) * 10) / 10; }
export function kphToMph(kph: number): number { return Math.round(kph * 0.621371 * 10) / 10; }

/** Normalize a timezone to UTC offset in minutes. */
export function timezoneToOffsetMinutes(tz: string): number {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
    const match = offsetPart.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (!match) return 0;
    const sign = match[1] === "+" ? 1 : -1;
    const hours = parseInt(match[2], 10);
    const minutes = parseInt(match[3] ?? "0", 10);
    return sign * (hours * 60 + minutes);
  } catch {
    return 0;
  }
}

/** Convert a date from one timezone to UTC. */
export function toUTC(date: Date, _fromTz: string): Date {
  // The Date object is already stored as UTC internally; this is a no-op for
  // correct Date instances. For string inputs, parse with the timezone offset.
  return new Date(date);
}

/** Strip provider-specific metadata from an object. */
export function stripProviderMetadata<T extends Record<string, unknown>>(obj: T, providerFields: readonly string[]): T {
  const result = { ...obj };
  for (const field of providerFields) {
    delete result[field];
  }
  return result;
}

/** Validate that a canonical object has all required fields. */
export function validateCanonical<T extends Record<string, unknown>>(obj: T, required: readonly string[]): { valid: boolean; missing: readonly string[] } {
  const missing = required.filter((f) => obj[f] === undefined || obj[f] === null);
  return { valid: missing.length === 0, missing };
}
