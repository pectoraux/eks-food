/**
 * @file contexts/analytics/index.ts
 * @package @eks-food/domain/contexts/analytics
 *
 * Analytics bounded context barrel.
 *
 * The analytics context owns metrics (definitions + time series),
 * reports (snapshots) and signals (anomalies/insights). It is the
 * platform's measurement surface — every other context emits metrics
 * here.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
