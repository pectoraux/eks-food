/**
 * @file contexts/cook/aggregates.ts
 * @package @eks-food/domain/contexts/cook
 *
 * Cook bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  AvailabilitySlot,
  Certification,
  CookPricing,
  CookReputation,
  CookServiceArea,
  CookStatus,
  CuisineCode,
  LanguageCode,
} from './value-objects';

/**
 * Aggregate root representing a Cook (the supply side of the platform).
 * The Cook aggregate owns certifications, availability, pricing and
 * reputation as internal state.
 */
export interface CookAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'CookAggregate';
  readonly tenantId: UUID;
  readonly userId: UUID;
  readonly displayName: string;
  readonly bio: string;
  readonly status: CookStatus;
  readonly cuisines: ReadonlyArray<CuisineCode>;
  readonly languages: ReadonlyArray<LanguageCode>;
  readonly certifications: ReadonlyArray<Certification>;
  readonly availability: ReadonlyArray<AvailabilitySlot>;
  readonly serviceArea: CookServiceArea;
  readonly pricing: CookPricing;
  readonly reputation: CookReputation;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;

  activate(): Result<void, DomainError>;
  pause(reason: string): Result<void, DomainError>;
  suspend(reason: string): Result<void, DomainError>;
  offboard(): Result<void, DomainError>;
  addCertification(cert: Certification): Result<void, DomainError>;
  expireCertification(type: string, now: ISODateString): Result<void, DomainError>;
  addAvailabilitySlot(slot: AvailabilitySlot): Result<void, DomainError>;
  removeAvailabilitySlot(start: ISODateString): Result<void, DomainError>;
  updatePricing(patch: Partial<CookPricing>): Result<void, DomainError>;
  updateServiceArea(patch: Partial<CookServiceArea>): Result<void, DomainError>;
  addCuisine(code: CuisineCode): Result<void, DomainError>;
  addLanguage(code: LanguageCode): Result<void, DomainError>;
}

/**
 * Aggregate root representing a single certification document and its
 * verification lifecycle. Carved out so the safety context can re-
 * verify independently of the Cook aggregate.
 */
export interface CertificationAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'CertificationAggregate';
  readonly cookId: UUID;
  readonly type: Certification['type'];
  readonly status: Certification['status'];
  readonly issuedAt: ISODateString;
  readonly expiresAt: ISODateString | null;

  verify(verifiedBy: UUID, now: ISODateString): Result<void, DomainError>;
  reject(reason: string, now: ISODateString): Result<void, DomainError>;
  expire(now: ISODateString): Result<void, DomainError>;
}

/**
 * Aggregate root representing a cook's availability calendar. Kept
 * separate from Cook so high-frequency availability updates do not
 * contend with cook profile writes.
 */
export interface AvailabilityAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'AvailabilityAggregate';
  readonly cookId: UUID;
  readonly slots: ReadonlyArray<AvailabilitySlot>;

  addSlot(slot: AvailabilitySlot): Result<void, DomainError>;
  removeSlot(start: ISODateString): Result<void, DomainError>;
  replaceAll(slots: ReadonlyArray<AvailabilitySlot>): Result<void, DomainError>;
}
