/**
 * @file contexts/safety/value-objects.ts
 * @package @eks-food/domain/contexts/safety
 *
 * Safety bounded context — value objects.
 */

export type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';

import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for an Inspection.
 */
export type InspectionStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

/**
 * Outcome of a completed inspection.
 */
export type InspectionOutcome = 'PASS' | 'PASS_WITH_REMEDIATION' | 'FAIL' | 'CRITICAL_FAIL';

/**
 * Lifecycle states for a Checklist submission.
 */
export type ChecklistStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

/**
 * Severity of a single checklist finding.
 */
export type FindingSeverity = 'INFO' | 'MINOR' | 'MAJOR' | 'CRITICAL';

/**
 * Branded primitive representing a checklist template code.
 */
export type ChecklistType = string & { readonly __brand: 'ChecklistType' };

/**
 * Branded primitive representing an inspectable subject type, e.g.
 * `"cook"`, `"restaurant"`, `"warehouse"`, `"stall"`.
 */
export type InspectableType = string & { readonly __brand: 'InspectableType' };

/**
 * A single finding on an inspection or checklist.
 */
export interface Finding {
  readonly id: UUID;
  readonly severity: FindingSeverity;
  readonly description: string;
  readonly remediation: string | null;
  readonly evidenceUrl?: string;
  readonly resolvedAt: ISODateString | null;
}

/**
 * A single question on a checklist template.
 */
export interface ChecklistItem {
  readonly id: UUID;
  readonly prompt: string;
  readonly required: boolean;
  readonly weight: number;
  readonly expectedResponse: string | null;
}

/**
 * Per-question response on a submitted checklist.
 */
export interface ChecklistResponse {
  readonly itemId: UUID;
  readonly response: string;
  readonly notes?: string;
  readonly evidenceUrl?: string;
}

/**
 * Snapshot of a subject's compliance posture.
 */
export interface ComplianceSnapshot {
  readonly subjectType: InspectableType;
  readonly subjectId: UUID;
  readonly score: number;
  readonly band: ComplianceBand;
  readonly openFindings: number;
  readonly lastInspectionAt: ISODateString | null;
  readonly updatedAt: ISODateString;
}

/**
 * Categorical compliance band.
 */
export type ComplianceBand = 'A' | 'B' | 'C' | 'D' | 'F';
