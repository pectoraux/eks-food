/**
 * @file contexts/scheduling/repositories.ts
 * @package @eks-food/domain/contexts/scheduling
 *
 * Scheduling bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  RecurrenceAggregate,
  ScheduleAggregate,
  SlotAggregate,
} from './aggregates';
import type {
  RecurrenceStatus,
  ScheduleOwnerType,
  ScheduleStatus,
  SlotStatus,
} from './value-objects';

export interface SlotListFilter {
  readonly ownerId?: UUID;
  readonly ownerType?: ScheduleOwnerType;
  readonly status?: SlotStatus;
  readonly from?: string;
  readonly to?: string;
}

export interface SlotRepository {
  findById(id: UUID): Promise<SlotAggregate | null>;
  list(filter: SlotListFilter, page: Page): Promise<PagedResult<SlotAggregate>>;
  findOpenForOwner(
    ownerId: UUID,
    from: string,
    to: string,
  ): Promise<ReadonlyArray<SlotAggregate>>;
  save(agg: SlotAggregate): Promise<Result<void, DomainError>>;
}

export interface ScheduleRepository {
  findById(id: UUID): Promise<ScheduleAggregate | null>;
  findByOwner(ownerId: UUID): Promise<ScheduleAggregate | null>;
  list(
    filter: { ownerId?: UUID; status?: ScheduleStatus },
    page: Page,
  ): Promise<PagedResult<ScheduleAggregate>>;
  save(agg: ScheduleAggregate): Promise<Result<void, DomainError>>;
}

export interface RecurrenceRepository {
  findById(id: UUID): Promise<RecurrenceAggregate | null>;
  listDueBefore(date: string): Promise<ReadonlyArray<RecurrenceAggregate>>;
  list(
    filter: { ownerId?: UUID; status?: RecurrenceStatus },
    page: Page,
  ): Promise<PagedResult<RecurrenceAggregate>>;
  save(agg: RecurrenceAggregate): Promise<Result<void, DomainError>>;
}
