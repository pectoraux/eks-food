/**
 * @file shared/errors.ts
 * @package @eks-food/domain/shared
 *
 * Shared kernel: domain error contracts.
 *
 * Responsibility:
 *  - Define the base `DomainError` interface that every domain failure
 *    must satisfy, plus a small set of common subtypes that recur across
 *    every bounded context (`NotFoundError`, `ValidationError`,
 *    `ConcurrencyError`, `UnauthorizedError`,
 *    `BusinessRuleViolationError`).
 *  - Give each subtype a literal `code` so that callers can pattern-match
 *    on `error.code` exhaustively without resorting to `instanceof`.
 *
 * Constraints:
 *  - Pure TypeScript interfaces; errors are plain data, never thrown by
 *    the domain. They travel inside `Result<_, DomainError>` values.
 */

import type { UUID } from './value-objects';

/**
 * Base contract for all domain errors. Concrete subtypes narrow the
 * `code` field to a string literal so callers can switch on it.
 */
export interface DomainError {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Raised when a repository lookup fails to find an aggregate by id.
 */
export interface NotFoundError extends DomainError {
  readonly code: 'NOT_FOUND';
  readonly aggregateType: string;
  readonly aggregateId: UUID;
}

/**
 * Raised when an invariant on a value object or command input fails.
 * `field` is the offending field path (dotted) when known.
 */
export interface ValidationError extends DomainError {
  readonly code: 'VALIDATION';
  readonly field?: string;
}

/**
 * Raised when an optimistic-concurrency check fails (the aggregate was
 * modified by another transaction after the caller loaded it).
 */
export interface ConcurrencyError extends DomainError {
  readonly code: 'CONCURRENCY';
  readonly aggregateType: string;
  readonly aggregateId: UUID;
  readonly expectedVersion: number;
  readonly actualVersion: number;
}

/**
 * Raised when the current actor is not permitted to perform the
 * operation. Distinct from authentication failures (which the identity
 * context surfaces as `ValidationError` on the credential).
 */
export interface UnauthorizedError extends DomainError {
  readonly code: 'UNAUTHORIZED';
  readonly actorId: UUID;
  readonly permission?: string;
}

/**
 * Raised when a domain invariant is violated even though the inputs are
 * individually valid (e.g. attempting to confirm a booking that has
 * already been cancelled).
 */
export interface BusinessRuleViolationError extends DomainError {
  readonly code: 'BUSINESS_RULE';
  readonly rule: string;
  readonly aggregateType: string;
  readonly aggregateId: UUID;
}
