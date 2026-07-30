/** Feature flag service with pluggable source (Prisma / in-memory / config). */
import type { FeatureFlag, FeatureFlagKey, FlagEvaluation } from "./types";
import { FLAG_KEYS, type FlagKey } from "./keys";

export interface FlagSource {
  load(): Promise<ReadonlyMap<FeatureFlagKey, FeatureFlag>>;
}

/** In-memory flag source for tests / bootstrap. */
export class InMemoryFlagSource implements FlagSource {
  private readonly flags = new Map<FeatureFlagKey, FeatureFlag>();
  constructor(initial?: Partial<Record<FlagKey, boolean>>) {
    for (const key of FLAG_KEYS) {
      this.flags.set(key, { key, enabled: initial?.[key] ?? false });
    }
  }
  async load(): Promise<ReadonlyMap<FeatureFlagKey, FeatureFlag>> {
    return this.flags;
  }
  set(key: FeatureFlagKey, enabled: boolean): void {
    this.flags.set(key, { key, enabled });
  }
}

export class FeatureFlagService {
  private cache: ReadonlyMap<FeatureFlagKey, FeatureFlag> | null = null;
  private readonly defaults: Record<FeatureFlagKey, boolean> = {
    ai_assistant: true,
    food_intelligence: true,
    procurement: true,
    food_safety_inspections: true,
    group_purchasing: false,
    shared_cooking: false,
    restaurant_marketplace: false,
    ready_meals: false,
    rider_platform: true,
    vendor_marketplace: false,
    developer_platform: true,
    multi_country: false,
  };

  constructor(private readonly source: FlagSource) {}

  async refresh(): Promise<void> {
    this.cache = await this.source.load();
  }

  isEnabled(key: FeatureFlagKey, orgId?: string): boolean {
    return this.evaluate(key, orgId).enabled;
  }

  evaluate(key: FeatureFlagKey, orgId?: string): FlagEvaluation {
    const flag = this.cache?.get(key);
    if (!flag) {
      const def = this.defaults[key] ?? false;
      return { key, enabled: def, reason: def ? "default_on" : "default_off" };
    }
    if (flag.rolloutPercent !== undefined && flag.rolloutPercent < 100) {
      const hash = simpleHash(`${key}:${orgId ?? "global"}`);
      const inRollout = hash % 100 < flag.rolloutPercent;
      return { key, enabled: inRollout && flag.enabled, reason: "rollout" };
    }
    return { key, enabled: flag.enabled, reason: flag.enabled ? "explicit_on" : "explicit_off" };
  }

  async all(): Promise<FeatureFlag[]> {
    if (!this.cache) await this.refresh();
    return FLAG_KEYS.map((k) => this.cache?.get(k) ?? { key: k, enabled: this.defaults[k] ?? false });
  }
}

function simpleHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

let _service: FeatureFlagService | null = null;

/** Singleton flag service. Bootstrapped with an in-memory source by default. */
export function flags(): FeatureFlagService {
  if (!_service) {
    _service = new FeatureFlagService(new InMemoryFlagSource());
  }
  return _service;
}

export function setFlagService(service: FeatureFlagService): void {
  _service = service;
}
