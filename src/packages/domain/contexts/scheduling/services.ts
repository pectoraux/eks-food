/**
 * @file contexts/scheduling/services.ts
 * @package @eks-food/domain/contexts/scheduling
 *
 * Scheduling bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { ISODateString, UUID } from '../../shared/value-objects';
import type {
  RecurrenceAggregate,
  ScheduleAggregate,
  SlotAggregate,
} from './aggregates';

/**
 * Materialises a recurrence rule into a concrete list of slots within
 * a window. The implementation lives in the application layer (it
 * needs an iCalendar library to expand RRULEs); this interface is the
 * domain contract.
 */
export interface RecurrenceExpander {
  expand(
    recurrence: RecurrenceAggregate,
    from: ISODateString,
    to: ISODateString,
  ): Result<ReadonlyArray<{ start: ISODateString; end: ISODateString }>, DomainError>;
}

/**
 * Builds a fresh ScheduleAggregate from an expansion result.
 */
export interface ScheduleBuilder {
  build(
    ownerId: UUID,
    ownerType: 'cook' | 'restaurant' | 'stall',
    name: string,
    slotWindows: ReadonlyArray<{ start: ISODateString; end: ISODateString }>,
  ): Result<ScheduleAggregate, DomainError>;
}

/**
 * Resolves scheduling conflicts across owners (e.g. a cook cannot have
 * overlapping slots). Used by the booking context to validate slot
 * holds.
 */
export interface ConflictResolver {
  findConflicts(
    ownerId: UUID,
    from: ISODateString,
    to: ISODateString,
  ): Promise<ReadonlyArray<SlotAggregate>>;
}
