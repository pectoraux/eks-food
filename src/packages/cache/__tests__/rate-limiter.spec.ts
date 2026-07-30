import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { InMemoryCache } from "../memory";

/**
 * TokenBucketRateLimiter — a classic token-bucket limiter backed by
 * the @eks/cache `InMemoryCache`. Tokens accumulate at `refillPerSec`
 * up to `capacity`; each `tryConsume()` removes one token. When the
 * bucket is empty the request is rejected.
 *
 * The token count is persisted in the cache (so the limiter can be
 * shared across workers / requests when the cache is Redis-backed).
 * Time is provided via an injectable `now()` for deterministic tests.
 */

export interface TokenBucketOptions {
  readonly capacity: number;
  readonly refillPerSec: number;
  /** Cache key namespace for this bucket. */
  readonly key?: string;
  /** Inject now() (default: Date.now). */
  readonly now?: () => number;
  /** Inject the cache (default: fresh InMemoryCache with no TTL). */
  readonly cache?: InMemoryCache<number>;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

export class TokenBucketRateLimiter {
  readonly capacity: number;
  readonly refillPerSec: number;
  private readonly key: string;
  private readonly now: () => number;
  private readonly cache: InMemoryCache<number>;

  constructor(opts: TokenBucketOptions) {
    if (!Number.isFinite(opts.capacity) || opts.capacity <= 0) {
      throw new RangeError("capacity must be a positive finite number");
    }
    if (!Number.isFinite(opts.refillPerSec) || opts.refillPerSec <= 0) {
      throw new RangeError("refillPerSec must be a positive finite number");
    }
    this.capacity = opts.capacity;
    this.refillPerSec = opts.refillPerSec;
    this.key = opts.key ?? "token-bucket:default";
    this.now = opts.now ?? (() => Date.now());
    // InMemoryCache with ttlMs=0 means "no expiry" — the bucket
    // persists across calls. A custom cache can be injected (e.g. for
    // multi-bucket isolation tests).
    this.cache = opts.cache ?? new InMemoryCache<number>({ ttlMs: 0 });
  }

  /** Attempt to consume one token. Returns true if allowed, false if rejected. */
  async tryConsume(): Promise<boolean> {
    const state = await this.loadState();
    const refillMs = 1000 / this.refillPerSec;
    const now = this.now();
    const elapsed = now - state.lastRefill;
    const refilled = Math.floor(elapsed / refillMs);
    const tokensAfterRefill = Math.min(this.capacity, state.tokens + refilled);
    const newLastRefill = refilled > 0
      ? state.lastRefill + refilled * refillMs
      : state.lastRefill;

    if (tokensAfterRefill <= 0) {
      await this.saveState({ tokens: tokensAfterRefill, lastRefill: newLastRefill });
      return false;
    }
    await this.saveState({ tokens: tokensAfterRefill - 1, lastRefill: newLastRefill });
    return true;
  }

  /** Current token count (after applying pending refill). */
  async availableTokens(): Promise<number> {
    const state = await this.loadState();
    const refillMs = 1000 / this.refillPerSec;
    const now = this.now();
    const elapsed = now - state.lastRefill;
    const refilled = Math.floor(elapsed / refillMs);
    return Math.min(this.capacity, state.tokens + refilled);
  }

  private async loadState(): Promise<BucketState> {
    const existing = await this.cache.get<number>(this.key);
    if (existing === null) {
      return { tokens: this.capacity, lastRefill: this.now() };
    }
    // We store the state as a tuple-encoded number. The cache stores
    // V=unknown, so we encode tokens*1e12 + lastRefillMs as a single
    // Number. lastRefillMs is bounded by 2^53/1e12 ~ 9e5 years.
    return this.decode(existing);
  }

  private async saveState(state: BucketState): Promise<void> {
    await this.cache.set<number>(this.key, this.encode(state));
  }

  private encode(state: BucketState): number {
    // Pack tokens + lastRefill into a single number so the typed
    // InMemoryCache<number> can hold it without resorting to `any`.
    // tokens are small integers (0..capacity), lastRefill is ms-since-epoch.
    return state.tokens * 1e15 + state.lastRefill;
  }

