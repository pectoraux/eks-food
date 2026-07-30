/**
 * @file contexts/analytics/services.ts
 * @package @eks-food/domain/contexts/analytics
 *
 * Analytics bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  TimeRange,
  UUID,
} from '../../shared/value-objects';
import type { MetricSeries, ReportRow, SignalRecord } from './value-objects';

/**
 * Aggregates raw metric points into time-bucketed series. Used by the
 * report generator and the dashboard back-end.
 */
export interface MetricQueryService {
  query(
    metricName: string,
    range: TimeRange,
    granularity: string,
    dimensions?: Readonly<Record<string, string>>,
  ): Promise<Result<MetricSeries, DomainError>>;
  compare(
    metricName: string,
    baseline: TimeRange,
    comparison: TimeRange,
    granularity: string,
  ): Promise<Result<{ baseline: MetricSeries; comparison: MetricSeries; deltaPct: number }, DomainError>>;
}

/**
 * Materialises a ReportAggregate from a set of metric queries and a
 * row template. Used by scheduled and on-demand report jobs.
 */
export interface ReportBuilder {
  build(
    tenantId: UUID,
    reportType: string,
    title: string,
    description: string,
    requestedBy: UUID,
    queries: ReadonlyArray<{
      metricName: string;
      range: TimeRange;
      granularity: string;
    }>,
    now: ISODateString,
  ): Promise<Result<ReadonlyArray<ReportRow>, DomainError>>;
}

/**
 * Detects anomalies in metric streams and produces SignalRecords.
 * Implementation lives in the application layer (and may delegate to
 * the ai context for forecasting).
 */
export interface SignalDetector {
  scan(
    tenantId: UUID,
    metricName: string,
    range: TimeRange,
  ): Promise<Result<ReadonlyArray<SignalRecord>, DomainError>>;
  classify(signal: SignalRecord): SignalRecord['severity'];
}

export type { UUID };
