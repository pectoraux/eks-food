/**
 * @file shared/result.ts
 * @package @eks-food/domain/shared
 *
 * Shared kernel: a `Result<T, E>` discriminated union plus `ok()`/`err()`
 * factory functions.
 *
 * Responsibility:
 *  - Give every domain operation a single, explicit error channel that
 *    the compiler can enforce. Domain methods return `Result` rather than
 *    throwing so that callers must handle the failure case.
 *  - Keep the runtime footprint tiny: two object shapes, two factories,
 *    no exceptions, no allocations beyond the result object itself.
 *
 * This file contains the only runtime implementation permitted in the
 * shared kernel besides the `uuid()` factory in `value-objects.ts`.
 */

import type { DomainError } from './errors';

/**
 * Successful or failed outcome of a domain operation.
 *
 * Discriminate on the `ok` boolean flag:
 *  - `ok: true`  → read `value`
 *  - `ok: false` → read `error`
 *
 * The error type defaults to {@link DomainError} but can be narrowed by
 * a context to a specific union of subtypes.
 */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Construct a successful `Result`.
 *
 * @example
 *   const r: Result<number, DomainError> = ok(42);
 *   if (r.ok) console.log(r.value); // 42
 */
export function ok<T, E = DomainError>(value: T): Result<T, E> {
  return { ok: true, value };
}

/**
 * Construct a failed `Result`.
 *
 * @example
 *   const r: Result<number, NotFoundError> = err({
 *     code: 'NOT_FOUND',
 *     message: 'Booking not found',
 *     aggregateType: 'BookingAggregate',
 *     aggregateId: bookingId,
 *   });
 *   if (!r.ok) console.log(r.error.message);
 */
export function err<T, E = DomainError>(error: E): Result<T, E> {
  return { ok: false, error };
}
