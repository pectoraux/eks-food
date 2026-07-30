/**
 * @file contexts/analytics/events.ts
 * @package @eks-food/domain/contexts/analytics
 *
 * Analytics bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for metrics, reports and signals.
 *    Signals are derived anomalies (spikes, drops, drifts) that other
 *    contexts subscribe to for proactive action.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface MetricIngestedEvent extends DomainEvent {
  readonly eventType: 'analytics.metric.ingested.v1';
  readonly metricName: string;
  readonly value: number;
  readonly ingestedAt: ISODateString;
}

export interface ReportGeneratedEvent extends DomainEvent {
  readonly eventType: 'analytics.report.generated.v1';
  readonly reportId: UUID;
  readonly reportType: string;
  readonly generatedAt: ISODateString;
}

export interface SignalDetectedEvent extends DomainEvent {
  readonly eventType: 'analytics.signal.detected.v1';
  readonly signalType: string;
  readonly subjectType: string;
  readonly subjectId: UUID;
  readonly magnitude: number;
  readonly detectedAt: ISODateString;
}

export interface ReportSharedEvent extends DomainEvent {
  readonly eventType: 'analytics.report.shared.v1';
  readonly reportId: UUID;
  readonly sharedWith: UUID;
  readonly sharedAt: ISODateString;
}
