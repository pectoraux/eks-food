/**
 * @file contexts/booking/repositories.ts
 * @package @eks-food/domain/contexts/booking
 *
 * Booking bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type { BookingAggregate, ReservationAggregate } from './aggregates';
import type { BookingCode, BookingStatus, ReservationStatus } from './value-objects';

export interface BookingListFilter {
  readonly tenantId?: UUID;
  readonly customerId?: UUID;
  readonly cookId?: UUID;
  readonly status?: BookingStatus;
  readonly scheduledFrom?: string;
  readonly scheduledTo?: string;
}

export interface BookingRepository {
  findById(id: UUID): Promise<BookingAggregate | null>;
  findByCode(code: BookingCode): Promise<BookingAggregate | null>;
  list(filter: BookingListFilter, page: Page): Promise<PagedResult<BookingAggregate>>;
  save(agg: BookingAggregate): Promise<Result<void, DomainError>>;
}

export interface ReservationListFilter {
  readonly cookId?: UUID;
  readonly customerId?: UUID;
  readonly status?: ReservationStatus;
}

export interface ReservationRepository {
  findById(id: UUID): Promise<ReservationAggregate | null>;
  findActiveForCook(
    cookId: UUID,
    at: string,
  ): Promise<ReservationAggregate | null>;
  list(
    filter: ReservationListFilter,
    page: Page,
  ): Promise<PagedResult<ReservationAggregate>>;
  save(agg: ReservationAggregate): Promise<Result<void, DomainError>>;
  releaseExpired(now: string): Promise<Result<number, DomainError>>;
}
