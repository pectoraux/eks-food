/**
 * @file contexts/cook/services.ts
 * @package @eks-food/domain/contexts/cook
 *
 * Cook bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  GeoPoint,
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';
import type { CookAggregate } from './aggregates';
import type { CuisineCode } from './value-objects';

/**
 * A single match candidate produced by {@link CookMatcher}.
 */
export interface CookMatch {
  readonly cookId: UUID;
  readonly score: number;
  readonly distanceKm: number | null;
  readonly estimatedPrice: Money | null;
  readonly breakdown: Readonly<Record<string, number>>;
}

/**
 * Query shape consumed by {@link CookMatcher}. The matching engine
 * itself lives in the application layer; this interface declares the
 * domain contract other contexts rely on (booking, marketplace).
 */
export interface CookMatchQuery {
  readonly tenantId: UUID;
  readonly serviceArea: GeoPoint;
  readonly cuisines?: ReadonlyArray<CuisineCode>;
  readonly languages?: ReadonlyArray<string>;
  readonly maxDistanceKm?: number;
  readonly minRating?: number;
  readonly budget?: Money;
  readonly requiredCertifications?: ReadonlyArray<string>;
  readonly availableAt?: ISODateString;
  readonly limit?: number;
}

/**
 * Scores cooks against a booking/marketplace query and returns ranked
 * candidates. Implementation lives in the application layer and uses
 * the cook context's repositories plus a geo index.
 */
export interface CookMatcher {
  match(query: CookMatchQuery): Promise<ReadonlyArray<CookMatch>>;
  bestMatch(query: CookMatchQuery): Promise<Result<CookMatch, DomainError>>;
}

/**
 * Refreshes a cook's reputation aggregate from completed bookings,
 * ratings and incidents. Triggered on each booking state transition.
 */
export interface CookReputationService {
  recompute(cookId: UUID): Promise<Result<CookAggregate, DomainError>>;
  applyRating(
    cookId: UUID,
    rating: number,
    weight: number,
  ): Promise<Result<void, DomainError>>;
}
