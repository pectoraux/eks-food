/**
 * @file contexts/optimization/aggregates.ts
 * @package @eks-food/domain/contexts/optimization
 *
 * Optimization bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  Constraint,
  DecisionVariable,
  ObjectiveFunction,
  ProblemStatus,
  ProblemType,
  SolutionStatus,
  SolverOutcome,
  SolverParameters,
  VariableAssignment,
} from './value-objects';

/**
 * Aggregate root representing an optimisation Problem: a set of
 * decision variables, constraints, an objective function and solver
 * parameters. May produce one or more candidate Solutions.
 */
export interface ProblemAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'ProblemAggregate';
  readonly tenantId: UUID | null;
  readonly problemType: ProblemType;
  readonly status: ProblemStatus;
  readonly variables: ReadonlyArray<DecisionVariable>;
  readonly constraints: ReadonlyArray<Constraint>;
  readonly objective: ObjectiveFunction;
  readonly parameters: SolverParameters;
  readonly submittedAt: ISODateString;
  readonly submittedBy: UUID;
  readonly solvedAt: ISODateString | null;
  readonly failureReason: string | null;

  addVariable(variable: DecisionVariable): Result<void, DomainError>;
  addConstraint(constraint: Constraint): Result<void, DomainError>;
  setObjective(objective: ObjectiveFunction): Result<void, DomainError>;
  startSolving(now: ISODateString): Result<void, DomainError>;
  markSolved(now: ISODateString): Result<void, DomainError>;
  markInfeasible(reason: string, now: ISODateString): Result<void, DomainError>;
  markTimedOut(now: ISODateString): Result<void, DomainError>;
  cancel(reason: string): Result<void, DomainError>;
}

/**
 * Aggregate root representing a Solution to a Problem.
 */
export interface SolutionAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'SolutionAggregate';
  readonly problemId: UUID;
  readonly status: SolutionStatus;
  readonly assignments: ReadonlyArray<VariableAssignment>;
  readonly outcome: SolverOutcome;
  readonly appliedTo: string | null;
  readonly appliedAt: ISODateString | null;
  readonly rejectionReason: string | null;

  markOptimal(): Result<void, DomainError>;
  markFeasible(): Result<void, DomainError>;
  reject(reason: string): Result<void, DomainError>;
  applyTo(target: string, now: ISODateString): Result<void, DomainError>;
}
