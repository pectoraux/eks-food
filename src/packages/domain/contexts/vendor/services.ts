/**
 * @file contexts/vendor/services.ts
 * @package @eks-food/domain/contexts/vendor
 *
 * Vendor bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';
import type { StallAggregate } from './aggregates';

/**
 * Computes rental charges and availability for a stall over a time
 * window. Used by the booking context when a cook needs a stall.
 */
export interface StallRentalPricingService {
  computeCharge(
    stall: StallAggregate,
    from: ISODateString,
    to: ISODateString,
  ): Result<Money, DomainError>;
  isAvailable(
    stall: StallAggregate,
    from: ISODateString,
    to: ISODateString,
  ): boolean;
}

/**
 * Finds the best available stall for a given cook requirement.
 */
export interface StallFinder {
  findAvailable(
    vendorId: UUID | null,
    from: ISODateString,
    to: ISODateString,
    requiredEquipment?: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<StallAggregate>>;
}
