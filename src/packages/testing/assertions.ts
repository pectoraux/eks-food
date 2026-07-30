import { expect } from "vitest";
import type { DomainError, Paginated, Result } from "./types";

/**
 * Assertion helpers for the `Result<T,E>` discriminated union. Each helper
 * is implemented with vitest's `expect` so failures render rich diffs.
 *
 * Every helper is also a TypeScript assertion function (`asserts x is Y`),
 * so callers get the narrowed type for free after the call.
 */

/**
 * Assert that `r` is a successful Result and narrow it to the ok branch.
 * Throws (via expect) when `r` is an error Result.
 */
export function assertOk<T>(
  r: Result<T, unknown>,
): asserts r is { readonly ok: true; readonly value: T } {
  expect(r.ok).toBe(true);
  if (r.ok !== true) {
    throw new Error("unreachable"); // narrows r for TS
  }
}

/**
 * Assert that `r` is a failed Result and narrow it to the err branch.
 * Throws (via expect) when `r` is an ok Result.
 */
export function assertErr<E>(
  r: Result<unknown, E>,
): asserts r is { readonly ok: false; readonly error: E } {
  expect(r.ok).toBe(false);
  if (r.ok !== false) {
    throw new Error("unreachable"); // narrows r for TS
  }
}

/**
 * Assert that `r` is a failed Result whose error.code === `errorCode`.
 */
export function assertDomainError<E extends DomainError>(
  r: Result<unknown, E>,
  errorCode: string,
): asserts r is { readonly ok: false; readonly error: E } {
  expect(r.ok).toBe(false);
  if (r.ok !== false) {
    throw new Error("unreachable"); // narrows r for TS
  }
  expect(typeof r.error.code).toBe("string");
  expect(r.error.code).toBe(errorCode);
}

/**
 * Assert that `list` is a well-formed paginated envelope. Verifies the
 * items array exists, the metadata fields are numbers, and the page size is
 * respected.
 */
export function assertPaginated<T>(list: Paginated<T>): asserts list is Paginated<T> {
  expect(list).toBeDefined();
  expect(Array.isArray(list.items)).toBe(true);
  expect(typeof list.total).toBe("number");
  expect(typeof list.page).toBe("number");
  expect(typeof list.pageSize).toBe("number");
  expect(list.total).toBeGreaterThanOrEqual(0);
  expect(list.page).toBeGreaterThanOrEqual(1);
  expect(list.pageSize).toBeGreaterThanOrEqual(0);
  expect(list.items.length).toBeLessThanOrEqual(Math.max(list.pageSize, 0));
  if (list.total > 0) {
    expect(list.items.length).toBeGreaterThan(0);
  }
}
