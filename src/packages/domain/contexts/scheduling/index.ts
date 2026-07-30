/**
 * @file contexts/scheduling/index.ts
 * @package @eks-food/domain/contexts/scheduling
 *
 * Scheduling bounded context barrel.
 *
 * The scheduling context owns time slots, schedules and recurrence
 * rules. It is owner-agnostic so the same primitives serve cooks,
 * restaurants and stalls. The booking context consumes slots to
 * enforce time-window exclusivity.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
