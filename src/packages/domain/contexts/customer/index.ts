/**
 * @file contexts/customer/index.ts
 * @package @eks-food/domain/contexts/customer
 *
 * Customer bounded context barrel.
 *
 * The customer context owns the end-customer persona: addresses,
 * food preferences, dietary restrictions. It is the demand-side
 * counterpart to the cook context.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
