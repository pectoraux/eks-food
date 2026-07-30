/**
 * @file contexts/safety/repositories.ts
 * @package @eks-food/domain/contexts/safety
 *
 * Safety bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  ChecklistAggregate,
  ComplianceScoreAggregate,
  InspectionAggregate,
} from './aggregates';
import type {
  ChecklistStatus,
  ChecklistType,
  InspectableType,
  InspectionOutcome,
  InspectionStatus,
} from './value-objects';

export interface InspectionListFilter {
  readonly tenantId?: UUID;
  readonly subjectType?: InspectableType;
  readonly subjectId?: UUID;
  readonly inspectorId?: UUID;
  readonly status?: InspectionStatus;
  readonly outcome?: InspectionOutcome;
  readonly from?: string;
  readonly to?: string;
}

export interface InspectionRepository {
  findById(id: UUID): Promise<InspectionAggregate | null>;
  list(
    filter: InspectionListFilter,
    page: Page,
  ): Promise<PagedResult<InspectionAggregate>>;
  save(agg: InspectionAggregate): Promise<Result<void, DomainError>>;
}

export interface ChecklistListFilter {
  readonly tenantId?: UUID;
  readonly subjectType?: InspectableType;
  readonly subjectId?: UUID;
  readonly submittedBy?: UUID;
  readonly type?: ChecklistType;
  readonly status?: ChecklistStatus;
}

export interface ChecklistRepository {
  findById(id: UUID): Promise<ChecklistAggregate | null>;
  list(
    filter: ChecklistListFilter,
    page: Page,
  ): Promise<PagedResult<ChecklistAggregate>>;
  save(agg: ChecklistAggregate): Promise<Result<void, DomainError>>;
}

export interface ComplianceScoreRepository {
  findById(id: UUID): Promise<ComplianceScoreAggregate | null>;
  findBySubject(
    subjectType: InspectableType,
    subjectId: UUID,
  ): Promise<ComplianceScoreAggregate | null>;
  list(
    filter: {
      tenantId?: UUID;
      subjectType?: InspectableType;
      minScore?: number;
      maxScore?: number;
    },
    page: Page,
  ): Promise<PagedResult<ComplianceScoreAggregate>>;
  save(agg: ComplianceScoreAggregate): Promise<Result<void, DomainError>>;
}
