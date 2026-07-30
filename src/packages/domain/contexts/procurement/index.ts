/**
 * @file contexts/procurement/index.ts
 * @package @eks-food/domain/contexts/procurement
 *
 * Procurement bounded context barrel.
 *
 * The procurement context owns requisitions and supplier orders. It
 * powers the "group purchasing" roadmap module by aggregating demand
 * across tenants and splitting orders across suppliers.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
