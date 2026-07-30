/**
 * @file contexts/scheduling/aggregates.ts
 * @package @eks-food/domain/contexts/scheduling
 *
 * Scheduling bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  RecurrenceRule,
  RecurrenceStatus,
  ScheduleOwnerType,
  ScheduleStatus,
  Slot,
  SlotStatus,
} from './value-objects';

/**
 * Aggregate root representing a Slot: a single (start, end) window
 * owned by a cook, restaurant or stall.
 */
export interface SlotAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'SlotAggregate';
  readonly ownerId: UUID;
  readonly ownerType: ScheduleOwnerType;
  readonly start: ISODateString;
  readonly end: ISODateString;
  readonly status: SlotStatus;
  readonly capacity: number;
  readonly bookedCount: number;

  hold(): Result<void, DomainError>;
  book(): Result<void, DomainError>;
  release(): Result<void, DomainError>;
  close(reason: string): Result<void, DomainError>;
  cancel(reason: string): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Schedule: a named collection of slots
 * for a single owner.
 */
export interface ScheduleAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'ScheduleAggregate';
  readonly ownerId: UUID;
  readonly ownerType: ScheduleOwnerType;
  readonly name: string;
  readonly status: ScheduleStatus;
  readonly slots: ReadonlyArray<Slot>;
  readonly recurrenceId: UUID | null;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;

  activate(): Result<void, DomainError>;
  pause(reason: string): Result<void, DomainError>;
  archive(): Result<void, DomainError>;
  addSlot(slot: Slot): Result<void, DomainError>;
  removeSlot(slotId: UUID): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Recurrence rule from which schedules
 * can be (re)generated.
 */
export interface RecurrenceAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'RecurrenceAggregate';
  readonly ownerId: UUID;
  readonly ownerType: ScheduleOwnerType;
  readonly rule: RecurrenceRule;
  readonly status: RecurrenceStatus;
  readonly lastGeneratedAt: ISODateString | null;
  readonly nextRunAt: ISODateString | null;

  pause(resumeAt: ISODateString | null): Result<void, DomainError>;
  resume(): Result<void, DomainError>;
  expire(now: ISODateString): Result<void, DomainError>;
  markGenerated(now: ISODateString, slots: ReadonlyArray<Slot>): Result<void, DomainError>;
}
