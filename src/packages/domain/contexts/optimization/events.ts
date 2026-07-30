/**
 * @file contexts/optimization/events.ts
 * @package @eks-food/domain/contexts/optimization
 *
 * Optimization bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for optimisation problems, their
 *    solutions and the constraints that feed them. Consumers
 *    (delivery, scheduling, procurement) subscribe to solution-ready
 *    events to apply the optimised plans.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface ProblemSubmittedEvent extends DomainEvent {
  readonly eventType: 'optimization.problem.submitted.v1';
  readonly problemType: string;
  readonly submittedAt: ISODateString;
  readonly constraintCount: number;
}

export interface SolutionFoundEvent extends DomainEvent {
  readonly eventType: 'optimization.solution.found.v1';
  readonly objectiveValue: number;
  readonly optimalityGap: number | null;
  readonly solvedAt: ISODateString;
  readonly solverDurationMs: number;
}

export interface SolutionAppliedEvent extends DomainEvent {
  readonly eventType: 'optimization.solution.applied.v1';
  readonly appliedTo: string;
  readonly appliedAt: ISODateString;
}

export interface ProblemTimedOutEvent extends DomainEvent {
  readonly eventType: 'optimization.problem.timed_out.v1';
  readonly timeoutMs: number;
  readonly timedOutAt: ISODateString;
}
