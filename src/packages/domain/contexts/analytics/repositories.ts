/**
 * @file contexts/analytics/repositories.ts
 * @package @eks-food/domain/contexts/analytics
 *
 * Analytics bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  TimeRange,
  UUID,
} from '../../shared/value-objects';
import type {
  MetricAggregate,
  ReportAggregate,
  SignalAggregate,
} from './aggregates';
import type {
  MetricName,
  MetricPoint,
  ReportStatus,
  SignalSeverity,
  SignalStatus,
} from './value-objects';

export interface MetricRepository {
  findById(id: UUID): Promise<MetricAggregate | null>;
  findByName(name: MetricName): Promise<MetricAggregate | null>;
  list(
    filter: { tenantId?: UUID | null; deprecated?: boolean },
    page: Page,
  ): Promise<PagedResult<MetricAggregate>>;
  save(agg: MetricAggregate): Promise<Result<void, DomainError>>;
  /**
   * Time-series accessor for the underlying points. Stored separately
   * from the metric definition aggregate so the time-series can grow
   * without bloating the aggregate.
   */
  queryPoints(
    metricId: UUID,
    range: TimeRange,
    granularity: string,
  ): Promise<ReadonlyArray<MetricPoint>>;
}

export interface ReportListFilter {
  readonly tenantId?: UUID;
  readonly reportType?: string;
  readonly status?: ReportStatus;
  readonly generatedBy?: UUID;
}

export interface ReportRepository {
  findById(id: UUID): Promise<ReportAggregate | null>;
  list(filter: ReportListFilter, page: Page): Promise<PagedResult<ReportAggregate>>;
  save(agg: ReportAggregate): Promise<Result<void, DomainError>>;
}

export interface SignalListFilter {
  readonly tenantId?: UUID | null;
  readonly type?: string;
  readonly severity?: SignalSeverity;
  readonly status?: SignalStatus;
  readonly subjectType?: string;
  readonly subjectId?: UUID;
}

export interface SignalRepository {
  findById(id: UUID): Promise<SignalAggregate | null>;
  list(filter: SignalListFilter, page: Page): Promise<PagedResult<SignalAggregate>>;
  save(agg: SignalAggregate): Promise<Result<void, DomainError>>;
}
