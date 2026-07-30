/**
 * @file contexts/vendor/index.ts
 * @package @eks-food/domain/contexts/vendor
 *
 * Vendor bounded context barrel.
 *
 * The vendor context owns shared-kitchen operators and their rentable
 * stalls. It enables the "shared cooking" roadmap module.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
