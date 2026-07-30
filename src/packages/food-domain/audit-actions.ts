/**
 * @file food-domain/audit-actions.ts
 * @package @eks/food-domain
 *
 * Food-domain audit action codes.
 *
 * Responsibility:
 *  - Define the canonical set of audit action codes emitted by the
 *    food-domain layer. Every security- and operations-relevant
 *    food-domain action (customer/household lifecycle, cook
 *    certification, restaurant & kitchen registration, ingredient &
 *    recipe authoring, menu management, inventory adjustments, asset
 *    & logistics registration, supplier & vendor onboarding,
 *    certification lifecycle, inspection scheduling & completion,
 *    food-safety incident reporting & resolution, nutrition profile
 *    creation, Food Intelligence Graph mutations, entity versioning,
 *    import/export, search indexing, and entity deletion) is recorded
 *    in the immutable audit log with one of these codes so analysts,
 *    SIEM integrations and compliance reports can pivot on a stable,
 *    enumerable vocabulary.
 *
 * Constraints:
 *  - Codes are uppercase SNAKE_CASE, distinct from the canonical
 *    domain event names (which are `{Aggregate}.{Verb}`) — audit
 *    actions capture the actor-side intent AND the negative outcomes
 *    that never mutate an aggregate (e.g. `CERTIFICATION_EXPIRED`,
 *    `CERTIFICATION_REVOKED`, `FOOD_SAFETY_INCIDENT_REPORTED`).
 *  - Codes are stable and append-only; never re-use a retired code.
 *  - No `any`, no runtime side effects — pure constant.
 */

/**
 * Canonical food-domain audit action codes. Append-only.
 *
 * The single source of truth for what gets written to the audit log's
 * `action` column whenever a food-domain operation occurs. Downstream
 * consumers (SIEM, compliance reports, anomaly detection, food safety
 * authorities) MUST reference these constants rather than spelling out
 * the literal string.
 */
export const FOOD_DOMAIN_AUDIT_ACTIONS = {
  // Customer & household lifecycle
  CUSTOMER_CREATED: "CUSTOMER_CREATED",
  CUSTOMER_UPDATED: "CUSTOMER_UPDATED",
  HOUSEHOLD_CREATED: "HOUSEHOLD_CREATED",
  HOUSEHOLD_MEMBER_ADDED: "HOUSEHOLD_MEMBER_ADDED",

  // Cook lifecycle
  COOK_PROFILE_CREATED: "COOK_PROFILE_CREATED",
  COOK_CERTIFIED: "COOK_CERTIFIED",

  // Restaurant & kitchen lifecycle
  RESTAURANT_REGISTERED: "RESTAURANT_REGISTERED",
  KITCHEN_CREATED: "KITCHEN_CREATED",
  KITCHEN_CERTIFIED: "KITCHEN_CERTIFIED",

  // Ingredient & recipe lifecycle
  INGREDIENT_ADDED: "INGREDIENT_ADDED",
  INGREDIENT_UPDATED: "INGREDIENT_UPDATED",
  RECIPE_CREATED: "RECIPE_CREATED",
  RECIPE_UPDATED: "RECIPE_UPDATED",
  RECIPE_VERSION_PUBLISHED: "RECIPE_VERSION_PUBLISHED",

  // Menu lifecycle
  MENU_ITEM_ADDED: "MENU_ITEM_ADDED",
  MENU_UPDATED: "MENU_UPDATED",

  // Inventory lifecycle
  INVENTORY_ADJUSTED: "INVENTORY_ADJUSTED",
  INVENTORY_BATCH_RECEIVED: "INVENTORY_BATCH_RECEIVED",

  // Asset & logistics lifecycle
  EQUIPMENT_REGISTERED: "EQUIPMENT_REGISTERED",
  VEHICLE_REGISTERED: "VEHICLE_REGISTERED",

  // Supplier & vendor lifecycle
  SUPPLIER_REGISTERED: "SUPPLIER_REGISTERED",
  VENDOR_REGISTERED: "VENDOR_REGISTERED",

  // Certification & inspection lifecycle
  CERTIFICATION_ISSUED: "CERTIFICATION_ISSUED",
  CERTIFICATION_EXPIRED: "CERTIFICATION_EXPIRED",
  CERTIFICATION_REVOKED: "CERTIFICATION_REVOKED",
  INSPECTION_SCHEDULED: "INSPECTION_SCHEDULED",
  INSPECTION_COMPLETED: "INSPECTION_COMPLETED",

  // Food safety incident lifecycle
  FOOD_SAFETY_INCIDENT_REPORTED: "FOOD_SAFETY_INCIDENT_REPORTED",
  FOOD_SAFETY_INCIDENT_RESOLVED: "FOOD_SAFETY_INCIDENT_RESOLVED",

  // Nutrition
  NUTRITION_PROFILE_CREATED: "NUTRITION_PROFILE_CREATED",

  // Food Intelligence Graph
  RELATIONSHIP_CREATED: "RELATIONSHIP_CREATED",
  RELATIONSHIP_REMOVED: "RELATIONSHIP_REMOVED",
  GRAPH_NODE_CREATED: "GRAPH_NODE_CREATED",
  GRAPH_EDGE_CREATED: "GRAPH_EDGE_CREATED",

  // Entity lifecycle (versioning, import/export, search, deletion)
  ENTITY_VERSION_CREATED: "ENTITY_VERSION_CREATED",
  ENTITY_IMPORTED: "ENTITY_IMPORTED",
  ENTITY_EXPORTED: "ENTITY_EXPORTED",
  SEARCH_INDEXED: "SEARCH_INDEXED",
  ENTITY_DELETED: "ENTITY_DELETED",
} as const;

/** Union type of every food-domain audit action code. */
export type FoodDomainAuditAction =
  (typeof FOOD_DOMAIN_AUDIT_ACTIONS)[keyof typeof FOOD_DOMAIN_AUDIT_ACTIONS];
