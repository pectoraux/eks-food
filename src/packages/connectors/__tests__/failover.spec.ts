import { describe, expect, it } from "vitest";

/**
 * @file connectors/__tests__/failover.spec.ts
 *
 * Behavioural spec for the M5 connector failover engine.
 *
 * Each connector operation is attempted against an ordered list of
 * providers; if the first provider throws, the engine falls over to
 * the next, and so on. After a configurable number of consecutive
 * failures for a single provider, a circuit breaker opens and that
 * provider is short-circuited (skipped) until it is reset.
 *
 * The `FailoverEngine` class under test is implemented in-file because
 * the production `@eks/connectors` package only ships the event/action
 * vocabularies in this milestone.
 *
 * Failover contract this spec pins down:
 *  1. If the first provider succeeds, its result is returned and no
 *     other provider is invoked.
 *  2. If the first provider fails (throws), the engine tries the next
 *     provider in order; if any later provider succeeds, that result
 *     is returned.
 *  3. If every provider fails, the engine throws an
 *     `AllProvidersFailedError` whose `cause` chain references the
 *     last failure.
 *  4. Every attempt — success or failure — is appended to an
 *     `attemptHistory` so callers (and tests) can audit the path the
 *     engine took.
 *  5. A per-provider circuit breaker opens after `failureThreshold`
 *     consecutive failures. Once open, the engine skips that provider
 *     (recording a `circuit-open` attempt outcome) until `resetCircuit`
 *     is called.
 */

/** Identifier for a single provider in a failover chain. */
interface FailoverProvider {
  readonly id: string;
  /** Execute the operation against this provider; throw on failure. */
  readonly execute: () => Promise<unknown>;
}

/** One entry in the attempt history. */
interface AttemptRecord {
  readonly providerId: string;
  readonly outcome: "success" | "failure" | "circuit-open";
  readonly error?: string;
  readonly attemptedAt: string; // ISO-8601
}

/** Aggregated error raised when every provider in the chain fails. */
class AllProvidersFailedError extends Error {
  readonly attempts: ReadonlyArray<AttemptRecord>;
  constructor(attempts: ReadonlyArray<AttemptRecord>) {
    const last = attempts[attempts.length - 1];
    super(
      `all providers failed (attempts: ${attempts.length}, last error: ${
        last?.error ?? "unknown"
      })`,
    );
    this.name = "AllProvidersFailedError";
    this.attempts = attempts;
  }
}

/** Configuration accepted by {@link FailoverEngine}. */
interface FailoverOptions {
  /** Consecutive failures per provider before the circuit opens. */
  readonly failureThreshold?: number;
  /** Now-injector for deterministic timestamps in tests. */
  readonly now?: () => Date;
}

/** State tracked per provider for the circuit breaker. */
interface ProviderState {
  consecutiveFailures: number;
  circuitOpen: boolean;
}

/**
 * Pure failover engine: tries providers in order, falling over on
 * failure, with a per-provider circuit breaker.
 */
class FailoverEngine {
  private readonly states = new Map<string, ProviderState>();
  private readonly history: AttemptRecord[] = [];
  private readonly failureThreshold: number;
  private readonly now: () => Date;

  constructor(opts?: FailoverOptions) {
    this.failureThreshold = opts?.failureThreshold ?? 3;
    this.now = opts?.now ?? (() => new Date());
  }

  /** Read-only snapshot of the attempt history so far. */
  get attemptHistory(): ReadonlyArray<AttemptRecord> {
    return this.history.slice();
  }

  /** Whether the circuit is currently open for a given provider. */
  isCircuitOpen(providerId: string): boolean {
    return this.states.get(providerId)?.circuitOpen ?? false;
  }

  /** Get-or-create the per-provider circuit-breaker state. */
  private getOrCreateState(providerId: string): ProviderState {
    let state = this.states.get(providerId);
    if (state === undefined) {
      state = { consecutiveFailures: 0, circuitOpen: false };
      this.states.set(providerId, state);
    }
    return state;
  }

  /** Reset a provider's circuit breaker (e.g. after a health check passes). */
  resetCircuit(providerId: string): void {
    const state = this.states.get(providerId);
    if (state) {
      state.circuitOpen = false;
      state.consecutiveFailures = 0;
    }
  }

