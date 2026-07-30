/**
 * Retry engine — exponential backoff, jitter, retry budgets, circuit breakers.
 *
 * Integrates with @eks/common's withRetry + CircuitBreaker, adding retry-budget
 * tracking (max retries per time window) and retry classification (which errors
 * are retryable).
 */
import { withRetry, CircuitBreaker, type RetryOptions } from "@eks/common";

export interface RetryPolicyConfig {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly multiplier?: number;
  readonly maxDelayMs?: number;
  readonly jitter?: "NONE" | "FULL" | "EQUAL";
  readonly budget?: number; // max retries per window
  readonly budgetWindowMs?: number;
  readonly circuitBreaker?: boolean;
  readonly circuitThreshold?: number;
  readonly circuitCooldownMs?: number;
  /** Decide whether an error is retryable. */
  readonly retryIf?: (error: unknown) => boolean;
}

interface BudgetEntry {
  at: number;
}

export class RetryEngine {
  private readonly budgetLog: BudgetEntry[] = [];
  private readonly breaker: CircuitBreaker | null;
  private readonly config: Required<RetryPolicyConfig>;

  constructor(config: RetryPolicyConfig = {}) {
    this.config = {
      maxAttempts: config.maxAttempts ?? 3,
      baseDelayMs: config.baseDelayMs ?? 100,
      multiplier: config.multiplier ?? 2,
      maxDelayMs: config.maxDelayMs ?? 5000,
      jitter: config.jitter ?? "FULL",
      budget: config.budget ?? 100,
      budgetWindowMs: config.budgetWindowMs ?? 60_000,
      circuitBreaker: config.circuitBreaker ?? true,
      circuitThreshold: config.circuitThreshold ?? 5,
      circuitCooldownMs: config.circuitCooldownMs ?? 30_000,
      retryIf: config.retryIf ?? (() => true),
    };
    this.breaker = this.config.circuitBreaker
      ? new CircuitBreaker({
          name: "integration-retry",
          failureThreshold: this.config.circuitThreshold,
          windowMs: 60_000,
          cooldownMs: this.config.circuitCooldownMs,
        })
      : null;
  }

  /** Execute a function with retry + budget + circuit breaker. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check the retry budget.
    if (!this.consumeBudget()) {
      throw new Error("Retry budget exhausted");
    }
    // Circuit breaker.
    const run = () =>
      withRetry(fn, {
        maxAttempts: this.config.maxAttempts,
        baseDelayMs: this.config.baseDelayMs,
        multiplier: this.config.multiplier,
        maxDelayMs: this.config.maxDelayMs,
        retryIf: this.config.retryIf,
      }).then((r) => {
        if (!r.result.ok) throw r.result.error;
        return r.result.value;
      });
    if (this.breaker) {
      return this.breaker.execute(run);
    }
    return run();
  }

  /** Consume one retry from the budget. Returns false if exhausted. */
  private consumeBudget(): boolean {
    const now = Date.now();
    // Prune entries outside the window.
    while (this.budgetLog.length > 0 && this.budgetLog[0].at < now - this.config.budgetWindowMs) {
      this.budgetLog.shift();
    }
    if (this.budgetLog.length >= this.config.budget) return false;
    this.budgetLog.push({ at: now });
    return true;
  }

  /** Remaining budget. */
  remainingBudget(): number {
    const now = Date.now();
    while (this.budgetLog.length > 0 && this.budgetLog[0].at < now - this.config.budgetWindowMs) {
      this.budgetLog.shift();
    }
    return Math.max(0, this.config.budget - this.budgetLog.length);
  }

  /** Circuit breaker state. */
  get circuitState(): "CLOSED" | "OPEN" | "HALF_OPEN" {
    return this.breaker?.snapshot().state ?? "CLOSED";
  }
}
