import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, computeDelay } from "../retry";
import { isOk } from "../result";

/**
 * Extended retry coverage — exercises the deadlineMs guard, the
 * retryIf predicate short-circuit, sleep injection, and the
 * computeDelay formula. The base retry paths (happy path, maxAttempts,
 * retryIf) are already covered by events/__tests__/events.spec.ts;
 * these tests focus on the parts that aren't.
 */
describe("withRetry — deadlineMs is respected", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops retrying when the next sleep would exceed the deadline", async () => {
    // Make computeDelay deterministic by mocking Math.random.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    // Deterministic sleep that advances fake time by exactly `ms` so the
    // deadline check reflects what would happen in production.
    const sleep = vi.fn(async (ms: number): Promise<void> => {
      vi.setSystemTime(Date.now() + ms);
    });

    let calls = 0;
    const fn = async (): Promise<string> => {
      calls += 1;
      throw new Error("always fails");
    };

    // computeDelay(1, 100, 2, 5000) with random=0.5 → floor(0.5 * 100) = 50.
    // deadlineMs = 25 → pastDeadline = (T0 + 50) > (T0 + 25) = true.
    // So the loop bails after attempt 1 without sleeping.
    const { result, attempts } = await withRetry(fn, {
      maxAttempts: 10,
      baseDelayMs: 100,
      multiplier: 2,
      maxDelayMs: 5000,
      deadlineMs: 25,
      sleep,
    });

    expect(isOk(result)).toBe(false);
    expect(calls).toBe(1);
    expect(attempts).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(attempts[0]?.delayMs).toBe(50);

    randomSpy.mockRestore();
  });

  it("retries while inside the deadline, then stops once exceeded", async () => {
    // With deterministic Math.random and a sleep that advances fake time,
    // we can verify the loop continues until the deadline would be breached.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const sleep = vi.fn(async (ms: number): Promise<void> => {
      vi.setSystemTime(Date.now() + ms);
    });

    let calls = 0;
    const fn = async (): Promise<string> => {
      calls += 1;
      throw new Error("always fails");
    };

    // baseDelayMs=100, multiplier=2, maxDelayMs=5000 → delays: 50, 100, 200, 400, 800
    // deadlineMs=200:
    //   attempt 1 at T0=0: delay=50. pastDeadline = (0+50) > 200 = false. Sleep → T=50.
    //   attempt 2 at T=50: delay=100. pastDeadline = (50+100) > 200 = false. Sleep → T=150.
    //   attempt 3 at T=150: delay=200. pastDeadline = (150+200) > 200 = true. Bail.
    // So calls=3, attempts=3, sleep called twice.
    const { result, attempts } = await withRetry(fn, {
      maxAttempts: 10,
      baseDelayMs: 100,
      multiplier: 2,
      maxDelayMs: 5000,
      deadlineMs: 200,
      sleep,
    });

    expect(isOk(result)).toBe(false);
    expect(calls).toBe(3);
    expect(attempts).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(attempts[0]?.delayMs).toBe(50);
    expect(attempts[1]?.delayMs).toBe(100);
    expect(attempts[2]?.delayMs).toBe(200);

    randomSpy.mockRestore();
  });
});

