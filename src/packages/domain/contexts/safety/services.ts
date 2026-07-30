/**
 * @file contexts/safety/services.ts
 * @package @eks-food/domain/contexts/safety
 *
 * Safety bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { ISODateString, UUID } from '../../shared/value-objects';
import type {
  ComplianceScoreAggregate,
  InspectionAggregate,
} from './aggregates';
import type { Finding, InspectableType } from './value-objects';

/**
 * Schedules the next inspection for a subject based on its current
 * compliance band, the time since the last inspection, and the
 * subject's risk profile.
 */
export interface InspectionScheduler {
  nextInspectionWindow(
    subjectType: InspectableType,
    subjectId: UUID,
    now: ISODateString,
  ): Promise<Result<{ scheduledFor: ISODateString; reason: string }, DomainError>>;
  scheduleBatch(
    tenantId: UUID,
    now: ISODateString,
  ): Promise<Result<ReadonlyArray<InspectionAggregate>, DomainError>>;
}

/**
 * Recommends remediation actions for a set of findings, possibly
 * calling out to the AI context for natural-language guidance.
 */
export interface RemediationAdvisor {
  recommend(
    findings: ReadonlyArray<Finding>,
  ): Promise<Result<ReadonlyArray<{ findingId: UUID; recommendedAction: string; priority: number }>, DomainError>>;
}

/**
 * Recomputes a subject's compliance score from its full inspection
 * and checklist history. Used by backfill jobs and after data fixes.
 */
export interface ComplianceScoreRecomputeService {
  recompute(
    subjectType: InspectableType,
    subjectId: UUID,
  ): Promise<Result<ComplianceScoreAggregate, DomainError>>;
}
