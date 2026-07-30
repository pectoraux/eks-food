/** Health checks — liveness, readiness, and dependency probes. */
import { db } from "@/lib/db";

export interface HealthCheck {
  readonly name: string;
  readonly kind: "liveness" | "readiness";
  /** Returns true if healthy, or { healthy, latencyMs, detail }. */
  run(): Promise<HealthCheckResult>;
}

export interface HealthCheckResult {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly detail?: string;
}

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthReport {
  readonly status: HealthStatus;
  readonly checks: ReadonlyArray<HealthCheckResult & { name: string; kind: string }>;
  readonly timestamp: string;
  readonly uptimeMs: number;
}

export class HealthRegistry {
  private readonly checks: HealthCheck[] = [];
  private readonly startedAt = Date.now();

  register(check: HealthCheck): void {
    this.checks.push(check);
  }

  async run(kind?: "liveness" | "readiness"): Promise<HealthReport> {
    const filtered = kind ? this.checks.filter((c) => c.kind === kind) : this.checks;
    const results = await Promise.all(
      filtered.map(async (c) => {
        const r = await c.run();
        return { ...r, name: c.name, kind: c.kind };
      })
    );
    const anyUnhealthy = results.some((r) => !r.healthy);
    const status: HealthStatus = anyUnhealthy ? "unhealthy" : "healthy";
    return {
      status,
      checks: results,
      timestamp: new Date().toISOString(),
      uptimeMs: Date.now() - this.startedAt,
    };
  }
}

// --- Built-in checks ---

export const databaseHealthCheck: HealthCheck = {
  name: "database",
  kind: "readiness",
  async run(): Promise<HealthCheckResult> {
    const start = performance.now();
    try {
      await db.$queryRaw`SELECT 1`;
      return { healthy: true, latencyMs: Math.round((performance.now() - start) * 100) / 100 };
    } catch (e) {
      return {
        healthy: false,
        latencyMs: Math.round((performance.now() - start) * 100) / 100,
        detail: e instanceof Error ? e.message : "unknown",
      };
    }
  },
};

export const memoryHealthCheck: HealthCheck = {
  name: "memory",
  kind: "liveness",
  async run(): Promise<HealthCheckResult> {
    const used = process.memoryUsage().heapUsed;
    const limit = 512 * 1024 * 1024; // 512MB heuristic
    return {
      healthy: used < limit,
      latencyMs: 0,
      detail: `${Math.round(used / 1024 / 1024)}MB used`,
    };
  },
};

let _registry: HealthRegistry;
export function healthRegistry(): HealthRegistry {
  if (!_registry) {
    _registry = new HealthRegistry();
    _registry.register(databaseHealthCheck);
    _registry.register(memoryHealthCheck);
  }
  return _registry;
}
