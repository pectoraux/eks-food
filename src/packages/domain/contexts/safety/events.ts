/**
 * @file contexts/safety/events.ts
 * @package @eks-food/domain/contexts/safety
 *
 * Safety bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for inspections, checklists and
 *    compliance scores. The cook context subscribes to suspend cooks
 *    on critical violations; the notifications context alerts
 *    inspectors.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface InspectionScheduledEvent extends DomainEvent {
  readonly eventType: 'safety.inspection.scheduled.v1';
  readonly inspectableType: string;
  readonly inspectableId: UUID;
  readonly scheduledFor: ISODateString;
}

export interface InspectionCompletedEvent extends DomainEvent {
  readonly eventType: 'safety.inspection.completed.v1';
  readonly outcome: string;
  readonly score: number;
  readonly completedAt: ISODateString;
}

export interface ChecklistSubmittedEvent extends DomainEvent {
  readonly eventType: 'safety.checklist.submitted.v1';
  readonly checklistType: string;
  readonly submittedBy: UUID;
  readonly submittedAt: ISODateString;
}

export interface ComplianceScoreUpdatedEvent extends DomainEvent {
  readonly eventType: 'safety.compliance.score.updated.v1';
  readonly subjectType: string;
  readonly subjectId: UUID;
  readonly previousScore: number;
  readonly newScore: number;
  readonly updatedAt: ISODateString;
}
