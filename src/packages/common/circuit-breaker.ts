/**
 * Circuit breaker — protects downstream services from cascading failure.
 *
 * States: CLOSED (normal) → OPEN (failing, fast-fail) → HALF_OPEN (probe).
 * Transitions are time- and count-driven. Thread-safe via internal mutation
 * guards; designed for single-process use (distributed coordination belongs
 * in the cache/lock layer).
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  readonly name: string;
  /** Failures within the rolling window that trip the breaker. Default 5. */
  readonly failureThreshold?: number;
  /** Rolling window length in ms. Default 60000. */
  readonly windowMs?: number;
  /** How long to stay OPEN before probing. Default 30000. */
  readonly cooldownMs?: number;
  /** Successful probes in HALF_OPEN required to close. Default 2. */
  readonly halfOpenSuccesses?: number;
  /** Decide which errors count as failures. Default: all. */
  readonly isFailure?: (error: unknown) => boolean;
}

interface FailureRecord {
  readonly at: number;
}

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly halfOpenSuccesses: number;
  private readonly isFailure: (error: unknown) => boolean;

  private state: CircuitState = "CLOSED";
  private failures: FailureRecord[] = [];
  private openedAt = 0;
  private halfOpenSuccessCount = 0;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.halfOpenSuccesses = options.halfOpenSuccesses ?? 2;
    this.isFailure = options.isFailure ?? (() => true);
  }

  get state_(): CircuitState {
    return this.currentState();
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.currentState();
    if (state === "OPEN") {
      throw new CircuitOpenError(this.name);
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      if (this.isFailure(e)) this.onFailure();
      else this.onSuccess();
      throw e;
    }
  }

  private currentState(): CircuitState {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = "HALF_OPEN";
        this.halfOpenSuccessCount = 0;
      }
    }
    return this.state;
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.halfOpenSuccessCount += 1;
      if (this.halfOpenSuccessCount >= this.halfOpenSuccesses) {
        this.state = "CLOSED";
        this.failures = [];
      }
    }
  }

  private onFailure(): void {
    const now = Date.now();
    this.failures.push({ at: now });
    this.failures = this.failures.filter((f) => now - f.at < this.windowMs);
    if (this.state === "HALF_OPEN") {
      this.trip(now);
      return;
    }
    if (this.failures.length >= this.failureThreshold) {
      this.trip(now);
    }
  }

  private trip(now: number): void {
    this.state = "OPEN";
    this.openedAt = now;
    this.halfOpenSuccessCount = 0;
  }

  /** Test/introspection helper. */
  snapshot(): { state: CircuitState; failures: number; name: string } {
    return { state: this.currentState(), failures: this.failures.length, name: this.name };
  }

  /** Reset to CLOSED — for tests / admin forcing. */
  reset(): void {
    this.state = "CLOSED";
    this.failures = [];
    this.openedAt = 0;
    this.halfOpenSuccessCount = 0;
  }
}

export class CircuitOpenError extends Error {
  readonly circuit: string;
  constructor(name: string) {
    super(`Circuit breaker "${name}" is OPEN`);
    this.name = "CircuitOpenError";
    this.circuit = name;
  }
}
