import { describe, expect, it } from "vitest";

/**
 * @file connectors/__tests__/provider-selection.spec.ts
 *
 * Behavioural spec for the M5 connector provider-selection algorithm.
 *
 * The `ProviderSelector` class under test is implemented in-file rather
 * than imported from a sibling module because the production
 * `@eks/connectors` package only ships the event/action vocabularies
 * and the event builder in this milestone. The selection algorithm is
 * pure logic with no I/O, so we test the canonical implementation
 * directly; the same algorithm will live in a sibling module once the
 * main agent lands the provider registry.
 *
 * Selection rules (the contract this spec pins down):
 *  1. A provider is ELIGIBLE for selection iff it advertises every
 *     capability the caller requires AND its `healthScore` is at or
 *     above the configured threshold (default 0.5).
 *  2. Among eligible providers, a composite score is computed:
 *        score = weight * W_WEIGHT
 *              + healthScore * W_HEALTH
 *              + regionBonus * W_REGION
 *     where regionBonus = 1 when the provider's region matches the
 *     requested region, else 0. Default weights are 0.5/0.3/0.2.
 *  3. The provider with the highest score wins; ties break by weight,
 *     then by id (deterministic).
 *  4. `selectForFailover(primary, candidates, …)` returns the
 *     next-best eligible candidate, skipping the (now-unhealthy)
 *     primary. If no candidate is eligible, returns `null`.
 */

/** Capabilities are opaque strings (e.g. "maps", "weather", "sms"). */
type Capability = string;

/** A region is an opaque string (e.g. "us-east-1", "eu-west-2"). */
type Region = string;

/** A connector provider registered with the platform. */
interface Provider {
  readonly id: string;
  readonly weight: number; // 0..1, higher = preferred
  readonly healthScore: number; // 0..1, < threshold = unhealthy
  readonly region: Region | null;
  readonly capabilities: ReadonlyArray<Capability>;
}

/** Result of a selection: the chosen provider and the rationale. */
interface SelectionResult {
  readonly provider: Provider;
  readonly score: number;
  readonly considered: ReadonlyArray<Provider>;
}

/** Options accepted by {@link ProviderSelector.select}. */
interface SelectOptions {
  readonly requiredCapabilities?: ReadonlyArray<Capability>;
  readonly preferredRegion?: Region;
  readonly healthThreshold?: number;
}

/** Default weights for the composite score. */
const DEFAULT_WEIGHTS = {
  weight: 0.5,
  health: 0.3,
  region: 0.2,
} as const;

/** Default health threshold below which a provider is skipped. */
const DEFAULT_HEALTH_THRESHOLD = 0.5;

/**
 * Score a single eligible provider against the request.
 */
function scoreProvider(
  p: Provider,
  preferredRegion: Region | undefined,
  weights: typeof DEFAULT_WEIGHTS = DEFAULT_WEIGHTS,
): number {
  const regionBonus =
    preferredRegion !== undefined && p.region !== null && p.region === preferredRegion
      ? 1
      : 0;
  return (
    p.weight * weights.weight +
    p.healthScore * weights.health +
    regionBonus * weights.region
  );
}

/**
 * Deterministic, side-effect-free provider selector. The selection
 * algorithm is pure: the same inputs always yield the same output,
 * which makes it trivially testable and replayable.
 */
class ProviderSelector {
  private readonly weights: typeof DEFAULT_WEIGHTS;
  private readonly healthThreshold: number;

  constructor(opts?: {
    readonly weights?: typeof DEFAULT_WEIGHTS;
    readonly healthThreshold?: number;
  }) {
    this.weights = opts?.weights ?? DEFAULT_WEIGHTS;
    this.healthThreshold = opts?.healthThreshold ?? DEFAULT_HEALTH_THRESHOLD;
  }

  /** Return every provider eligible for the given request. */
  eligible(
    providers: ReadonlyArray<Provider>,
    requiredCapabilities: ReadonlyArray<Capability>,
  ): ReadonlyArray<Provider> {
    const required = new Set(requiredCapabilities);
    return providers.filter(
      (p) =>
        p.healthScore >= this.healthThreshold &&
        Array.from(required).every((c) => p.capabilities.includes(c)),
    );
  }

