/**
 * @file contexts/foodgraph/index.ts
 * @package @eks-food/domain/contexts/foodgraph
 *
 * Foodgraph bounded context barrel.
 *
 * The foodgraph context owns the food knowledge graph: ingredients,
 * recipes, meals and their nutrition profiles. It is the canonical
 * source of "what is this food" data for the AI, marketplace and
 * analytics contexts.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
