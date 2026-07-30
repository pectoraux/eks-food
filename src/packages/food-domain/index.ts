/**
 * @eks/food-domain — Canonical Food Domain Model & Food Intelligence Graph.
 *
 * The shared source of truth for every subsystem. Every entity has lifecycle
 * management, versioning, auditing, events, APIs, validation, search,
 * relationships, localization, and extensibility.
 */

// Domain events + audit actions
export { FOOD_DOMAIN_EVENTS, type FoodDomainEvent, type FoodDomainEventMeta, buildFoodDomainEvent } from "./events";
export { FOOD_DOMAIN_AUDIT_ACTIONS, type FoodDomainAuditAction } from "./audit-actions";

// Graph engine
export { GraphEngine, type GraphNode, type GraphEdge, type TraversalResult, type PathResult } from "./graph";

// Search
export { SearchEngine, type SearchResult, type SearchQuery } from "./search";

// Domain services
export { DomainService, type EntityInput, type EntityUpdate } from "./service";
