/**
 * @file contexts/customer/value-objects.ts
 * @package @eks-food/domain/contexts/customer
 *
 * Customer bounded context — value objects.
 */

export type {
  EmailAddress,
  GeoPoint,
  ISODateString,
  LocalizedText,
  UUID,
} from '../../shared/value-objects';

import type {
  GeoPoint,
  ISODateString,
  LocalizedText,
} from '../../shared/value-objects';

/**
 * Branded primitive representing a normalised E.164 phone number.
 */
export type PhoneNumber = string & { readonly __brand: 'PhoneNumber' };

/**
 * Lifecycle states for a Customer.
 */
export type CustomerStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

/**
 * Free-form dietary restriction (e.g. `"halal"`, `"vegetarian"`).
 */
export type DietaryRestriction = string & { readonly __brand: 'DietaryRestriction' };

/**
 * A saved delivery/service address for a customer.
 */
export interface CustomerAddress {
  readonly label: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly country: string;
  readonly postalCode?: string;
  readonly coordinates: GeoPoint | null;
  readonly isDefault: boolean;
}

/**
 * A single customer preference (cuisine affinity, language, etc.).
 */
export interface CustomerPreference {
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: ISODateString;
}

/**
 * Customer's food-related profile snapshot used by the matching engine.
 */
export interface CustomerFoodProfile {
  readonly preferredCuisines: ReadonlyArray<LocalizedText>;
  readonly dietaryRestrictions: ReadonlyArray<DietaryRestriction>;
  readonly spiceTolerance: 0 | 1 | 2 | 3 | 4 | 5;
  readonly allergens: ReadonlyArray<string>;
}