describe("withRetry — retryIf predicate", () => {
  it("retryIf: () => false stops immediately after the first failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("non-retryable"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const { result, attempts } = await withRetry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      retryIf: () => false,
      sleep,
    });

    expect(isOk(result)).toBe(false);
    expect(attempts).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
    // Sleep must NOT be called because the predicate refused to retry.
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retryIf that matches the error retries up to maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("retryable"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const { result, attempts } = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      retryIf: (e) => e instanceof Error && e.message === "retryable",
      sleep,
    });

    expect(isOk(result)).toBe(false);
    expect(attempts).toHaveLength(3);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retryIf that does NOT match the error stops after the first failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fatal"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const { result, attempts } = await withRetry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      retryIf: (e) => e instanceof Error && e.message === "retryable",
      sleep,
    });

    expect(isOk(result)).toBe(false);
    expect(attempts).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("withRetry — injectable sleep", () => {
  it("the injected sleep function is called between attempts with the computed delay", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient-1"))
      .mockRejectedValueOnce(new Error("transient-2"))
      .mockResolvedValueOnce("finally");

    const { result, attempts } = await withRetry(fn, {
      maxAttempts: 5,
      baseDelayMs: 100,
      multiplier: 2,
      maxDelayMs: 5000,
      sleep,
    });

    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("finally");
    }

    // Two failures ⇒ two sleeps. Sleep is NOT called after the final success.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(attempts).toHaveLength(2);

    // Each sleep call received exactly the delay recorded in the matching attempt.
    expect(sleep).toHaveBeenNthCalledWith(1, attempts[0]?.delayMs);
    expect(sleep).toHaveBeenNthCalledWith(2, attempts[1]?.delayMs);

    // Deterministic delays (random=0.5): floor(0.5 * 100) = 50, floor(0.5 * 200) = 100.
    expect(attempts[0]?.delayMs).toBe(50);
    expect(attempts[1]?.delayMs).toBe(100);

    randomSpy.mockRestore();
  });

  it("sleep is NOT called when the first attempt succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockResolvedValue("ok");

    const { result, attempts } = await withRetry(fn, { sleep });

    expect(isOk(result)).toBe(true);
    expect(attempts).toHaveLength(0);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("sleep is NOT called after the final failed attempt", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    const { result, attempts } = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 50,
      sleep,
    });

    expect(isOk(result)).toBe(false);
    expect(attempts).toHaveLength(3);
    // Two sleeps between three attempts — no sleep after attempt 3.
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("computeDelay — exponential backoff formula", () => {
  it("computes floor(random * min(base * mult^(n-1), max))", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      // base=100, multiplier=2, max=5000
      expect(computeDelay(1, 100, 2, 5000)).toBe(50); // floor(0.5 * 100)
      expect(computeDelay(2, 100, 2, 5000)).toBe(100); // floor(0.5 * 200)
      expect(computeDelay(3, 100, 2, 5000)).toBe(200); // floor(0.5 * 400)
      expect(computeDelay(4, 100, 2, 5000)).toBe(400); // floor(0.5 * 800)
      // At attempt 10: 100 * 2^9 = 51200, capped to 5000 → floor(0.5 * 5000) = 2500.
      expect(computeDelay(10, 100, 2, 5000)).toBe(2500);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("never returns a negative value", () => {
    for (let i = 0; i < 100; i++) {
      const d = computeDelay(1, 100, 2, 5000);
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it("never exceeds the max cap", () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      for (let i = 0; i < 50; i++) {
        const d = computeDelay(attempt, 100, 2, 5000);
        expect(d).toBeLessThanOrEqual(4999); // floor(random * 5000) is in [0, 4999]
      }
    }
  });

  it("returns 0 when the cap is 0", () => {
    // Math.floor(Math.random() * 0) is always 0.
    for (let i = 0; i < 50; i++) {
      expect(computeDelay(1, 100, 2, 0)).toBe(0);
      expect(computeDelay(5, 100, 2, 0)).toBe(0);
    }
  });

  it("respects the cap when exponential exceeds maxDelayMs", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      // base=1000, multiplier=10, max=5000
      // attempt 1: 1000, cap=1000, delay=floor(0.99 * 1000) = 990.
      expect(computeDelay(1, 1000, 10, 5000)).toBe(990);
      // attempt 2: 10000, cap=5000, delay=floor(0.99 * 5000) = 4950.
      expect(computeDelay(2, 1000, 10, 5000)).toBe(4950);
      // attempt 3: 100000, cap=5000, delay=floor(0.99 * 5000) = 4950.
      expect(computeDelay(3, 1000, 10, 5000)).toBe(4950);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("with multiplier=1 produces constant-delay backoff (no exponential growth)", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      // base=100, multiplier=1, max=5000 → every attempt: 100 * 1^(n-1) = 100.
      expect(computeDelay(1, 100, 1, 5000)).toBe(50);
      expect(computeDelay(5, 100, 1, 5000)).toBe(50);
      expect(computeDelay(10, 100, 1, 5000)).toBe(50);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
