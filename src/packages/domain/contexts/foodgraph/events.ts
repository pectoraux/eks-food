/**
 * @file contexts/foodgraph/events.ts
 * @package @eks-food/domain/contexts/foodgraph
 *
 * Foodgraph bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for the food knowledge graph:
 *    ingredients, recipes, meals and nutrition records. The AI and
 *    analytics contexts subscribe to power recommendation and
 *    demand-signal modelling.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface IngredientCreatedEvent extends DomainEvent {
  readonly eventType: 'foodgraph.ingredient.created.v1';
  readonly name: string;
  readonly category: string;
  readonly createdAt: ISODateString;
}

export interface RecipePublishedEvent extends DomainEvent {
  readonly eventType: 'foodgraph.recipe.published.v1';
  readonly title: string;
  readonly ingredientCount: number;
  readonly publishedAt: ISODateString;
}

export interface MealOnboardedEvent extends DomainEvent {
  readonly eventType: 'foodgraph.meal.onboarded.v1';
  readonly mealId: UUID;
  readonly cuisine: string;
  readonly onboardedAt: ISODateString;
}

export interface NutritionComputedEvent extends DomainEvent {
  readonly eventType: 'foodgraph.nutrition.computed.v1';
  readonly subjectType: string;
  readonly subjectId: UUID;
  readonly computedAt: ISODateString;
  readonly modelVersion: string;
}
