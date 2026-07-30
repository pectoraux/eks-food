import type {
  DomainError,
  GeoPoint,
  Money,
  Result,
  UUID,
} from "./types";
import { err, ok } from "./types";

/**
 * Generic builder factory.
 *
 * Returns a function that produces a shallow merge of `defaults` and any
 * `overrides` passed at call-time. Use it to build per-test entity factories
 * without leaking state across tests.
 *
 * @example
 *   const makeUser = factory({
 *     id: "u_1",
 *     name: "Amara",
 *     role: "cook",
 *   });
 *   makeUser();                       // -> { id: "u_1", name: "Amara", role: "cook" }
 *   makeUser({ name: "Kwame" });      // -> { id: "u_1", name: "Kwame", role: "cook" }
 */
export function factory<T>(
  defaults: T,
): (overrides?: Partial<T>) => T {
  return (overrides?: Partial<T>): T => ({
    ...defaults,
    ...(overrides ?? {}),
  });
}

/**
 * Deterministic UUID when a `seed` is supplied (same seed -> same UUID),
 * otherwise a real v4 UUID via `crypto.randomUUID()`.
 */
export function makeUuid(seed?: string): UUID {
  if (seed !== undefined && seed.length > 0) {
    const hex = Buffer.from(seed, "utf8")
      .toString("hex")
      .replace(/[^0-9a-f]/gi, "")
      .padEnd(12, "0")
      .slice(0, 12)
      .toLowerCase();
    return `00000000-0000-4000-8000-${hex}` as UUID;
  }
  return crypto.randomUUID() as UUID;
}

/**
 * Build a Money value. Defaults to 1000 GHS (the smallest typical cook
 * booking fee). Enforces that `amount` is non-negative — a negative amount
 * is a programmer error and throws synchronously rather than propagating an
 * invalid Money instance into the system under test.
 */
export function makeMoney(overrides?: Partial<Money>): Money {
  const base: Money = { amount: 1000, currency: "GHS" };
  const next: Money = { ...base, ...(overrides ?? {}) };
  if (!Number.isFinite(next.amount) || next.amount < 0) {
    throw new RangeError(
      `Money.amount must be a finite, non-negative number (got ${next.amount}).`,
    );
  }
  if (!/^[A-Z]{3}$/.test(next.currency)) {
    throw new RangeError(
      `Money.currency must be an ISO 4217 code (got "${next.currency}").`,
    );
  }
  return next;
}

/** Build a GeoPoint (defaults to central Accra). */
export function makeGeoPoint(overrides?: Partial<GeoPoint>): GeoPoint {
  const base: GeoPoint = { lat: 5.6037, lng: -0.187 };
  const next: GeoPoint = { ...base, ...(overrides ?? {}) };
  if (next.lat < -90 || next.lat > 90) {
    throw new RangeError(`GeoPoint.lat out of range: ${next.lat}`);
  }
  if (next.lng < -180 || next.lng > 180) {
    throw new RangeError(`GeoPoint.lng out of range: ${next.lng}`);
  }
  return next;
}

/**
 * Build an email address from a local part. The local part is sanitised to
 * `[a-z0-9-]`; missing/empty local parts get an auto-incrementing handle so
 * every call yields a unique address — handy for generating many users in a
 * single test.
 */
let emailAddressCounter = 0;
export function makeEmailAddress(local?: string): string {
  const raw = (local ?? "").trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const handle = safe.length > 0 ? safe : `user${++emailAddressCounter}`;
  return `${handle}@example.com`;
}

/**
 * Build an ISO-8601 UTC date string. When `seed` is omitted, returns a
 * deterministic reference timestamp (2024-01-01T00:00:00.000Z) so snapshots
 * stay stable. Pass a number (ms since epoch) or Date for an explicit value.
 */
export function makeISODate(seed?: number | Date): string {
  const d =
    seed === undefined
      ? new Date(Date.UTC(2024, 0, 1, 0, 0, 0, 0))
      : seed instanceof Date
        ? seed
        : new Date(seed);
  return d.toISOString();
}

const DEFAULT_DOMAIN_ERROR: DomainError = Object.freeze({
  code: "TEST_ERROR",
  message: "A test domain error.",
});

/**
 * Build a Result for tests. Three call shapes:
 *   - `makeResult()`                  -> `ok(1)`
 *   - `makeResult(value)`             -> `ok(value)`
 *   - `makeResult(false, error)`      -> `err(error)`
 */
export function makeResult<T = number, E = DomainError>(): Result<T, E>;
export function makeResult<T, E = DomainError>(value: T): Result<T, E>;
export function makeResult<T, E>(ok: false, error: E): Result<T, E>;
export function makeResult<T = number, E = DomainError>(
  value?: T | false,
  error?: E,
): Result<T, E> {
  if (value === false) {
    return err((error ?? (DEFAULT_DOMAIN_ERROR as unknown as E)) as E);
  }
  if (value === undefined) {
    return ok(1 as unknown as T);
  }
  return ok(value);
}
