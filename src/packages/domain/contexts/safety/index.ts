/**
 * @file contexts/safety/index.ts
 * @package @eks-food/domain/contexts/safety
 *
 * Safety bounded context barrel.
 *
 * The safety context owns food-safety inspections, self-submitted
 * checklists and rolling compliance scores. It is the regulatory
 * surface of Eks-Food: critical violations trigger downstream
 * consequences (cook suspension, marketplace listing removal).
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