  private decode(value: number): BucketState {
    const lastRefill = Math.floor(value % 1e15);
    const tokens = Math.floor((value - lastRefill) / 1e15);
    return { tokens, lastRefill };
  }
}

describe("TokenBucketRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows `capacity` consecutive requests then rejects the next", async () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 5,
      refillPerSec: 1,
    });

    for (let i = 0; i < 5; i++) {
      expect(await limiter.tryConsume()).toBe(true);
    }
    // 6th is rejected — bucket empty.
    expect(await limiter.tryConsume()).toBe(false);
  });

  it("refills one token per second after the bucket is empty", async () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 5,
      refillPerSec: 1,
    });

    // Drain the bucket.
    for (let i = 0; i < 5; i++) {
      await limiter.tryConsume();
    }
    expect(await limiter.tryConsume()).toBe(false);

    // Advance 1s — one token should be available.
    vi.setSystemTime(Date.now() + 1000);
    expect(await limiter.tryConsume()).toBe(true);
    // No more tokens until another second elapses.
    expect(await limiter.tryConsume()).toBe(false);
  });

  it("never refills above capacity", async () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 3,
      refillPerSec: 10,
    });

    // Don't consume — wait 5 seconds; bucket should still be capped at 3.
    vi.setSystemTime(Date.now() + 5000);
    expect(await limiter.availableTokens()).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(await limiter.tryConsume()).toBe(true);
    }
    expect(await limiter.tryConsume()).toBe(false);
  });

  it("availableTokens reports the current token count", async () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 5,
      refillPerSec: 1,
    });
    expect(await limiter.availableTokens()).toBe(5);
    await limiter.tryConsume();
    await limiter.tryConsume();
    expect(await limiter.availableTokens()).toBe(3);
  });

  it("refills the correct number of tokens after a long idle period", async () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 5,
      refillPerSec: 2, // 2 tokens/sec → refillMs = 500ms
    });

    // Drain the bucket.
    for (let i = 0; i < 5; i++) await limiter.tryConsume();
    expect(await limiter.tryConsume()).toBe(false);

    // After 1.5s we should have 3 new tokens (1.5s * 2/s = 3).
    vi.setSystemTime(Date.now() + 1500);
    expect(await limiter.tryConsume()).toBe(true);
    expect(await limiter.tryConsume()).toBe(true);
    expect(await limiter.tryConsume()).toBe(true);
    expect(await limiter.tryConsume()).toBe(false);
  });

  it("isolates buckets by key — independent buckets don't share tokens", async () => {
    let clock = 0;
    const sharedNow = () => clock;
    const a = new TokenBucketRateLimiter({
      capacity: 2,
      refillPerSec: 1,
      key: "bucket-a",
      now: sharedNow,
    });
    const b = new TokenBucketRateLimiter({
      capacity: 2,
      refillPerSec: 1,
      key: "bucket-b",
      now: sharedNow,
    });

    // Drain bucket a entirely.
    expect(await a.tryConsume()).toBe(true);
    expect(await a.tryConsume()).toBe(true);
    expect(await a.tryConsume()).toBe(false);

    // Bucket b is still full.
    expect(await b.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(false);
  });

  it("supports a custom cache for cross-limiter sharing & isolation", async () => {
    const sharedCache = new InMemoryCache<number>({ ttlMs: 0 });
    const a = new TokenBucketRateLimiter({
      capacity: 2,
      refillPerSec: 1,
      key: "shared",
      cache: sharedCache,
    });
    const b = new TokenBucketRateLimiter({
      capacity: 2,
      refillPerSec: 1,
      key: "shared",
      cache: sharedCache,
    });

    // Drain via a — b observes the drained state.
    expect(await a.tryConsume()).toBe(true);
    expect(await a.tryConsume()).toBe(true);
    expect(await b.tryConsume()).toBe(false);
  });

  it("rejects invalid capacity / refillPerSec at construction", () => {
    expect(() => new TokenBucketRateLimiter({ capacity: 0, refillPerSec: 1 })).toThrow(RangeError);
    expect(() => new TokenBucketRateLimiter({ capacity: -1, refillPerSec: 1 })).toThrow(RangeError);
    expect(() => new TokenBucketRateLimiter({ capacity: NaN, refillPerSec: 1 })).toThrow(RangeError);
    expect(() => new TokenBucketRateLimiter({ capacity: 5, refillPerSec: 0 })).toThrow(RangeError);
    expect(() => new TokenBucketRateLimiter({ capacity: 5, refillPerSec: -1 })).toThrow(RangeError);
    expect(() => new TokenBucketRateLimiter({ capacity: 5, refillPerSec: Infinity })).toThrow(RangeError);
  });
});
