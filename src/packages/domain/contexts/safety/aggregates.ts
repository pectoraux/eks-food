/**
 * @file contexts/safety/aggregates.ts
 * @package @eks-food/domain/contexts/safety
 *
 * Safety bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  ChecklistResponse,
  ChecklistStatus,
  ChecklistType,
  ComplianceBand,
  ComplianceSnapshot,
  Finding,
  InspectableType,
  InspectionOutcome,
  InspectionStatus,
} from './value-objects';

/**
 * Aggregate root representing an Inspection of a single subject
 * (cook, restaurant, warehouse, stall).
 */
export interface InspectionAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'InspectionAggregate';
  readonly tenantId: UUID;
  readonly subjectType: InspectableType;
  readonly subjectId: UUID;
  readonly inspectorId: UUID;
  readonly status: InspectionStatus;
  readonly scheduledFor: ISODateString;
  readonly startedAt: ISODateString | null;
  readonly completedAt: ISODateString | null;
  readonly outcome: InspectionOutcome | null;
  readonly score: number | null;
  readonly findings: ReadonlyArray<Finding>;
  readonly reportUrl: string | null;

  start(now: ISODateString): Result<void, DomainError>;
  complete(
    outcome: InspectionOutcome,
    score: number,
    findings: ReadonlyArray<Finding>,
    now: ISODateString,
  ): Result<void, DomainError>;
  cancel(reason: string): Result<void, DomainError>;
  markNoShow(now: ISODateString): Result<void, DomainError>;
  resolveFinding(findingId: UUID, now: ISODateString): Result<void, DomainError>;
}

/**
 * Aggregate root representing a self-submitted Checklist (e.g. daily
 * food-safety checklist completed by a cook).
 */
export interface ChecklistAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'ChecklistAggregate';
  readonly tenantId: UUID;
  readonly type: ChecklistType;
  readonly subjectType: InspectableType;
  readonly subjectId: UUID;
  readonly submittedBy: UUID;
  readonly status: ChecklistStatus;
  readonly responses: ReadonlyArray<ChecklistResponse>;
  readonly submittedAt: ISODateString | null;
  readonly reviewedBy: UUID | null;
  readonly reviewedAt: ISODateString | null;
  readonly findings: ReadonlyArray<Finding>;

  submit(responses: ReadonlyArray<ChecklistResponse>, now: ISODateString): Result<void, DomainError>;
  approve(reviewer: UUID, now: ISODateString): Result<void, DomainError>;
  reject(reviewer: UUID, reason: string, now: ISODateString): Result<void, DomainError>;
  addFinding(finding: Finding): Result<void, DomainError>;
}

/**
 * Aggregate root representing the rolling compliance score of a
 * subject. Updated whenever an inspection is completed or a
 * checklist is approved/rejected.
 */
export interface ComplianceScoreAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'ComplianceScoreAggregate';
  readonly tenantId: UUID;
  readonly subjectType: InspectableType;
  readonly subjectId: UUID;
  readonly score: number;
  readonly band: ComplianceBand;
  readonly openFindings: number;
  readonly lastInspectionAt: ISODateString | null;
  readonly lastUpdatedBy: UUID | null;
  readonly updatedAt: ISODateString;

  applyInspection(
    outcome: InspectionOutcome,
    score: number,
    findings: ReadonlyArray<Finding>,
    actor: UUID,
    now: ISODateString,
  ): Result<void, DomainError>;
  applyChecklist(
    approved: boolean,
    findings: ReadonlyArray<Finding>,
    actor: UUID,
    now: ISODateString,
  ): Result<void, DomainError>;
  resolveFinding(findingId: UUID, now: ISODateString): Result<void, DomainError>;
}

export type { ComplianceSnapshot };