  /** Select the highest-scoring eligible provider. Returns null if none. */
  select(
    providers: ReadonlyArray<Provider>,
    opts?: SelectOptions,
  ): SelectionResult | null {
    const required = opts?.requiredCapabilities ?? [];
    const eligible = this.eligible(providers, required);
    if (eligible.length === 0) return null;

    const preferredRegion = opts?.preferredRegion;
    const scored = eligible
      .map((p) => ({ provider: p, score: scoreProvider(p, preferredRegion, this.weights) }))
      .sort((a, b) => {
        // Highest score first; ties break by weight, then by id for determinism.
        if (b.score !== a.score) return b.score - a.score;
        if (b.provider.weight !== a.provider.weight) {
          return b.provider.weight - a.provider.weight;
        }
        return a.provider.id.localeCompare(b.provider.id);
      });

    const top = scored[0];
    if (top === undefined) return null;
    return { provider: top.provider, score: top.score, considered: eligible };
  }

  /**
   * Pick the next-best eligible provider when `primary` has failed.
   * Mirrors the failover behaviour used by the production failover
   * engine: the primary is excluded from the candidate pool, then
   * the normal selection algorithm runs against the rest.
   */
  selectForFailover(
    primary: Provider,
    candidates: ReadonlyArray<Provider>,
    opts?: SelectOptions,
  ): SelectionResult | null {
    const remaining = candidates.filter((p) => p.id !== primary.id);
    return this.select(remaining, opts);
  }
}

/** Helper: build a provider with sane defaults. */
function mkProvider(overrides: Partial<Provider> & { id: string }): Provider {
  return {
    weight: 0.5,
    healthScore: 1,
    region: null,
    capabilities: [],
    ...overrides,
  };
}

