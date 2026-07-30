/**
 * @file contexts/analytics/value-objects.ts
 * @package @eks-food/domain/contexts/analytics
 *
 * Analytics bounded context — value objects.
 */

export type {
  ISODateString,
  TimeRange,
  UUID,
} from '../../shared/value-objects';

import type {
  ISODateString,
  TimeRange,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for a Metric.
 */
export type MetricStatus = 'ACTIVE' | 'DEPRECATED';

/**
 * Lifecycle states for a Report.
 */
export type ReportStatus = 'DRAFT' | 'GENERATED' | 'PUBLISHED' | 'ARCHIVED';

/**
 * Lifecycle states for a Signal.
 */
export type SignalStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';

/**
 * Signal severity.
 */
export type SignalSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Branded primitive representing a metric name, e.g.
 * `"bookings.completed.daily.count"`.
 */
export type MetricName = string & { readonly __brand: 'MetricName' };

/**
 * Branded primitive representing a signal type, e.g. `"demand.spike"`.
 */
export type SignalType = string & { readonly __brand: 'SignalType' };

/**
 * Aggregation operator for a metric series.
 */
export type AggregationOp = 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT' | 'P50' | 'P95' | 'P99';

/**
 * A single point in a metric series.
 */
export interface MetricPoint {
  readonly timestamp: ISODateString;
  readonly value: number;
  readonly dimensions: Readonly<Record<string, string>>;
}

/**
 * Definition of a metric (the schema, not a value).
 */
export interface MetricDefinition {
  readonly name: MetricName;
  readonly description: string;
  readonly unit: string;
  readonly aggregation: AggregationOp;
  readonly dimensions: ReadonlyArray<string>;
  readonly status: MetricStatus;
}

/**
 * A single time-series result for a metric.
 */
export interface MetricSeries {
  readonly definition: MetricDefinition;
  readonly range: TimeRange;
  readonly points: ReadonlyArray<MetricPoint>;
  readonly granularity: string;
}

/**
 * A single data row in a report.
 */
export interface ReportRow {
  readonly dimensions: Readonly<Record<string, string>>;
  readonly measures: Readonly<Record<string, number>>;
}

/**
 * A detected signal (anomaly or insight).
 */
export interface SignalRecord {
  readonly id: UUID;
  readonly type: SignalType;
  readonly severity: SignalSeverity;
  readonly subjectType: string;
  readonly subjectId: UUID | null;
  readonly magnitude: number;
  readonly detectedAt: ISODateString;
  readonly status: SignalStatus;
  readonly evidence: Readonly<Record<string, unknown>>;
}
