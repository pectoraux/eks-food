/**
 * @file contexts/optimization/repositories.ts
 * @package @eks-food/domain/contexts/optimization
 *
 * Optimization bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type { ProblemAggregate, SolutionAggregate } from './aggregates';
import type { ProblemStatus, ProblemType, SolutionStatus } from './value-objects';

export interface ProblemListFilter {
  readonly tenantId?: UUID | null;
  readonly problemType?: ProblemType;
  readonly status?: ProblemStatus;
  readonly submittedBy?: UUID;
}

export interface ProblemRepository {
  findById(id: UUID): Promise<ProblemAggregate | null>;
  list(
    filter: ProblemListFilter,
    page: Page,
  ): Promise<PagedResult<ProblemAggregate>>;
  save(agg: ProblemAggregate): Promise<Result<void, DomainError>>;
}

export interface SolutionListFilter {
  readonly problemId?: UUID;
  readonly status?: SolutionStatus;
}

export interface SolutionRepository {
  findById(id: UUID): Promise<SolutionAggregate | null>;
  listByProblem(problemId: UUID): Promise<ReadonlyArray<SolutionAggregate>>;
  list(
    filter: SolutionListFilter,
    page: Page,
  ): Promise<PagedResult<SolutionAggregate>>;
  save(agg: SolutionAggregate): Promise<Result<void, DomainError>>;
}
