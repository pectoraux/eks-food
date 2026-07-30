/**
 * Result<T,E> — the canonical error-channel type for Eks-Food domain & application
 * layers. Forces explicit error handling without exceptions in business code.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Type guard: narrows a Result to its success branch. */
export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

/** Type guard: narrows a Result to its failure branch. */
export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/** Map the success value, leaving errors untouched. */
export function mapResult<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/** Chain Results together (monadic bind). */
export function flatMap<T, U, E>(r: Result<T, E>, fn: (v: T) => Result<U, E>): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

/** Unwrap with a default for the error case. */
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

/** Unwrap, throwing if it's an error. Use only when failure is truly impossible. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw r.error;
  return r.value;
}
