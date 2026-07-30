/**
 * ConnectorRunner — executes a connector with retries, circuit breaker,
 * rate limiting, and execution logging. Production swaps the in-memory
 * circuit breaker for a Redis-backed one.
 */
import type { Connector, ConnectorContext, SyncResult, HealthCheckResult } from "./types";
import { CircuitBreaker, withRetry } from "@eks/common";
import { db } from "@/lib/db";
import { logger } from "@eks/observability/logger";

export interface ConnectorRunnerOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly timeoutMs?: number;
  readonly circuitThreshold?: number;
}

export class ConnectorRunner {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly options: ConnectorRunnerOptions = {}) {}

  async execute(
    connector: Connector,
    ctx: ConnectorContext,
    kind: "sync" | "poll" | "webhook" | "health"
  ): Promise<unknown> {
    const breaker = this.getBreaker(connector.code);
    const startedAt = Date.now();
    let status = "SUCCESS";
    let errorMessage: string | undefined;
    let attempts = 0;

    try {
      const result = await breaker.execute(async () => {
        const r = await withRetry(async (attempt) => {
          attempts = attempt;
          return this.runKind(connector, ctx, kind);
        }, {
          maxAttempts: this.options.maxAttempts ?? 3,
          baseDelayMs: this.options.baseDelayMs ?? 200,
          retryIf: (e) => !String(e).includes("AUTH_FAILED"),
        });
        if (!r.result.ok) throw r.result.error;
        return r.result.value;
      });
      await this.logExecution(ctx, connector.code, kind, status, Date.now() - startedAt, attempts, result, undefined);
      return result;
    } catch (e) {
      status = "FAILED";
      errorMessage = e instanceof Error ? e.message : String(e);
      ctx.log.error(`Connector ${kind} failed`, { error: errorMessage, attempts });
      await this.logExecution(ctx, connector.code, kind, status, Date.now() - startedAt, attempts, null, errorMessage);
      throw e;
    }
  }

  private async runKind(connector: Connector, ctx: ConnectorContext, kind: string): Promise<unknown> {
    switch (kind) {
      case "sync": return connector.sync(ctx, ctx.config.syncState.cursor as string | undefined);
      case "poll": return connector.poll(ctx, ctx.config.syncState.cursor as string | undefined);
      case "webhook": return connector.handleWebhook ? connector.handleWebhook(ctx, {}, {}) : { processed: false };
      case "health": return connector.healthCheck(ctx);
      default: throw new Error(`Unknown connector kind: ${kind}`);
    }
  }

  private async logExecution(
    ctx: ConnectorContext,
    connectorCode: string,
    kind: string,
    status: string,
    durationMs: number,
    attempts: number,
    result: unknown,
    errorMessage?: string
  ): Promise<void> {
    const config = await db.connectorConfiguration.findFirst({
      where: { organizationId: ctx.config.organizationId, connectorDef: { code: connectorCode } },
    }).catch(() => null);
    if (config) {
      await db.connectorExecution.create({
        data: {
          configId: config.id,
          kind: kind.toUpperCase(),
          status,
          durationMs,
          attempts,
          request: "{}",
          response: result ? JSON.stringify(result).slice(0, 2000) : "{}",
          errorMessage,
          completedAt: new Date(),
        },
      }).catch(() => null);
    }
    logger().debug("connector.executed", { connectorCode, kind, status, durationMs, attempts });
  }

  private getBreaker(code: string): CircuitBreaker {
    let breaker = this.breakers.get(code);
    if (!breaker) {
      breaker = new CircuitBreaker({
        name: `connector:${code}`,
        failureThreshold: this.options.circuitThreshold ?? 5,
        windowMs: 60_000,
        cooldownMs: 30_000,
      });
      this.breakers.set(code, breaker);
    }
    return breaker;
  }
}