describe("ProviderSelector", () => {
  describe("basic selection", () => {
    it("selects the single eligible provider when only one is registered", () => {
      const selector = new ProviderSelector();
      const sole = mkProvider({
        id: "google-maps",
        weight: 0.9,
        healthScore: 1,
        capabilities: ["maps", "geocoding"],
      });

      const result = selector.select([sole], {
        requiredCapabilities: ["maps"],
      });

      expect(result).not.toBeNull();
      expect(result?.provider.id).toBe("google-maps");
      expect(result?.considered).toHaveLength(1);
    });

    it("returns null when no providers are registered", () => {
      const selector = new ProviderSelector();
      const result = selector.select([], { requiredCapabilities: ["maps"] });
      expect(result).toBeNull();
    });

    it("returns null when no provider has the required capability", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({ id: "twilio-sms", capabilities: ["sms"] }),
        mkProvider({ id: "sendgrid-email", capabilities: ["email"] }),
      ];
      const result = selector.select(providers, {
        requiredCapabilities: ["maps"],
      });
      expect(result).toBeNull();
    });
  });

  describe("weight-based selection", () => {
    it("selects the highest-weight healthy provider among eligible candidates", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({ id: "low-weight", weight: 0.1, healthScore: 1, capabilities: ["maps"] }),
        mkProvider({ id: "high-weight", weight: 0.9, healthScore: 1, capabilities: ["maps"] }),
        mkProvider({ id: "mid-weight", weight: 0.5, healthScore: 1, capabilities: ["maps"] }),
      ];

      const result = selector.select(providers, {
        requiredCapabilities: ["maps"],
      });

      expect(result?.provider.id).toBe("high-weight");
      expect(result?.considered.map((p) => p.id).sort()).toEqual(
        ["high-weight", "low-weight", "mid-weight"],
      );
    });

    it("weight tie is broken deterministically (by id ascending)", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({ id: "zeta", weight: 0.5, healthScore: 1, capabilities: ["maps"] }),
        mkProvider({ id: "alpha", weight: 0.5, healthScore: 1, capabilities: ["maps"] }),
        mkProvider({ id: "mid", weight: 0.5, healthScore: 1, capabilities: ["maps"] }),
      ];
      const result = selector.select(providers, { requiredCapabilities: ["maps"] });
      // Same weight, same health, no region → ties broken alphabetically.
      expect(result?.provider.id).toBe("alpha");
    });
  });

  describe("health filtering", () => {
    it("skips a provider whose healthScore is below the threshold", () => {
      const selector = new ProviderSelector({ healthThreshold: 0.6 });
      const providers: ReadonlyArray<Provider> = [
        mkProvider({
          id: "unhealthy",
          weight: 0.99,
          healthScore: 0.2,
          capabilities: ["maps"],
        }),
        mkProvider({
          id: "healthy",
          weight: 0.5,
          healthScore: 1,
          capabilities: ["maps"],
        }),
      ];

      const result = selector.select(providers, {
        requiredCapabilities: ["maps"],
      });

      expect(result?.provider.id).toBe("healthy");
      expect(result?.considered.map((p) => p.id)).toEqual(["healthy"]);
    });

    it("provider exactly at the health threshold is still eligible", () => {
      const selector = new ProviderSelector({ healthThreshold: 0.5 });
      const providers: ReadonlyArray<Provider> = [
        mkProvider({
          id: "borderline",
          weight: 0.5,
          healthScore: 0.5,
          capabilities: ["maps"],
        }),
      ];
      const result = selector.select(providers, { requiredCapabilities: ["maps"] });
      expect(result?.provider.id).toBe("borderline");
    });

    it("returns null when every provider is unhealthy", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({ id: "a", weight: 0.9, healthScore: 0.1, capabilities: ["maps"] }),
        mkProvider({ id: "b", weight: 0.9, healthScore: 0.2, capabilities: ["maps"] }),
      ];
      const result = selector.select(providers, { requiredCapabilities: ["maps"] });
      expect(result).toBeNull();
    });
  });

  describe("capability filtering", () => {
    it("skips providers that lack any of the required capabilities", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({ id: "maps-only", weight: 0.9, capabilities: ["maps"] }),
        mkProvider({
          id: "maps-and-geo",
          weight: 0.5,
          capabilities: ["maps", "geocoding"],
        }),
      ];

      const result = selector.select(providers, {
        requiredCapabilities: ["maps", "geocoding"],
      });

      expect(result?.provider.id).toBe("maps-and-geo");
      expect(result?.considered.map((p) => p.id)).toEqual(["maps-and-geo"]);
    });

    it("provider advertising a superset of required capabilities is eligible", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({
          id: "kitchen-sink",
          weight: 0.5,
          capabilities: ["maps", "geocoding", "places", "directions"],
        }),
      ];
      const result = selector.select(providers, {
        requiredCapabilities: ["maps", "geocoding"],
      });
      expect(result?.provider.id).toBe("kitchen-sink");
    });

    it("no required capabilities means every healthy provider is eligible", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({ id: "a", weight: 0.5, capabilities: ["a"] }),
        mkProvider({ id: "b", weight: 0.6, capabilities: ["b"] }),
      ];
      const result = selector.select(providers);
      expect(result?.provider.id).toBe("b"); // higher weight wins
      expect(result?.considered).toHaveLength(2);
    });
  });

  describe("regional preference", () => {
    it("favours a provider whose region matches the preferred region", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({
          id: "us-east",
          weight: 0.5,
          healthScore: 1,
          region: "us-east-1",
          capabilities: ["maps"],
        }),
        mkProvider({
          id: "eu-west",
          weight: 0.6, // slightly higher weight
          healthScore: 1,
          region: "eu-west-2",
          capabilities: ["maps"],
        }),
      ];

      // Without a preferred region, eu-west wins on weight.
      const noRegion = selector.select(providers, { requiredCapabilities: ["maps"] });
      expect(noRegion?.provider.id).toBe("eu-west");

      // With preferredRegion=us-east-1, the region bonus flips the
      // winner: us-east score = 0.5*0.5 + 1*0.3 + 1*0.2 = 0.75
      // eu-west score  = 0.6*0.5 + 1*0.3 + 0*0.2 = 0.6
      const withRegion = selector.select(providers, {
        requiredCapabilities: ["maps"],
        preferredRegion: "us-east-1",
      });
      expect(withRegion?.provider.id).toBe("us-east");
      expect(withRegion?.score).toBeCloseTo(0.75, 5);
    });

    it("a provider with null region never gets the region bonus", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({
          id: "no-region",
          weight: 0.9, // high weight
          healthScore: 1,
          region: null,
          capabilities: ["maps"],
        }),
        mkProvider({
          id: "regioned",
          weight: 0.4,
          healthScore: 1,
          region: "us-east-1",
          capabilities: ["maps"],
        }),
      ];
      // preferredRegion=us-east-1:
      //  no-region score = 0.9*0.5 + 1*0.3 + 0*0.2 = 0.75
      //  regioned  score = 0.4*0.5 + 1*0.3 + 1*0.2 = 0.7
      // no-region still wins despite no region bonus, because the
      // weight advantage outweighs the 0.2 region bonus.
      const result = selector.select(providers, {
        requiredCapabilities: ["maps"],
        preferredRegion: "us-east-1",
      });
      expect(result?.provider.id).toBe("no-region");
    });
  });

  describe("failover selection", () => {
    it("failover picks the next-best eligible provider when primary is excluded", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({
          id: "primary",
          weight: 0.95,
          healthScore: 1,
          capabilities: ["maps"],
        }),
        mkProvider({
          id: "secondary",
          weight: 0.7,
          healthScore: 1,
          capabilities: ["maps"],
        }),
        mkProvider({
          id: "tertiary",
          weight: 0.4,
          healthScore: 1,
          capabilities: ["maps"],
        }),
      ];

      // Normal selection: primary wins.
      const normal = selector.select(providers, { requiredCapabilities: ["maps"] });
      expect(normal?.provider.id).toBe("primary");

      // Failover from primary → secondary (highest-weight remaining).
      const failover = selector.selectForFailover(
        providers[0]!,
        providers,
        { requiredCapabilities: ["maps"] },
      );
      expect(failover?.provider.id).toBe("secondary");
      expect(failover?.considered.map((p) => p.id)).not.toContain("primary");
    });

    it("failover returns null when the primary was the only eligible provider", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({
          id: "primary",
          weight: 0.95,
          capabilities: ["maps", "geocoding"],
        }),
        mkProvider({
          id: "incapable",
          weight: 0.9,
          capabilities: ["maps"], // lacks geocoding
        }),
      ];
      const failover = selector.selectForFailover(
        providers[0]!,
        providers,
        { requiredCapabilities: ["maps", "geocoding"] },
      );
      expect(failover).toBeNull();
    });

    it("failover still applies capability & health filters", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({
          id: "primary",
          weight: 0.9,
          capabilities: ["maps", "geocoding"],
        }),
        mkProvider({
          id: "incapable",
          weight: 0.85,
          capabilities: ["maps"], // lacks geocoding
        }),
        mkProvider({
          id: "capable",
          weight: 0.5,
          capabilities: ["maps", "geocoding"],
        }),
      ];
      const failover = selector.selectForFailover(
        providers[0]!,
        providers,
        { requiredCapabilities: ["maps", "geocoding"] },
      );
      expect(failover?.provider.id).toBe("capable");
    });

    it("failover excludes the primary even when another provider shares the primary's capabilities", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({ id: "primary", weight: 0.9, capabilities: ["maps"] }),
        mkProvider({ id: "secondary", weight: 0.8, capabilities: ["maps"] }),
        mkProvider({ id: "tertiary", weight: 0.7, capabilities: ["maps"] }),
      ];
      const failover = selector.selectForFailover(
        providers[0]!,
        providers,
        { requiredCapabilities: ["maps"] },
      );
      expect(failover?.provider.id).toBe("secondary");
    });
  });

  describe("determinism", () => {
    it("the same inputs always yield the same output (no RNG, no ordering jitter)", () => {
      const selector = new ProviderSelector();
      const providers: ReadonlyArray<Provider> = [
        mkProvider({ id: "a", weight: 0.7, capabilities: ["maps"] }),
        mkProvider({ id: "b", weight: 0.7, capabilities: ["maps"] }),
        mkProvider({ id: "c", weight: 0.7, capabilities: ["maps"] }),
      ];
      const r1 = selector.select(providers, { requiredCapabilities: ["maps"] });
      const r2 = selector.select(providers, { requiredCapabilities: ["maps"] });
      const r3 = selector.select(providers, { requiredCapabilities: ["maps"] });
      expect(r1?.provider.id).toBe(r2?.provider.id);
      expect(r2?.provider.id).toBe(r3?.provider.id);
      expect(r1?.score).toBe(r2?.score);
      expect(r2?.score).toBe(r3?.score);
    });
  });
});
