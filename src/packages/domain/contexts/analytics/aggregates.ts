/**
 * @file contexts/analytics/aggregates.ts
 * @package @eks-food/domain/contexts/analytics
 *
 * Analytics bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  MetricDefinition,
  MetricName,
  MetricPoint,
  ReportRow,
  ReportStatus,
  SignalRecord,
  SignalStatus,
  SignalType,
} from './value-objects';

/**
 * Aggregate root representing a Metric definition and its ingestion
 * buffer. Concrete points are stored separately; this aggregate is the
 * authoritative source of the metric's schema.
 */
export interface MetricAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'MetricAggregate';
  readonly tenantId: UUID | null;
  readonly definition: MetricDefinition;
  readonly lastIngestedAt: ISODateString | null;
  readonly pointCount: number;

  ingest(point: MetricPoint, now: ISODateString): Result<void, DomainError>;
  deprecate(): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Report: a snapshot of one or more
 * metric series plus a set of rows.
 */
export interface ReportAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'ReportAggregate';
  readonly tenantId: UUID;
  readonly reportType: string;
  readonly title: string;
  readonly description: string;
  readonly status: ReportStatus;
  readonly rows: ReadonlyArray<ReportRow>;
  readonly generatedBy: UUID;
  readonly generatedAt: ISODateString | null;
  readonly publishedAt: ISODateString | null;
  readonly sharedWith: ReadonlyArray<UUID>;

  generate(rows: ReadonlyArray<ReportRow>, now: ISODateString): Result<void, DomainError>;
  publish(now: ISODateString): Result<void, DomainError>;
  archive(): Result<void, DomainError>;
  shareWith(userId: UUID): Result<void, DomainError>;
  unshareWith(userId: UUID): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Signal: a derived anomaly or insight
 * that requires human attention. Signals are produced by domain
 * services and consumed by the notifications context.
 */
export interface SignalAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'SignalAggregate';
  readonly tenantId: UUID | null;
  readonly record: SignalRecord;
  readonly acknowledgedBy: UUID | null;
  readonly acknowledgedAt: ISODateString | null;
  readonly resolvedAt: ISODateString | null;
  readonly resolutionNote: string | null;

  acknowledge(userId: UUID, now: ISODateString): Result<void, DomainError>;
  resolve(note: string, now: ISODateString): Result<void, DomainError>;
  markFalsePositive(note: string, now: ISODateString): Result<void, DomainError>;
  reopen(reason: string): Result<void, DomainError>;
}

export type { MetricName, SignalType, SignalStatus };
