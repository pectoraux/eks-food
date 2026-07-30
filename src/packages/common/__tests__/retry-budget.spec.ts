import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * RetryBudget — a pure-logic concept for bounding the number of
 * retries that may be attempted against a target (a connector, a sync
 * run, an external API) within a sliding time window. The budget is
 * "spent" by `tryConsume()` calls and refilled when the window
 * elapses; once exhausted further retries are rejected so callers
 * fast-fail instead of piling on load.
 *
 * Implemented in the test file because @eks/integration's runtime
 * pieces (retry engine, rate limiter) are landing concurrently and
 * may not yet be importable. This gives us a deterministic,
 * well-tested building block the runtime can later adopt.
 */

export interface RetryBudgetOptions {
  /** Maximum retries permitted inside the rolling window. */
  readonly maxRetries: number;
  /** Rolling window length in ms. */
  readonly windowMs: number;
  /** Inject now() (default: Date.now). */
  readonly now?: () => number;
}

export class RetryBudget {
  readonly maxRetries: number;
  readonly windowMs: number;
  private readonly now: () => number;
  private windowStart: number;
  private spent: number;

  constructor(opts: RetryBudgetOptions) {
    if (!Number.isFinite(opts.maxRetries) || opts.maxRetries <= 0) {
      throw new RangeError("maxRetries must be a positive finite number");
    }
    if (!Number.isFinite(opts.windowMs) || opts.windowMs <= 0) {
      throw new RangeError("windowMs must be a positive finite number");
    }
    this.maxRetries = opts.maxRetries;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? (() => Date.now());
    this.windowStart = this.now();
    this.spent = 0;
  }

  /** Attempt to consume one retry slot. Returns true if allowed. */
  tryConsume(): boolean {
    this.maybeRollWindow();
    if (this.spent >= this.maxRetries) return false;
    this.spent += 1;
    return true;
  }

  /** Whether the budget currently has any remaining retries. */
  get remaining(): number {
    this.maybeRollWindow();
    return Math.max(0, this.maxRetries - this.spent);
  }

  /** Snapshot of the budget state (for introspection / metrics). */
  snapshot(): { remaining: number; spent: number; windowStart: number } {
    this.maybeRollWindow();
    return {
      remaining: Math.max(0, this.maxRetries - this.spent),
      spent: this.spent,
      windowStart: this.windowStart,
    };
  }

  /** Force a window reset (admin override / test helper). */
  reset(): void {
    this.windowStart = this.now();
    this.spent = 0;
  }

  private maybeRollWindow(): void {
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.spent = 0;
    }
  }
}

describe("RetryBudget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to maxRetries within the window then rejects", () => {
    const budget = new RetryBudget({ maxRetries: 10, windowMs: 60_000 });
    for (let i = 0; i < 10; i++) {
      expect(budget.tryConsume()).toBe(true);
    }
    // 11th attempt is rejected.
    expect(budget.tryConsume()).toBe(false);
  });

  it("remaining reflects consumed slots", () => {
    const budget = new RetryBudget({ maxRetries: 10, windowMs: 60_000 });
    expect(budget.remaining).toBe(10);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.remaining).toBe(9);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.remaining).toBe(8);
  });

  it("snapshot reports spent, remaining, and windowStart", () => {
    const budget = new RetryBudget({ maxRetries: 5, windowMs: 60_000 });
    budget.tryConsume();
    budget.tryConsume();
    const snap = budget.snapshot();
    expect(snap.spent).toBe(2);
    expect(snap.remaining).toBe(3);
    expect(snap.windowStart).toBe(Date.now());
  });

  it("resets the budget after the window elapses", () => {
    const budget = new RetryBudget({ maxRetries: 3, windowMs: 60_000 });

    // Burn through the entire budget.
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);
    expect(budget.remaining).toBe(0);

    // Advance just past the 60s window — budget should reset.
    vi.setSystemTime(Date.now() + 60_001);
    expect(budget.remaining).toBe(3);
    expect(budget.tryConsume()).toBe(true);
  });

  it("does NOT reset before the window elapses", () => {
    const budget = new RetryBudget({ maxRetries: 2, windowMs: 60_000 });
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);

    // 59 seconds — window not yet elapsed.
    vi.setSystemTime(Date.now() + 59_999);
    expect(budget.tryConsume()).toBe(false);
    expect(budget.remaining).toBe(0);

    // Exactly 60s — boundary resets.
    vi.setSystemTime(Date.now() + 1);
    expect(budget.tryConsume()).toBe(true);
  });

  it("reset() forces a fresh window immediately", () => {
    const budget = new RetryBudget({ maxRetries: 2, windowMs: 60_000 });
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);

    budget.reset();
    expect(budget.remaining).toBe(2);
    expect(budget.tryConsume()).toBe(true);
  });

  it("supports an injected now() for fully deterministic control", () => {
    let clock = 1_000;
    const budget = new RetryBudget({
      maxRetries: 1,
      windowMs: 100,
      now: () => clock,
    });

    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);

    // Move clock past window.
    clock += 101;
    expect(budget.tryConsume()).toBe(true);
  });

  it("rejects non-positive maxRetries at construction", () => {
    expect(() => new RetryBudget({ maxRetries: 0, windowMs: 60_000 })).toThrow(RangeError);
    expect(() => new RetryBudget({ maxRetries: -1, windowMs: 60_000 })).toThrow(RangeError);
    expect(() => new RetryBudget({ maxRetries: NaN, windowMs: 60_000 })).toThrow(RangeError);
    expect(() => new RetryBudget({ maxRetries: Infinity, windowMs: 60_000 })).toThrow(RangeError);
  });

  it("rejects non-positive windowMs at construction", () => {
    expect(() => new RetryBudget({ maxRetries: 5, windowMs: 0 })).toThrow(RangeError);
    expect(() => new RetryBudget({ maxRetries: 5, windowMs: -1 })).toThrow(RangeError);
    expect(() => new RetryBudget({ maxRetries: 5, windowMs: NaN })).toThrow(RangeError);
    expect(() => new RetryBudget({ maxRetries: 5, windowMs: Infinity })).toThrow(RangeError);
  });

  it("multiple windows behave independently across many cycles", () => {
    const budget = new RetryBudget({ maxRetries: 3, windowMs: 60_000 });

    // Cycle 1
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);

    vi.setSystemTime(Date.now() + 60_000);
    // Cycle 2 — fresh budget.
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);

    vi.setSystemTime(Date.now() + 60_000);
    // Cycle 3 — fresh budget again.
    expect(budget.remaining).toBe(3);
    expect(budget.tryConsume()).toBe(true);
  });

  it("never returns a negative remaining", () => {
    const budget = new RetryBudget({ maxRetries: 1, windowMs: 60_000 });
    budget.tryConsume();
    budget.tryConsume(); // rejected, but should not drive remaining negative
    budget.tryConsume();
    expect(budget.remaining).toBe(0);
    expect(budget.snapshot().remaining).toBe(0);
  });
});
