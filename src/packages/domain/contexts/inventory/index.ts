/**
 * @file contexts/inventory/index.ts
 * @package @eks-food/domain/contexts/inventory
 *
 * Inventory bounded context barrel.
 *
 * The inventory context owns stock levels, movements (audit) and
 * warehouses. It is consumer of the procurement context (inbound
 * movements on receipt) and supplier to the safety context (expiry
 * signals) and the booking context (consumption reservations).
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
