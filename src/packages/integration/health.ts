/**
 * Health monitoring — every connector reports latency, availability, sync lag,
 * error rates, retry rates, and throughput.
 */
import { db } from "@/lib/db";

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "OFFLINE";

export interface HealthReport {
  readonly configId: string;
  readonly status: HealthStatus;
  readonly latencyMs: number;
  readonly errorRate: number;
  readonly retryRate: number;
  readonly throughput: number;
  readonly syncLagSec: number;
  readonly availability: number;
  readonly reportedAt: Date;
}

export class HealthMonitor {
  /** Report a health metric for a connector configuration. */
  async report(input: Omit<HealthReport, "reportedAt">): Promise<void> {
    await db.connectorHealth.create({
      data: {
        configId: input.configId,
        status: input.status,
        latencyMs: input.latencyMs,
        errorRate: input.errorRate,
        retryRate: input.retryRate,
        throughput: input.throughput,
        syncLagSec: input.syncLagSec,
        availability: input.availability,
        reportedAt: new Date(),
      },
    });
  }

  /** Get the latest health report for a connector. */
  async latest(configId: string): Promise<HealthReport | null> {
    const latest = await db.connectorHealth.findFirst({
      where: { configId },
      orderBy: { reportedAt: "desc" },
    });
    if (!latest) return null;
    return {
      configId: latest.configId,
      status: latest.status as HealthStatus,
      latencyMs: latest.latencyMs,
      errorRate: latest.errorRate,
      retryRate: latest.retryRate,
      throughput: latest.throughput,
      syncLagSec: latest.syncLagSec,
      availability: latest.availability,
      reportedAt: latest.reportedAt,
    };
  }

  /** Get health for all connectors in an organization (health dashboard). */
  async dashboard(organizationId: string): Promise<readonly HealthReport[]> {
    // Get the latest health report per configId.
    const configs = await db.connectorConfigurationV2.findMany({
      where: { organizationId },
      include: { health: { orderBy: { reportedAt: "desc" }, take: 1 } },
    });
    const reports: HealthReport[] = [];
    for (const config of configs) {
      if (config.health[0]) {
        const h = config.health[0];
        reports.push({
          configId: config.id,
          status: h.status as HealthStatus,
          latencyMs: h.latencyMs,
          errorRate: h.errorRate,
          retryRate: h.retryRate,
          throughput: h.throughput,
          syncLagSec: h.syncLagSec,
          availability: h.availability,
          reportedAt: h.reportedAt,
        });
      }
    }
    return reports;
  }

  /** Compute an aggregate status from metrics. */
  computeStatus(metrics: { latencyMs: number; errorRate: number; availability: number }): HealthStatus {
    if (metrics.availability < 0.95 || metrics.errorRate > 0.1) return "UNHEALTHY";
    if (metrics.availability < 0.99 || metrics.errorRate > 0.05 || metrics.latencyMs > 5000) return "DEGRADED";
    return "HEALTHY";
  }
}
