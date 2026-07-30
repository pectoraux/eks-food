/**
 * Local minimal stand-ins for the shared kernel types that the `@eks/domain`
 * package is expected to expose (`Result<T,E>`, `ok()`, `err()`, `UUID`,
 * `Money`, `DomainError`, `Paginated<T>`, `GeoPoint`).
 *
 * NOTE: Another agent is publishing `@eks/domain` concurrently. These types
 * exist purely so the testing utilities compile and work today without
 * blocking on the domain package. The shapes are intentionally identical to
 * the canonical kernel types so consumers can swap
 *   `import type { Result, Money, ... } from "@eks/testing"`
 * for
 *   `import type { Result, Money, ... } from "@eks/domain"`
 * once the domain package is available, with no behavioural change.
 */

/** Branded string UUID. Compatible with crypto.randomUUID() output. */
export type UUID = string & { readonly __brand: "UUID" };

/** Monetary amount with ISO 4217 currency code. */
export interface Money {
  amount: number;
  currency: string;
}

/** Geographic coordinate. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Discriminated-union Result type. */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Structured domain error. */
export interface DomainError {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Paginated list envelope. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage?: boolean;
}

/** Construct a successful Result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Construct a failed Result. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Brand a plain string as a UUID (no runtime validation; for ergonomics). */
export function asUUID(s: string): UUID {
  return s as UUID;
}
