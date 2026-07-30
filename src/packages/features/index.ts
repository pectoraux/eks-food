/**
 * @eks/features — feature flag service.
 *
 * Flags gate every new capability (group purchasing, shared cooking, restaurant
 * marketplace, etc.) so they ship as config, not code. Supports boolean flags,
 * percentage rollouts, and per-org overrides. Persisted in Prisma for production;
 * in-memory fallback for tests.
 */
export type { FeatureFlagKey, FeatureFlag, FlagEvaluation } from "./types";
export { FeatureFlagService, flags, type FlagSource } from "./service";
export { FLAG_KEYS, type FlagKey } from "./keys";
