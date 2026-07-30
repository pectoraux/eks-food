/**
 * @file contexts/organization/index.ts
 * @package @eks-food/domain/contexts/organization
 *
 * Organization bounded context barrel.
 *
 * The organization context owns the tenant hierarchy, memberships and
 * feature entitlements. It is the unit of multi-tenancy in Eks-Food:
 * every other context keys its data by `tenantId` produced here.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
