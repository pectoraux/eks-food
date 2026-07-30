/**
 * @file contexts/identity/index.ts
 * @package @eks-food/domain/contexts/identity
 *
 * Identity bounded context barrel.
 *
 * The identity context owns authentication, authorisation, sessions and
 * credentials for all platform principals (users, services, API keys).
 * It is the trust root of Eks-Food: every other context depends on the
 * `actorId` it produces but never on its internals.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
