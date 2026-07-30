import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitState,
} from "../circuit-breaker";

/**
 * Extended CircuitBreaker coverage — exercises the HALF_OPEN probe
 * lifecycle, the halfOpenSuccesses threshold, re-opening on probe
 * failure, and reset() — paths not covered by the existing common.spec
 * suite.
 *
 * Fake timers are used because the breaker's cooldown / window logic
 * is driven by `Date.now()`. We control the clock so transitions are
 * deterministic and the suite runs in milliseconds rather than
 * waiting out real cooldowns.
 */
describe("CircuitBreaker — HALF_OPEN lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions OPEN → HALF_OPEN after cooldown elapses", async () => {
    const cb = new CircuitBreaker({
      name: "test-half-open-transition",
      failureThreshold: 2,
      windowMs: 10_000,
      cooldownMs: 1000,
      halfOpenSuccesses: 2,
    });

    const failing = async (): Promise<never> => {
      throw new Error("boom");
    };

    // Trip the breaker — two failures within the window.
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.snapshot().state).toBe("OPEN");

    // Halfway through the cooldown — still OPEN.
    vi.setSystemTime(Date.now() + 500);
    expect(cb.snapshot().state).toBe("OPEN");

    // Just past the cooldown — snapshot() should observe the transition.
    vi.setSystemTime(Date.now() + 501);
    expect(cb.snapshot().state).toBe("HALF_OPEN");
  });

  it("a successful probe in HALF_OPEN does NOT immediately close (requires halfOpenSuccesses)", async () => {
    // halfOpenSuccesses = 3 → three consecutive successes required.
    const cb = new CircuitBreaker({
      name: "test-probe-threshold",
      failureThreshold: 1,
      windowMs: 10_000,
      cooldownMs: 1000,
      halfOpenSuccesses: 3,
    });

    const failing = async (): Promise<never> => {
      throw new Error("boom");
    };
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.snapshot().state).toBe("OPEN");

    // Advance past cooldown → HALF_OPEN.
    vi.setSystemTime(Date.now() + 1001);
    expect(cb.snapshot().state).toBe("HALF_OPEN");

    // 1st successful probe — still HALF_OPEN.
    await cb.execute(async () => "ok-1");
    expect(cb.snapshot().state).toBe("HALF_OPEN");

    // 2nd successful probe — still HALF_OPEN.
    await cb.execute(async () => "ok-2");
    expect(cb.snapshot().state).toBe("HALF_OPEN");

    // 3rd successful probe — now CLOSED.
    await cb.execute(async () => "ok-3");
    expect(cb.snapshot().state).toBe("CLOSED");
  });

  it("a failure in HALF_OPEN re-opens the breaker immediately", async () => {
    const cb = new CircuitBreaker({
      name: "test-reopen",
      failureThreshold: 1,
      windowMs: 10_000,
      cooldownMs: 1000,
      halfOpenSuccesses: 3,
    });

    const failing = async (): Promise<never> => {
      throw new Error("boom");
    };
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.snapshot().state).toBe("OPEN");

    // Advance past cooldown → HALF_OPEN.
    vi.setSystemTime(Date.now() + 1001);
    expect(cb.snapshot().state).toBe("HALF_OPEN");

    // One successful probe — still HALF_OPEN.
    await cb.execute(async () => "ok-1");
    expect(cb.snapshot().state).toBe("HALF_OPEN");

    // A failure should re-trip the breaker (any prior half-open progress is lost).
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.snapshot().state).toBe("OPEN");

    // And subsequent calls fast-fail with CircuitOpenError until cooldown elapses again.
    await expect(cb.execute(async () => "never")).rejects.toThrow(CircuitOpenError);
  });

  it("reset() forces CLOSED and clears all failure state when OPEN", async () => {
    const cb = new CircuitBreaker({
      name: "test-reset-open",
      failureThreshold: 2,
      windowMs: 10_000,
      cooldownMs: 1000,
      halfOpenSuccesses: 2,
    });

    const failing = async (): Promise<never> => {
      throw new Error("boom");
    };
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.snapshot().state).toBe("OPEN");
    expect(cb.snapshot().failures).toBeGreaterThanOrEqual(2);

    cb.reset();
    const snap = cb.snapshot();
    expect(snap.state).toBe("CLOSED");
    expect(snap.failures).toBe(0);

    // After reset, a successful op runs without CircuitOpenError.
    const result = await cb.execute(async () => "ok");
    expect(result).toBe("ok");
    expect(cb.snapshot().state).toBe("CLOSED");
  });

  it("reset() clears HALF_OPEN probe state too", async () => {
    const cb = new CircuitBreaker({
      name: "test-reset-halfopen",
      failureThreshold: 2,
      windowMs: 10_000,
      cooldownMs: 1000,
      halfOpenSuccesses: 5,
    });

    const failing = async (): Promise<never> => {
      throw new Error("boom");
    };
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.snapshot().state).toBe("OPEN");

    // Advance to HALF_OPEN and rack up a couple of probe successes.
    vi.setSystemTime(Date.now() + 1001);
    expect(cb.snapshot().state).toBe("HALF_OPEN");
    await cb.execute(async () => "ok-1");
    await cb.execute(async () => "ok-2");

    // Reset wipes the half-open progress.
    cb.reset();
    expect(cb.snapshot().state).toBe("CLOSED");

    // The next failure should NOT trip immediately — failures array was cleared,
    // so a single failure only brings failures.length to 1 (below threshold).
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.snapshot().state).toBe("CLOSED");
    expect(cb.snapshot().failures).toBe(1);
  });

  it("isolated snapshots across multiple breaker instances don't interfere", async () => {
    // Sanity: two breakers with the same name are still independent instances.
    const a = new CircuitBreaker({ name: "shared-name", failureThreshold: 1 });
    const b = new CircuitBreaker({ name: "shared-name", failureThreshold: 1 });

    const failing = async (): Promise<never> => {
      throw new Error("boom");
    };
    await expect(a.execute(failing)).rejects.toThrow("boom");
    expect(a.snapshot().state).toBe("OPEN");
    expect(b.snapshot().state).toBe("CLOSED");

    // Resetting `a` does not affect `b`.
    a.reset();
    expect(a.snapshot().state).toBe("CLOSED");
    expect(b.snapshot().state).toBe("CLOSED");
  });

  it("isFailure predicate filters which errors count as failures", async () => {
    const cb = new CircuitBreaker({
      name: "test-predicate",
      failureThreshold: 2,
      windowMs: 10_000,
      cooldownMs: 1000,
      // Only count "fatal" errors as failures; "transient" is treated as success.
      isFailure: (e) => e instanceof Error && e.message === "fatal",
    });

    // Transient errors do NOT count — breaker stays CLOSED.
    const transient = async (): Promise<never> => {
      throw new Error("transient");
    };
    await expect(cb.execute(transient)).rejects.toThrow("transient");
    await expect(cb.execute(transient)).rejects.toThrow("transient");
    expect(cb.snapshot().state).toBe("CLOSED");

    // Fatal errors trip the breaker.
    const fatal = async (): Promise<never> => {
      throw new Error("fatal");
    };
    await expect(cb.execute(fatal)).rejects.toThrow("fatal");
    await expect(cb.execute(fatal)).rejects.toThrow("fatal");
    expect(cb.snapshot().state).toBe("OPEN");
  });

  it("after closing from HALF_OPEN, failure counter restarts from zero", async () => {
    // Verifies that the CLOSED-after-recovery state is functionally a fresh
    // breaker — prior failure history within the rolling window is wiped.
    const cb = new CircuitBreaker({
      name: "test-recovery-clean-slate",
      failureThreshold: 2,
      windowMs: 10_000,
      cooldownMs: 1000,
      halfOpenSuccesses: 1,
    });

    // Trip.
    const failing = async (): Promise<never> => {
      throw new Error("boom");
    };
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.snapshot().state).toBe("OPEN");

    // Recover via a single probe success (halfOpenSuccesses = 1).
    vi.setSystemTime(Date.now() + 1001);
    expect(cb.snapshot().state).toBe("HALF_OPEN");
    await cb.execute(async () => "ok");
    expect(cb.snapshot().state).toBe("CLOSED");

    // After recovery, one failure alone is no longer enough to trip
    // (the failure window was cleared on close).
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.snapshot().state).toBe("CLOSED");
    expect(cb.snapshot().failures).toBe(1);
  });

  it("honours CircuitState union coverage", () => {
    // Type-level sanity: the public state_ accessor returns the union.
    const cb = new CircuitBreaker({ name: "typecheck" });
    const s: CircuitState = cb.state_;
    expect(["CLOSED", "OPEN", "HALF_OPEN"]).toContain(s);
  });
});
