/**
 * @eks/fims — Food Intelligence Management System.
 *
 * The operational food platform: catalog management, recipe scaling, measurement
 * conversion, nutritional intelligence, inventory management, batch tracking,
 * waste tracking, and import/export.
 */

// Domain events + audit actions
export { FIMS_EVENTS, type FimEvent, type FimsEventMeta, buildFimsEvent } from "./events";
export { FIMS_AUDIT_ACTIONS, type FimsAuditAction } from "./audit-actions";

// Recipe scaling
export { RecipeScaler, type ScaledIngredient, type ScaleInput } from "./scaler";

// Measurement conversion
export { MeasurementConverter, type ConversionResult } from "./measurement";

// Nutritional intelligence
export { NutritionCalculator, type RecipeNutrition, type IngredientNutrition } from "./nutrition";

// Inventory management
export { InventoryService, type StockMovement, type MovementType } from "./inventory";

// Catalog management
export { CatalogService, type CatalogSearchQuery } from "./catalog";

// Import/Export
export { ImportService, type ImportResult } from "./import";
