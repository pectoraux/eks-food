/**
 * @file contexts/marketplace/index.ts
 * @package @eks-food/domain/contexts/marketplace
 *
 * Marketplace bounded context barrel.
 *
 * The marketplace context owns listings (ready meals, surplus
 * inventory, cook experiences) and buyer offers. It is the demand-
 * aggregation surface for the "ready meals" roadmap module.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
