import type { FlagKey } from "./keys";

export type FeatureFlagKey = FlagKey;

export interface FeatureFlag {
  readonly key: FeatureFlagKey;
  readonly enabled: boolean;
  readonly rolloutPercent?: number;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface FlagEvaluation {
  readonly key: FeatureFlagKey;
  readonly enabled: boolean;
  readonly reason: "explicit_off" | "explicit_on" | "rollout" | "default_off" | "default_on";
}
