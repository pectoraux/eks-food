/**
 * @file contexts/optimization/value-objects.ts
 * @package @eks-food/domain/contexts/optimization
 *
 * Optimization bounded context — value objects.
 */

export type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';

import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for a Problem.
 */
export type ProblemStatus =
  | 'SUBMITTED'
  | 'SOLVING'
  | 'SOLVED'
  | 'INFEASIBLE'
  | 'TIMED_OUT'
  | 'CANCELLED';

/**
 * Lifecycle states for a Solution.
 */
export type SolutionStatus =
  | 'CANDIDATE'
  | 'OPTIMAL'
  | 'FEASIBLE'
  | 'REJECTED'
  | 'APPLIED';

/**
 * Branded primitive representing a problem type code, e.g.
 * `"vrp.cvrp"` (capacitated vehicle routing), `"shift.scheduling"`.
 */
export type ProblemType = string & { readonly __brand: 'ProblemType' };

/**
 * Direction of optimisation.
 */
export type ObjectiveDirection = 'MINIMIZE' | 'MAXIMIZE';

/**
 * Constraint hardness — hard constraints must be satisfied; soft
 * constraints incur a penalty when violated.
 */
export type ConstraintHardness = 'HARD' | 'SOFT';

/**
 * Branded primitive representing a decision variable name.
 */
export type VariableName = string & { readonly __brand: 'VariableName' };

/**
 * A single variable in an optimisation problem.
 */
export interface DecisionVariable {
  readonly name: VariableName;
  readonly type: 'CONTINUOUS' | 'INTEGER' | 'BINARY' | 'PERMUTATION';
  readonly lowerBound: number | null;
  readonly upperBound: number | null;
  readonly domain?: ReadonlyArray<string>;
}

/**
 * A single constraint on the problem.
 */
export interface Constraint {
  readonly id: UUID;
  readonly name: string;
  readonly hardness: ConstraintHardness;
  readonly expression: string;
  readonly penalty: number | null;
  readonly description?: string;
}

/**
 * Objective function specification.
 */
export interface ObjectiveFunction {
  readonly direction: ObjectiveDirection;
  readonly expression: string;
  readonly weight: number;
}

/**
 * Solver parameters.
 */
export interface SolverParameters {
  readonly timeLimitMs: number;
  readonly optimalityGapPct: number;
  readonly seed: number;
  readonly solverName: string;
  readonly extra: Readonly<Record<string, unknown>>;
}

/**
 * A single decision variable assignment in a solution.
 */
export interface VariableAssignment {
  readonly name: VariableName;
  readonly value: number | string;
}

/**
 * Solver outcome metadata.
 */
export interface SolverOutcome {
  readonly status: SolutionStatus;
  readonly objectiveValue: number;
  readonly optimalityGap: number | null;
  readonly durationMs: number;
  readonly iterations: number;
  readonly solverName: string;
  readonly solvedAt: ISODateString;
}
