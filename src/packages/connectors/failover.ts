/**
 * Failover Engine — tries providers in order, falling over on failure.
 * Integrates with the ProviderSelector for ordering, and records the attempt
 * history for observability. Circuit breakers prevent retrying dead providers.
 */
import { CircuitBreaker } from "@eks/common";
import { logger } from "@eks/observability/logger";

export interface FailoverResult<T> {
  readonly value: T;
  readonly providerCode: string;
  readonly attempts: readonly { providerCode: string; success: boolean; error?: string; durationMs: number }[];
}

export class FailoverEngine {
  private readonly breakers = new Map<string, CircuitBreaker>();

  /**
   * Execute a function across a list of providers, failing over on error.
   * Returns the first successful result; throws if all providers fail.
   */
  async execute<T>(
    providers: readonly { code: string }[],
    fn: (providerCode: string) => Promise<T>,
    opts?: { circuitThreshold?: number; circuitCooldownMs?: number },
  ): Promise<FailoverResult<T>> {
    if (providers.length === 0) throw new Error("No providers available");
    const attempts: { providerCode: string; success: boolean; error?: string; durationMs: number }[] = [];

    for (const provider of providers) {
      const breaker = this.getBreaker(provider.code, opts);
      const start = Date.now();
      try {
        const value = await breaker.execute(() => fn(provider.code));
        attempts.push({ providerCode: provider.code, success: true, durationMs: Date.now() - start });
        return { value, providerCode: provider.code, attempts };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        attempts.push({ providerCode: provider.code, success: false, error, durationMs: Date.now() - start });
        logger().warn("connector.failover_attempt", { provider: provider.code, error });
      }
    }
    throw new AllProvidersFailedError(attempts);
  }

  private getBreaker(code: string, opts?: { circuitThreshold?: number; circuitCooldownMs?: number }): CircuitBreaker {
    let breaker = this.breakers.get(code);
    if (!breaker) {
      breaker = new CircuitBreaker({
        name: `connector:${code}`,
        failureThreshold: opts?.circuitThreshold ?? 5,
        windowMs: 60_000,
        cooldownMs: opts?.circuitCooldownMs ?? 30_000,
      });
      this.breakers.set(code, breaker);
    }
    return breaker;
  }
}

export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: readonly { providerCode: string; success: boolean; error?: string }[]) {
    super(`All ${attempts.length} provider(s) failed: ${attempts.map((a) => `${a.providerCode}(${a.error})`).join(", ")}`);
    this.name = "AllProvidersFailedError";
  }
}
