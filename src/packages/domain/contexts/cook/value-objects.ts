/**
 * @file contexts/cook/value-objects.ts
 * @package @eks-food/domain/contexts/cook
 *
 * Cook bounded context — value objects.
 */

export type {
  GeoPoint,
  ISODateString,
  LocalizedText,
  Money,
  UUID,
} from '../../shared/value-objects';

import type {
  GeoPoint,
  ISODateString,
  LocalizedText,
  Money,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for a Cook.
 */
export type CookStatus =
  | 'PENDING_ONBOARDING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'SUSPENDED'
  | 'OFFBOARDED';

/**
 * Verification status for a single certification document.
 */
export type CertificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

/**
 * Branded primitive representing a certification type code,
 * e.g. `"food-safety.level2"`.
 */
export type CertificationType = string & { readonly __brand: 'CertificationType' };

/**
 * Branded primitive representing a cuisine code, e.g. `"west-african"`.
 */
export type CuisineCode = string & { readonly __brand: 'CuisineCode' };

/**
 * Branded primitive representing an ISO 639-1 language code.
 */
export type LanguageCode = string & { readonly __brand: 'LanguageCode' };

/**
 * A single award/credential held by a cook.
 */
export interface Certification {
  readonly type: CertificationType;
  readonly displayName: LocalizedText;
  readonly status: CertificationStatus;
  readonly issuedBy: UUID;
  readonly issuedAt: ISODateString;
  readonly expiresAt: ISODateString | null;
  readonly evidenceUrl?: string;
}

/**
 * A single availability slot a cook is willing to accept bookings in.
 */
export interface AvailabilitySlot {
  readonly start: ISODateString;
  readonly end: ISODateString;
  readonly recurringRule?: string;
  readonly note?: string;
}

/**
 * Cook's service-area profile used by the matching engine.
 */
export interface CookServiceArea {
  readonly homeLocation: GeoPoint;
  readonly serviceRadiusKm: number;
  readonly travelFeePerKm: Money | null;
  readonly excludedZones: ReadonlyArray<string>;
}

/**
 * Cook's pricing profile.
 */
export interface CookPricing {
  readonly baseHourlyRate: Money;
  readonly minimumBookingHours: number;
  readonly currency: string;
  readonly surgeMultiplier: number;
}

/**
 * Aggregate statistics about a cook's past performance.
 */
export interface CookReputation {
  readonly rating: number;
  readonly completedJobs: number;
  readonly cancellations: number;
  readonly noShows: number;
  readonly updatedAt: ISODateString;
}
