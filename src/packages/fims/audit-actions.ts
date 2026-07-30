/**
 * @file fims/audit-actions.ts
 * @package @eks/fims
 *
 * FIMS audit action codes.
 *
 * Responsibility:
 *  - Define the canonical set of audit action codes emitted by the
 *    Food Intelligence & Management System (FIMS) layer. Every
 *    security- and operations-relevant FIMS action (catalog item
 *    lifecycle, ingredient variant creation, recipe authoring,
 *    scaling, staging, versioning, menu authoring & bundling,
 *    nutrition calculation, allergen detection, dietary
 *    classification, inventory adjustments, receipts, transfers,
 *    reservations, audits, batch creation, expiration, recall, waste
 *    recording, stock movements, catalog import/export, measurement
 *    conversion, taxonomy updates, and entity deletion) is recorded
 *    in the immutable audit log with one of these codes so analysts,
 *    SIEM integrations, compliance reports and food-safety
 *    authorities can pivot on a stable, enumerable vocabulary.
 *
 * Constraints:
 *  - Codes are uppercase SNAKE_CASE, distinct from the canonical
 *    domain event names (which are `{Aggregate}.{Verb}`) — audit
 *    actions capture the actor-side intent AND the negative outcomes
 *    that never mutate an aggregate (e.g. `BATCH_EXPIRED`,
 *    `WASTE_RECORDED`, `INVENTORY_AUDIT_COMPLETED`).
 *  - Codes are stable and append-only; never re-use a retired code.
 *  - No `any`, no runtime side effects — pure constant.
 */

/**
 * Canonical FIMS audit action codes. Append-only.
 *
 * The single source of truth for what gets written to the audit log's
 * `action` column whenever a FIMS operation occurs. Downstream
 * consumers (SIEM, compliance reports, anomaly detection, food safety
 * authorities, inventory reconciliation) MUST reference these
 * constants rather than spelling out the literal string.
 */
export const FIMS_AUDIT_ACTIONS = {
  // Catalog item lifecycle
  CATALOG_ITEM_ADDED: "CATALOG_ITEM_ADDED",
  CATALOG_ITEM_UPDATED: "CATALOG_ITEM_UPDATED",
  CATALOG_ITEM_PUBLISHED: "CATALOG_ITEM_PUBLISHED",

  // Ingredient variants
  INGREDIENT_VARIANT_CREATED: "INGREDIENT_VARIANT_CREATED",

  // Recipe lifecycle
  RECIPE_CREATED: "RECIPE_CREATED",
  RECIPE_UPDATED: "RECIPE_UPDATED",
  RECIPE_PUBLISHED: "RECIPE_PUBLISHED",
  RECIPE_VERSION_CREATED: "RECIPE_VERSION_CREATED",
  RECIPE_SCALED: "RECIPE_SCALED",
  RECIPE_STAGE_ADDED: "RECIPE_STAGE_ADDED",
  RECIPE_DELETED: "RECIPE_DELETED",

  // Menu lifecycle
  MENU_CREATED: "MENU_CREATED",
  MENU_UPDATED: "MENU_UPDATED",
  MENU_PUBLISHED: "MENU_PUBLISHED",
  MENU_VERSION_CREATED: "MENU_VERSION_CREATED",
  MENU_ITEM_ADDED: "MENU_ITEM_ADDED",
  MENU_BUNDLE_CREATED: "MENU_BUNDLE_CREATED",
  MENU_DELETED: "MENU_DELETED",

  // Nutrition, allergens, dietary classification
  NUTRITION_CALCULATED: "NUTRITION_CALCULATED",
  ALLERGEN_DETECTED: "ALLERGEN_DETECTED",
  DIETARY_CLASSIFIED: "DIETARY_CLASSIFIED",

  // Inventory lifecycle
  INVENTORY_ADJUSTED: "INVENTORY_ADJUSTED",
  INVENTORY_RECEIVED: "INVENTORY_RECEIVED",
  INVENTORY_TRANSFERRED: "INVENTORY_TRANSFERRED",
  INVENTORY_RESERVED: "INVENTORY_RESERVED",
  INVENTORY_AUDIT_COMPLETED: "INVENTORY_AUDIT_COMPLETED",
  INVENTORY_DELETED: "INVENTORY_DELETED",

  // Batch lifecycle
  BATCH_CREATED: "BATCH_CREATED",
  BATCH_EXPIRED: "BATCH_EXPIRED",

  // Waste & stock movements
  WASTE_RECORDED: "WASTE_RECORDED",
  STOCK_MOVEMENT_RECORDED: "STOCK_MOVEMENT_RECORDED",

  // Catalog import/export
  CATALOG_IMPORTED: "CATALOG_IMPORTED",
  CATALOG_EXPORTED: "CATALOG_EXPORTED",

  // Measurement & taxonomy
  MEASUREMENT_CONVERTED: "MEASUREMENT_CONVERTED",
  TAXONOMY_UPDATED: "TAXONOMY_UPDATED",
} as const;

/** Union type of every FIMS audit action code. */
export type FimsAuditAction =
  (typeof FIMS_AUDIT_ACTIONS)[keyof typeof FIMS_AUDIT_ACTIONS];
