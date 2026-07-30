/**
 * @file contexts/scheduling/value-objects.ts
 * @package @eks-food/domain/contexts/scheduling
 *
 * Scheduling bounded context — value objects.
 */

export type {
  ISODateString,
  TimeRange,
  UUID,
} from '../../shared/value-objects';

import type { ISODateString, UUID } from '../../shared/value-objects';

/**
 * Lifecycle states for a Slot.
 */
export type SlotStatus = 'OPEN' | 'HELD' | 'BOOKED' | 'CLOSED' | 'CANCELLED';

/**
 * Lifecycle states for a Schedule.
 */
export type ScheduleStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

/**
 * Lifecycle states for a Recurrence rule.
 */
export type RecurrenceStatus = 'ACTIVE' | 'PAUSED' | 'EXPIRED';

/**
 * The kind of owner a slot/schedule belongs to. The scheduling context
 * is owner-agnostic so the same primitives serve cooks, restaurants
 * and stalls.
 */
export type ScheduleOwnerType = 'cook' | 'restaurant' | 'stall';

/**
 * RFC 5545 RRULE string, e.g. `"FREQ=WEEKLY;BYDAY=MO,WE,FR"`.
 */
export type Rrule = string & { readonly __brand: 'Rrule' };

/**
 * A single time slot.
 */
export interface Slot {
  readonly id: UUID;
  readonly ownerId: UUID;
  readonly ownerType: ScheduleOwnerType;
  readonly start: ISODateString;
  readonly end: ISODateString;
  readonly status: SlotStatus;
  readonly capacity: number;
  readonly bookedCount: number;
}

/**
 * A recurrence rule with its termination conditions.
 */
export interface RecurrenceRule {
  readonly rrule: Rrule;
  readonly startAnchor: ISODateString;
  readonly until: ISODateString | null;
  readonly count: number | null;
  readonly interval: number;
}
