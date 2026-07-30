/**
 * @file contexts/supplier/index.ts
 * @package @eks-food/domain/contexts/supplier
 *
 * Supplier bounded context barrel.
 *
 * The supplier context owns vendors of ingredients and equipment plus
 * their catalogs. It is the upstream partner of the procurement
 * context.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
