/**
 * @file shared/index.ts
 * @package @eks-food/domain/shared
 *
 * Shared kernel barrel. Re-exports the cross-cutting contracts that every
 * Eks-Food bounded context depends on: domain events, results, entities,
 * value objects and domain errors.
 *
 * Import from `@eks-food/domain/shared` (or `@/packages/domain/shared`
 * inside this repo) — never reach into individual files.
 */

export type {
  DomainEvent,
} from './domain-event';

export {
  ok,
  err,
} from './result';
export type {
  Result,
} from './result';

export type {
  Entity,
  AggregateRoot,
} from './entity';

export type {
  UUID,
  ISODateString,
  EmailAddress,
  CurrencyCode,
  Cursor,
  Version,
  GeoPoint,
  GeoBounds,
  Money,
  Page,
  PagedResult,
  TimeRange,
  LocalizedText,
} from './value-objects';

export {
  uuid,
  isoDate,
  emailAddress,
  currencyCode,
  cursor,
  version,
} from './value-objects';

export type {
  DomainError,
  NotFoundError,
  ValidationError,
  ConcurrencyError,
  UnauthorizedError,
  BusinessRuleViolationError,
} from './errors';
