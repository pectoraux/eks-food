/**
 * @file contexts/vendor/aggregates.ts
 * @package @eks-food/domain/contexts/vendor
 *
 * Vendor bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  StallEquipment,
  StallPricing,
  StallRental,
  StallStatus,
  StallType,
  VendorLocation,
  VendorStatus,
} from './value-objects';

/**
 * Aggregate root representing a Vendor (a shared-kitchen operator).
 */
export interface VendorAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'VendorAggregate';
  readonly tenantId: UUID;
  readonly name: string;
  readonly status: VendorStatus;
  readonly location: VendorLocation;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;

  activate(): Result<void, DomainError>;
  suspend(reason: string): Result<void, DomainError>;
  terminate(): Result<void, DomainError>;
  updateLocation(location: VendorLocation): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Stall inside a vendor's kitchen.
 */
export interface StallAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'StallAggregate';
  readonly vendorId: UUID;
  readonly name: string;
  readonly type: StallType;
  readonly status: StallStatus;
  readonly pricing: StallPricing;
  readonly equipment: ReadonlyArray<StallEquipment>;
  readonly currentRental: StallRental | null;

  list(): Result<void, DomainError>;
  retire(): Result<void, DomainError>;
  startMaintenance(): Result<void, DomainError>;
  endMaintenance(): Result<void, DomainError>;
  rentTo(rental: StallRental): Result<void, DomainError>;
  endRental(now: ISODateString): Result<void, DomainError>;
  updatePricing(patch: Partial<StallPricing>): Result<void, DomainError>;
  addEquipment(equipment: StallEquipment): Result<void, DomainError>;
}
