/**
 * @file contexts/restaurant/value-objects.ts
 * @package @eks-food/domain/contexts/restaurant
 *
 * Restaurant bounded context — value objects.
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
 * Lifecycle states for a Restaurant.
 */
export type RestaurantStatus =
  | 'ONBOARDING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'SUSPENDED'
  | 'CLOSED';

/**
 * Lifecycle states for a Menu.
 */
export type MenuStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

/**
 * Branded primitive representing a cuisine code.
 */
export type CuisineCode = string & { readonly __brand: 'CuisineCode' };

/**
 * Operating hours for a single weekday (0 = Sunday ... 6 = Saturday).
 */
export interface OperatingHoursEntry {
  readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly openTime: string;
  readonly closeTime: string;
  readonly closed: boolean;
}

/**
 * A restaurant's operating schedule across the week.
 */
export interface OperatingSchedule {
  readonly entries: ReadonlyArray<OperatingHoursEntry>;
  readonly timezone: string;
}

/**
 * A single menu item.
 */
export interface MenuItem {
  readonly id: UUID;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly price: Money;
  readonly category: string;
  readonly allergens: ReadonlyArray<string>;
  readonly dietaryTags: ReadonlyArray<string>;
  readonly available: boolean;
  readonly imageUrl?: string;
  readonly updatedAt: ISODateString;
}
