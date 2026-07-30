/**
 * @file contexts/payments/index.ts
 * @package @eks-food/domain/contexts/payments
 *
 * Payments bounded context barrel.
 *
 * The payments context owns the four domain aggregates Payment,
 * Transfer, Refund and Wallet, plus the local ledger. It is a pure
 * domain model — the provider orchestration (Payswap abstraction,
 * Stripe/MoMo adapters, webhook handling) lives in the payments
 * connector package and depends on these types.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