  /**
   * Try each provider in order. Returns the first successful result.
   * Throws {@link AllProvidersFailedError} if every provider fails.
   */
  async execute<T>(providers: ReadonlyArray<FailoverProvider>): Promise<T> {
    if (providers.length === 0) {
      throw new AllProvidersFailedError([]);
    }

    // Track only the attempts made during THIS execute call so the
    // thrown error's `attempts` field reflects the current chain, not
    // the cumulative history across multiple calls.
    const localHistory: AttemptRecord[] = [];
    let lastError: unknown = null;
    for (const provider of providers) {
      const state = this.getOrCreateState(provider.id);

      // Circuit-breaker short-circuit: skip providers whose circuit is open.
      if (state.circuitOpen) {
        const rec: AttemptRecord = {
          providerId: provider.id,
          outcome: "circuit-open",
          attemptedAt: this.now().toISOString(),
        };
        localHistory.push(rec);
        this.history.push(rec);
        continue;
      }

      try {
        const result = (await provider.execute()) as T;
        // Success: reset the failure counter for this provider.
        state.consecutiveFailures = 0;
        const rec: AttemptRecord = {
          providerId: provider.id,
          outcome: "success",
          attemptedAt: this.now().toISOString(),
        };
        localHistory.push(rec);
        this.history.push(rec);
        return result;
      } catch (e) {
        lastError = e;
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= this.failureThreshold) {
          state.circuitOpen = true;
        }
        const rec: AttemptRecord = {
          providerId: provider.id,
          outcome: "failure",
          error: e instanceof Error ? e.message : String(e),
          attemptedAt: this.now().toISOString(),
        };
        localHistory.push(rec);
        this.history.push(rec);
        // Fall through to the next provider.
      }
    }

    void lastError; // captured for debugging; the error chain lives in localHistory
    throw new AllProvidersFailedError(localHistory);
  }
}

/** Helper: build a provider that always succeeds with the given value. */
function ok<T>(id: string, value: T): FailoverProvider {
  return { id, execute: async () => value };
}

/** Helper: build a provider that always fails with the given message. */
function fail(id: string, message: string): FailoverProvider {
  return {
    id,
    execute: async () => {
      throw new Error(message);
    },
  };
}

/** Helper: build a provider that fails the first N calls, then succeeds. */
function failThenOk<T>(
  id: string,
  failCount: number,
  value: T,
  message: string,
): FailoverProvider & { calls: number } {
  let calls = 0;
  const p: FailoverProvider & { calls: number } = {
    id,
    get calls() {
      return calls;
    },
    execute: async () => {
      calls += 1;
      if (calls <= failCount) throw new Error(message);
      return value;
    },
  };
  return p;
}

