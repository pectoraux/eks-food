/**
 * @file contexts/optimization/index.ts
 * @package @eks-food/domain/contexts/optimization
 *
 * Optimization bounded context barrel.
 *
 * The optimization context owns mathematical programmes (problems,
 * variables, constraints, objectives) and their solutions. It is the
 * domain-agnostic spine that powers route planning, shift scheduling
 * and procurement splitting. Solver orchestration lives in the
 * optimization connector package.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
