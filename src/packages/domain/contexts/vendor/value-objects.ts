/**
 * @file contexts/vendor/value-objects.ts
 * @package @eks-food/domain/contexts/vendor
 *
 * Vendor bounded context — value objects.
 */

export type {
  GeoPoint,
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';

import type {
  GeoPoint,
  ISODateString,
  Money,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for a Vendor.
 */
export type VendorStatus =
  | 'ONBOARDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'TERMINATED';

/**
 * Lifecycle states for a Stall.
 */
export type StallStatus = 'AVAILABLE' | 'RENTED' | 'MAINTENANCE' | 'RETIRED';

/**
 * Branded primitive representing a stall type, e.g. `"prep"` or `"line"`.
 */
export type StallType = string & { readonly __brand: 'StallType' };

/**
 * Pricing model for a stall rental.
 */
export interface StallPricing {
  readonly hourlyRate: Money;
  readonly dailyRate: Money | null;
  readonly weeklyRate: Money | null;
  readonly currency: string;
}

/**
 * Equipment installed at a stall.
 */
export interface StallEquipment {
  readonly name: string;
  readonly quantity: number;
}

/**
 * Vendor's physical location and operating hours.
 */
export interface VendorLocation {
  readonly address: string;
  readonly coordinates: GeoPoint;
  readonly timezone: string;
  readonly openingTime: string;
  readonly closingTime: string;
}

/**
 * An active rental of a stall by a cook.
 */
export interface StallRental {
  readonly cookId: UUID;
  readonly from: ISODateString;
  readonly to: ISODateString;
  readonly totalCharge: Money;
}
