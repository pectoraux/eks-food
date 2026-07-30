/**
 * @file contexts/cook/index.ts
 * @package @eks-food/domain/contexts/cook
 *
 * Cook bounded context barrel.
 *
 * The cook context owns the supply-side persona: certifications,
 * availability, pricing, service area and reputation. It is the
 * counterpart to the customer context and the primary data source for
 * the matching engine.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
