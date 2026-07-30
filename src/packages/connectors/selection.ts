/**
 * Provider Selection Engine — intelligent routing to the best provider.
 *
 * Supports: weighted routing, health-based routing, regional routing, tenant
 * preferences, failover, cost-aware routing, capability matching. Business logic
 * never knows which provider was used.
 */
import { db } from "@/lib/db";
import { logger } from "@eks/observability/logger";

export interface ProviderCandidate {
  readonly id: string;
  readonly code: string;
  readonly category: string;
  readonly weight: number;
  readonly healthScore: number;
  readonly regions: readonly string[];
  readonly capabilities: readonly string[];
  readonly status: string;
}

export interface SelectionContext {
  readonly organizationId: string;
  readonly category: string;
  readonly requiredCapability?: string;
  readonly region?: string;
  readonly tenantPreference?: string; // preferred provider code
}

export interface SelectionResult {
  readonly provider: ProviderCandidate;
  readonly reason: string;
  readonly alternatives: readonly ProviderCandidate[];
}

export class ProviderSelector {
  /**
   * Select the best provider for a given context. Scoring:
   *  - tenant preference: +1000 (always preferred if healthy)
   *  - health score: * 10 (0-100 → 0-1000)
   *  - weight: * 1 (0-100)
   *  - region match: +50
   *  - capability match: +100 (required, so if missing → excluded)
   *  - cost: -0.01 * costPer1k (cheaper is better)
   */
  async select(ctx: SelectionContext): Promise<SelectionResult | null> {
    const providers = await this.loadProviders(ctx.category, ctx.organizationId);
    if (providers.length === 0) return null;

    // Filter: must be ACTIVE, have the required capability, and be healthy enough.
    const eligible = providers.filter((p) => {
      if (p.status !== "ACTIVE") return false;
      if (p.healthScore < 20) return false; // circuit-breaker threshold
      if (ctx.requiredCapability && !p.capabilities.includes(ctx.requiredCapability)) return false;
      if (ctx.region && p.regions.length > 0 && !p.regions.includes(ctx.region) && !p.regions.includes("global")) return false;
      return true;
    });
    if (eligible.length === 0) return null;

    // Score each eligible provider.
    const scored = eligible.map((p) => {
      let score = p.healthScore * 10 + p.weight;
      if (ctx.tenantPreference && p.code === ctx.tenantPreference) score += 1000;
      if (ctx.region && (p.regions.includes(ctx.region) || p.regions.includes("global"))) score += 50;
      return { provider: p, score };
    });
    scored.sort((a, b) => b.score - a.score);

    const winner = scored[0];
    const alternatives = scored.slice(1).map((s) => s.provider);

    logger().debug("provider.selected", {
      category: ctx.category,
      provider: winner.provider.code,
      score: winner.score,
      alternatives: alternatives.length,
    });

    return {
      provider: winner.provider,
      reason: ctx.tenantPreference && winner.provider.code === ctx.tenantPreference
        ? "TENANT_PREFERENCE"
        : ctx.requiredCapability
          ? "CAPABILITY_MATCH"
          : "HIGHEST_SCORE",
      alternatives,
    };
  }

  /** Record a provider failure (lowers health score). */
  async recordFailure(providerId: string): Promise<void> {
    const health = await db.providerHealth.findFirst({
      where: { providerId },
      orderBy: { reportedAt: "desc" },
    });
    if (health) {
      const newScore = Math.max(0, health.score - 10);
      const newConsecutive = health.consecutiveFailures + 1;
      const status = newScore < 20 ? "UNHEALTHY" : newScore < 50 ? "DEGRADED" : "HEALTHY";
      await db.providerHealth.create({
        data: {
          providerId,
          status,
          score: newScore,
          latencyMs: health.latencyMs,
          errorRate: Math.min(1, health.errorRate + 0.1),
          successRate: Math.max(0, health.successRate - 0.1),
          consecutiveFailures: newConsecutive,
        },
      });
    }
  }

  /** Record a provider success (raises health score). */
  async recordSuccess(providerId: string, latencyMs: number): Promise<void> {
    const health = await db.providerHealth.findFirst({
      where: { providerId },
      orderBy: { reportedAt: "desc" },
    });
    if (health) {
      const newScore = Math.min(100, health.score + 2);
      const status = newScore >= 80 ? "HEALTHY" : newScore >= 50 ? "DEGRADED" : "UNHEALTHY";
      await db.providerHealth.create({
        data: {
          providerId,
          status,
          score: newScore,
          latencyMs,
          errorRate: Math.max(0, health.errorRate - 0.02),
          successRate: Math.min(1, health.successRate + 0.02),
          consecutiveFailures: 0,
        },
      });
    }
  }

  private async loadProviders(category: string, _orgId: string): Promise<readonly ProviderCandidate[]> {
    const providers = await db.externalProvider.findMany({
      where: { category },
      include: {
        health: { orderBy: { reportedAt: "desc" }, take: 1 },
        capabilities2: { where: { supported: true } },
      },
    });
    return providers.map((p) => ({
      id: p.id,
      code: p.code,
      category: p.category,
      weight: p.weight,
      healthScore: p.health[0]?.score ?? 100,
      regions: JSON.parse(p.regions) as string[],
      capabilities: p.capabilities2.map((c) => c.code),
      status: p.status,
    }));
  }
}
