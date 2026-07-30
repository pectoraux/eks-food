/**
 * @file contexts/scheduling/events.ts
 * @package @eks-food/domain/contexts/scheduling
 *
 * Scheduling bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for slots, schedules and recurrences.
 *    The booking context subscribes to slot availability changes to
 *    refresh the matcher's index.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface SlotOpenedEvent extends DomainEvent {
  readonly eventType: 'scheduling.slot.opened.v1';
  readonly ownerId: UUID;
  readonly start: ISODateString;
  readonly end: ISODateString;
}

export interface SlotClosedEvent extends DomainEvent {
  readonly eventType: 'scheduling.slot.closed.v1';
  readonly reason: string;
}

export interface ScheduleGeneratedEvent extends DomainEvent {
  readonly eventType: 'scheduling.schedule.generated.v1';
  readonly scheduleId: UUID;
  readonly slotCount: number;
  readonly recurrenceId: UUID | null;
}

export interface RecurrencePausedEvent extends DomainEvent {
  readonly eventType: 'scheduling.recurrence.paused.v1';
  readonly pausedAt: ISODateString;
  readonly resumeAt: ISODateString | null;
}
