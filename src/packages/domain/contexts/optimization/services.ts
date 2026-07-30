/**
 * @file contexts/optimization/services.ts
 * @package @eks-food/domain/contexts/optimization
 *
 * Optimization bounded context — domain service interfaces.
 *
 * NOTE: The actual solver invocation (CP-SAT, OR-Tools, Gurobi,
 * heuristic routers) lives in the optimization connector package.
 * This file declares domain services that translate domain intents
 * (route my deliveries, schedule my cooks) into ProblemAggregates
 * and translate SolutionAggregates back into applied plans.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { ISODateString, UUID } from '../../shared/value-objects';
import type {
  ProblemAggregate,
  SolutionAggregate,
} from './aggregates';
import type {
  Constraint,
  DecisionVariable,
  ObjectiveFunction,
  SolverParameters,
} from './value-objects';

/**
 * Translates a domain intent (e.g. "route these deliveries") into a
 * fully-formed ProblemAggregate ready for solving.
 */
export interface ProblemFormulator {
  formulateDeliveryRoute(
    tenantId: UUID,
    deliveryIds: ReadonlyArray<UUID>,
    vehicleCount: number,
    parameters: SolverParameters,
    now: ISODateString,
  ): Promise<Result<ProblemAggregate, DomainError>>;
  formulateShiftSchedule(
    tenantId: UUID,
    ownerId: UUID,
    range: { start: ISODateString; end: ISODateString },
    parameters: SolverParameters,
    now: ISODateString,
  ): Promise<Result<ProblemAggregate, DomainError>>;
  formulateProcurementSplit(
    tenantId: UUID,
    requisitionId: UUID,
    parameters: SolverParameters,
    now: ISODateString,
  ): Promise<Result<ProblemAggregate, DomainError>>;
}

/**
 * Applies a Solution back to the originating context (delivery,
 * scheduling, procurement). The implementation lives in the
 * application layer and dispatches to the relevant context's
 * commands.
 */
export interface SolutionApplier {
  apply(solution: SolutionAggregate, now: ISODateString): Promise<Result<void, DomainError>>;
  validate(solution: SolutionAggregate): Result<void, DomainError>;
}

/**
 * Validates that a problem is well-formed before it is sent to the
 * solver (e.g. variables are non-empty, hard constraints are
 * satisfiable in principle).
 */
export interface ProblemValidator {
  validate(problem: ProblemAggregate): Result<void, DomainError>;
}

export type {
  Constraint,
  DecisionVariable,
  ObjectiveFunction,
};