describe("FailoverEngine", () => {
  describe("happy path", () => {
    it("returns the result of the first provider when it succeeds", async () => {
      const engine = new FailoverEngine();
      const providers: ReadonlyArray<FailoverProvider> = [
        ok("primary", { route: "A→B" }),
        ok("secondary", { route: "A→C" }),
      ];
      const result = await engine.execute(providers);
      expect(result).toEqual({ route: "A→B" });
      // Only the primary was attempted — secondary was never invoked.
      expect(engine.attemptHistory).toHaveLength(1);
      expect(engine.attemptHistory[0]?.providerId).toBe("primary");
      expect(engine.attemptHistory[0]?.outcome).toBe("success");
    });

    it("does not invoke subsequent providers when the first succeeds", async () => {
      const engine = new FailoverEngine();
      let secondaryCalls = 0;
      const providers: ReadonlyArray<FailoverProvider> = [
        ok("primary", 1),
        {
          id: "secondary",
          execute: async () => {
            secondaryCalls += 1;
            return 2;
          },
        },
      ];
      await engine.execute(providers);
      expect(secondaryCalls).toBe(0);
    });
  });

  describe("failover", () => {
    it("falls over to the second provider when the first fails", async () => {
      const engine = new FailoverEngine();
      const providers: ReadonlyArray<FailoverProvider> = [
        fail("primary", "boom"),
        ok("secondary", { ok: true }),
      ];
      const result = await engine.execute(providers);
      expect(result).toEqual({ ok: true });
      expect(engine.attemptHistory).toHaveLength(2);
      expect(engine.attemptHistory[0]?.providerId).toBe("primary");
      expect(engine.attemptHistory[0]?.outcome).toBe("failure");
      expect(engine.attemptHistory[0]?.error).toBe("boom");
      expect(engine.attemptHistory[1]?.providerId).toBe("secondary");
      expect(engine.attemptHistory[1]?.outcome).toBe("success");
    });

    it("falls over through multiple providers until one succeeds", async () => {
      const engine = new FailoverEngine();
      const providers: ReadonlyArray<FailoverProvider> = [
        fail("a", "a-fail"),
        fail("b", "b-fail"),
        fail("c", "c-fail"),
        ok("d", "d-ok"),
      ];
      const result = await engine.execute<string>(providers);
      expect(result).toBe("d-ok");
      expect(engine.attemptHistory.map((a) => a.providerId)).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
      expect(engine.attemptHistory.map((a) => a.outcome)).toEqual([
        "failure",
        "failure",
        "failure",
        "success",
      ]);
    });

    it("throws AllProvidersFailedError when every provider fails", async () => {
      const engine = new FailoverEngine();
      const providers: ReadonlyArray<FailoverProvider> = [
        fail("a", "a-fail"),
        fail("b", "b-fail"),
        fail("c", "c-fail"),
      ];
      await expect(engine.execute(providers)).rejects.toBeInstanceOf(
        AllProvidersFailedError,
      );
      try {
        await engine.execute([
          fail("a", "a-fail"),
          fail("b", "b-fail"),
        ]);
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AllProvidersFailedError);
        const err = e as AllProvidersFailedError;
        expect(err.attempts).toHaveLength(2);
        expect(err.attempts[1]?.error).toBe("b-fail");
      }
    });

    it("throws immediately when no providers are supplied", async () => {
      const engine = new FailoverEngine();
      await expect(engine.execute([])).rejects.toBeInstanceOf(
        AllProvidersFailedError,
      );
    });

    it("attempt history records every provider tried, in order", async () => {
      const engine = new FailoverEngine();
      const providers: ReadonlyArray<FailoverProvider> = [
        fail("p1", "e1"),
        fail("p2", "e2"),
        ok("p3", "v3"),
      ];
      await engine.execute(providers);
      const ids = engine.attemptHistory.map((a) => a.providerId);
      const outcomes = engine.attemptHistory.map((a) => a.outcome);
      expect(ids).toEqual(["p1", "p2", "p3"]);
      expect(outcomes).toEqual(["failure", "failure", "success"]);
    });

    it("attempt history records the error message on failure", async () => {
      const engine = new FailoverEngine();
      await expect(
        engine.execute([fail("only", "specific-error-msg")]),
      ).rejects.toBeInstanceOf(AllProvidersFailedError);
      expect(engine.attemptHistory[0]?.error).toBe("specific-error-msg");
    });

    it("success after a failure resets the per-provider failure counter", async () => {
      // Threshold = 3. Flaky fails once, then succeeds forever.
      // A backup always succeeds so execute() never throws.
      // After flaky succeeds, its counter MUST reset to 0 — so a
      // subsequent single failure does NOT push the counter to 2 and
      // the circuit stays closed.
      const engine = new FailoverEngine({ failureThreshold: 3 });
      const flaky = failThenOk("flaky", 1, "flaky-ok", "transient");
      const backup = ok("backup", "backup-ok");

      // Execute 1: flaky fails (counter=1), backup succeeds.
      const r1 = await engine.execute([flaky, backup]);
      expect(r1).toBe("backup-ok");
      expect(engine.isCircuitOpen("flaky")).toBe(false);

      // Execute 2: flaky now succeeds (counter resets to 0).
      const r2 = await engine.execute([flaky, backup]);
      expect(r2).toBe("flaky-ok");
      expect(engine.isCircuitOpen("flaky")).toBe(false);

      // Replace flaky with a fresh always-fail provider to simulate a
      // new failure after the reset. The counter should be 1, not 2.
      const flaky2 = fail("flaky", "transient-2");
      const r3 = await engine.execute([flaky2, backup]);
      expect(r3).toBe("backup-ok");
      expect(engine.isCircuitOpen("flaky")).toBe(false); // counter=1 < threshold=3

      // Two more failures → counter=3 → circuit opens.
      await engine.execute([flaky2, backup]);
      expect(engine.isCircuitOpen("flaky")).toBe(false); // counter=2
      await engine.execute([flaky2, backup]);
      expect(engine.isCircuitOpen("flaky")).toBe(true); // counter=3 → open
    });
  });

  describe("circuit breaker", () => {
    it("opens the circuit after failureThreshold consecutive failures", async () => {
      const engine = new FailoverEngine({ failureThreshold: 3 });
      const alwaysFail = fail("primary", "down");

      // Three consecutive failures → circuit opens.
      for (let i = 0; i < 3; i++) {
        await expect(
          engine.execute([alwaysFail, ok("backup", "bk")]),
        ).resolves.toBe("bk");
      }
      expect(engine.isCircuitOpen("primary")).toBe(true);
    });

    it("once open, the circuit short-circuits the provider without invoking it", async () => {
      const engine = new FailoverEngine({ failureThreshold: 2 });
      let primaryCalls = 0;
      const primary: FailoverProvider = {
        id: "primary",
        execute: async () => {
          primaryCalls += 1;
          throw new Error("primary-down");
        },
      };

      // Two calls → circuit opens after the second failure.
      await engine.execute([primary, ok("backup", "bk-1")]);
      await engine.execute([primary, ok("backup", "bk-2")]);
      expect(engine.isCircuitOpen("primary")).toBe(true);
      expect(primaryCalls).toBe(2);

      // Third call: primary is short-circuited (no execute call), only
      // the backup runs. The history records a `circuit-open` entry.
      const before = engine.attemptHistory.length;
      const result = await engine.execute([primary, ok("backup", "bk-3")]);
      expect(result).toBe("bk-3");
      expect(primaryCalls).toBe(2); // unchanged — execute was NOT called
      // Two new history entries: circuit-open for primary, success for backup.
      expect(engine.attemptHistory.length).toBe(before + 2);
      expect(engine.attemptHistory[before]?.providerId).toBe("primary");
      expect(engine.attemptHistory[before]?.outcome).toBe("circuit-open");
    });

    it("resetCircuit clears the open state and the failure counter", async () => {
      const engine = new FailoverEngine({ failureThreshold: 2 });
      const primary = fail("primary", "down");
      await engine.execute([primary, ok("backup", "bk-1")]);
      await engine.execute([primary, ok("backup", "bk-2")]);
      expect(engine.isCircuitOpen("primary")).toBe(true);

      engine.resetCircuit("primary");
      expect(engine.isCircuitOpen("primary")).toBe(false);

      // After reset, the engine tries primary again (and fails again,
      // because primary still throws — but the circuit is now closed).
      await engine.execute([primary, ok("backup", "bk-3")]);
      const last = engine.attemptHistory[engine.attemptHistory.length - 2];
      expect(last?.providerId).toBe("primary");
      expect(last?.outcome).toBe("failure"); // not circuit-open
    });

    it("circuit is per-provider — opening one does not affect others", async () => {
      const engine = new FailoverEngine({ failureThreshold: 1 });
      const a = fail("a", "a-down");
      const b = ok("b", "b-ok");

      // First call: a fails (threshold=1 → circuit opens for a), b succeeds.
      await engine.execute([a, b]);
      expect(engine.isCircuitOpen("a")).toBe(true);
      expect(engine.isCircuitOpen("b")).toBe(false);

      // Second call: a is short-circuited, b still runs normally.
      await engine.execute([a, b]);
      expect(engine.isCircuitOpen("a")).toBe(true);
      expect(engine.isCircuitOpen("b")).toBe(false);
    });

    it("default failureThreshold is 3", async () => {
      const engine = new FailoverEngine();
      const a = fail("a", "down");
      // Two failures: not enough to open (threshold = 3).
      await engine.execute([a, ok("b", 1)]);
      await engine.execute([a, ok("b", 2)]);
      expect(engine.isCircuitOpen("a")).toBe(false);
      // Third failure: opens.
      await engine.execute([a, ok("b", 3)]);
      expect(engine.isCircuitOpen("a")).toBe(true);
    });
  });

  describe("determinism", () => {
    it("uses the injected now() for every attempt timestamp", async () => {
      let counter = 0;
      const fixed = new Date("2024-01-01T00:00:00.000Z");
      const engine = new FailoverEngine({
        now: () => {
          counter += 1;
          return new Date(fixed.getTime() + counter * 1000);
        },
      });
      await engine.execute([
        fail("a", "x"),
        ok("b", "ok"),
      ]);
      expect(engine.attemptHistory[0]?.attemptedAt).toBe(
        "2024-01-01T00:00:01.000Z",
      );
      expect(engine.attemptHistory[1]?.attemptedAt).toBe(
        "2024-01-01T00:00:02.000Z",
      );
    });
  });
});
