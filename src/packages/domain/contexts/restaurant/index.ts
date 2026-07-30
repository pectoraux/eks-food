/**
 * @file contexts/restaurant/index.ts
 * @package @eks-food/domain/contexts/restaurant
 *
 * Restaurant bounded context barrel.
 *
 * The restaurant context owns physical food-service venues and their
 * menus. It is distinct from the vendor context (which owns shared-
 * kitchen stalls) and the cook context (which owns individuals).
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
