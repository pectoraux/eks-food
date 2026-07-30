import { describe, expect, it } from "vitest";

/**
 * @file connectors/__tests__/cache-strategy.spec.ts
 *
 * Behavioural spec for the M5 connector cache strategy.
 *
 * External connector calls are slow and rate-limited, so the connector
 * layer caches responses with stale-while-revalidate (SWR) semantics:
 *
 *  - **Fresh hit**: the cached value is younger than `ttlMs` → return
 *    the cached value immediately, no fetch.
 *  - **Stale hit**: the cached value is older than `ttlMs` but younger
 *    than `staleWhileRevalidateMs` (a deadline beyond `ttlMs`) →
 *    return the cached value AND trigger a background refresh.
 *  - **Miss**: nothing cached, or the cached value is past the SWR
 *    deadline → fetch synchronously and cache the result.
 *  - **Coalescing**: if multiple concurrent callers request the same
 *    key while a fetch is in flight, all of them receive the same
 *    in-flight promise (so the underlying provider is called at most
 *    once per concurrent batch).
 *
 * The `CacheStrategy` class under test is implemented in-file because
 * the production `@eks/connectors` package only ships the event/action
 * vocabularies in this milestone.
 */

/** One cached entry. */
interface CacheEntry<V> {
  readonly value: V;
  readonly fetchedAt: number; // epoch ms
  /** Whether the most recent fetch happened in the background (SWR). */
  readonly refreshedInBackground: boolean;
}

/** Configuration accepted by {@link CacheStrategy}. */
interface CacheStrategyOptions {
  /** Fresh-for duration: hits younger than this are served instantly. */
  readonly ttlMs: number;
  /** Beyond ttlMs, a stale entry is served while a refresh runs in the
   *  background, up to ttlMs + staleWhileRevalidateMs total. */
  readonly staleWhileRevalidateMs: number;
  /** Optional clock injector for deterministic tests. */
  readonly now?: () => number;
}

/** Result of a `get` call, exposing whether it was a hit/miss/stale. */
interface CacheResult<V> {
  readonly value: V;
  readonly source: "fresh-hit" | "stale-hit" | "miss";
  readonly refreshedInBackground: boolean;
}

/**
 * SWR cache with request coalescing. The fetcher is supplied per-key
 * at `get` time so the same `CacheStrategy` instance can serve many
 * different connector operations.
 */
class CacheStrategy {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly refreshInflight = new Set<string>();
  private readonly ttlMs: number;
  private readonly staleWhileRevalidateMs: number;
  private readonly now: () => number;
  /** Test hook: number of times the underlying fetcher was invoked. */
  fetchCount = 0;
  /** Test hook: number of background refreshes triggered. */
  backgroundRefreshCount = 0;

  constructor(opts: CacheStrategyOptions) {
    this.ttlMs = opts.ttlMs;
    this.staleWhileRevalidateMs = opts.staleWhileRevalidateMs;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Return the cached value for `key`, fetching it via `fetcher` if
   * necessary. Implements stale-while-revalidate and request
   * coalescing as described above.
   */
  async get<V>(key: string, fetcher: () => Promise<V>): Promise<CacheResult<V>> {
    const now = this.now();
    const entry = this.entries.get(key) as CacheEntry<V> | undefined;

    // Fresh hit: serve immediately.
    if (entry !== undefined && now - entry.fetchedAt < this.ttlMs) {
      return {
        value: entry.value,
        source: "fresh-hit",
        refreshedInBackground: entry.refreshedInBackground,
      };
    }

    // Stale hit: within the SWR window. Serve stale + background refresh.
    const swrDeadline = this.ttlMs + this.staleWhileRevalidateMs;
    if (entry !== undefined && now - entry.fetchedAt < swrDeadline) {
      // Trigger a background refresh, unless one is already in flight.
      this.maybeBackgroundRefresh(key, fetcher);
      return {
        value: entry.value,
        source: "stale-hit",
        refreshedInBackground: entry.refreshedInBackground,
      };
    }

    // Miss: either no entry, or the SWR deadline has passed. Coalesce
    // concurrent requests for the same key onto a single in-flight
    // promise so the fetcher runs at most once.
    const existing = this.inflight.get(key) as Promise<V> | undefined;
    if (existing !== undefined) {
      const value = await existing;
      return {
        value,
        source: "miss",
        refreshedInBackground: false,
      };
    }

    const promise = this.fetchAndStore<V>(key, fetcher);
    this.inflight.set(key, promise);
    try {
      const value = await promise;
      return {
        value,
        source: "miss",
        refreshedInBackground: false,
      };
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Manually invalidate an entry (forces the next `get` to be a miss). */
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  /** Return the count of currently-cached entries. */
  size(): number {
    return this.entries.size;
  }

  private async fetchAndStore<V>(
    key: string,
    fetcher: () => Promise<V>,
  ): Promise<V> {
    this.fetchCount += 1;
    const value = await fetcher();
    this.entries.set(key, {
      value,
      fetchedAt: this.now(),
      refreshedInBackground: false,
    });
    return value;
  }

  private maybeBackgroundRefresh<V>(
    key: string,
    fetcher: () => Promise<V>,
  ): void {
    // Coalesce: only one background refresh per key at a time.
    if (this.refreshInflight.has(key)) return;
    if (this.inflight.has(key)) return;
    this.refreshInflight.add(key);
    this.backgroundRefreshCount += 1;
    const promise = (async () => {
      try {
        this.fetchCount += 1;
        const value = await fetcher();
        this.entries.set(key, {
          value,
          fetchedAt: this.now(),
          refreshedInBackground: true,
        });
      } finally {
        this.refreshInflight.delete(key);
      }
    })();
    // Attach the promise to `inflight` so concurrent miss-callers join it
    // rather than firing a second concurrent fetch.
    this.inflight.set(key, promise);
    void promise.then(() => {
      // Only clear the inflight slot if it still points at our promise
      // (a synchronous miss might have replaced it).
      if (this.inflight.get(key) === promise) {
        this.inflight.delete(key);
      }
    });
  }
}

/** Helper: build a fetcher that resolves `value` after `delayMs`. */
function fetcher<T>(value: T, delayMs = 0): () => Promise<T> {
  return () =>
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(value), delayMs);
    });
}

describe("CacheStrategy", () => {
  describe("cache miss", () => {
    it("fetches the value on a miss and returns it", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      const result = await cache.get("k1", fetcher("v1"));
      expect(result.value).toBe("v1");
      expect(result.source).toBe("miss");
      expect(cache.fetchCount).toBe(1);
    });

    it("stores the fetched value so the next call is a fresh hit", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      await cache.get("k1", fetcher("v1"));
      // Same instant: should be a fresh hit, no extra fetch.
      const r2 = await cache.get("k1", fetcher("v1"));
      expect(r2.source).toBe("fresh-hit");
      expect(r2.value).toBe("v1");
      expect(cache.fetchCount).toBe(1);
    });

    it("invalidate forces the next call to be a miss", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      await cache.get("k1", fetcher("v1"));
      expect(cache.fetchCount).toBe(1);
      cache.invalidate("k1");
      const r = await cache.get("k1", fetcher("v1"));
      expect(r.source).toBe("miss");
      expect(cache.fetchCount).toBe(2);
    });
  });

  describe("fresh hit", () => {
    it("returns the cached value without invoking the fetcher", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      await cache.get("k1", fetcher("v1"));
      // Advance time but stay within ttl.
      now += 500;
      let fetcherCalled = false;
      const r = await cache.get("k1", async () => {
        fetcherCalled = true;
        return "should-not-be-returned";
      });
      expect(r.source).toBe("fresh-hit");
      expect(r.value).toBe("v1");
      expect(fetcherCalled).toBe(false);
      expect(cache.fetchCount).toBe(1);
    });

    it("a fresh hit at exactly ttlMs is treated as stale (boundary)", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      await cache.get("k1", fetcher("v1"));
      // Advance exactly to ttl boundary: now - fetchedAt == ttlMs, so
      // the strict `<` test in the fresh-hit branch fails → stale.
      now += 1000;
      const r = await cache.get("k1", fetcher("v1-refreshed"));
      expect(r.source).toBe("stale-hit");
      // Stale hit returns the OLD value while a background refresh runs.
      expect(r.value).toBe("v1");
    });
  });

  describe("stale-while-revalidate", () => {
    it("returns the stale value immediately and triggers a background refresh", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      await cache.get("k1", fetcher("v1"));
      expect(cache.fetchCount).toBe(1);

      // Advance past ttl but within SWR window.
      now += 1500;
      const r = await cache.get("k1", fetcher("v1-refreshed", 50));
      // Stale value is returned synchronously.
      expect(r.source).toBe("stale-hit");
      expect(r.value).toBe("v1");
      // A background refresh was scheduled.
      expect(cache.backgroundRefreshCount).toBe(1);

      // Wait for the background refresh to complete.
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The cached value has now been refreshed.
      const r2 = await cache.get("k1", fetcher("v1-refreshed"));
      expect(r2.source).toBe("fresh-hit");
      expect(r2.value).toBe("v1-refreshed");
      // Two fetches total: the initial miss + the background refresh.
      expect(cache.fetchCount).toBe(2);
    });

    it("does NOT trigger multiple background refreshes for repeated stale hits", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 5000,
        now: () => now,
      });
      await cache.get("k1", fetcher("v1", 100)); // initial miss; takes 100ms
      // Wait for the initial fetch to settle.
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Advance past ttl; multiple stale hits should coalesce into a
      // single background refresh.
      now += 1500;
      await cache.get("k1", fetcher("v2", 100));
      await cache.get("k1", fetcher("v2", 100));
      await cache.get("k1", fetcher("v2", 100));
      expect(cache.backgroundRefreshCount).toBe(1);
    });

    it("falls back to a synchronous miss when the SWR deadline has passed", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      await cache.get("k1", fetcher("v1"));
      // Advance past both ttl and the SWR window.
      now += 3000; // ttl=1000, swr=1000, so deadline=2000; now-fetchedAt=3000
      const r = await cache.get("k1", fetcher("v2"));
      expect(r.source).toBe("miss");
      expect(r.value).toBe("v2");
    });
  });

  describe("request coalescing", () => {
    it("multiple concurrent gets for the same key fire the fetcher once", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      let fetchInvocations = 0;
      const slowFetcher = async (): Promise<string> => {
        fetchInvocations += 1;
        // Yield to the event loop so concurrent callers all queue up
        // on the same in-flight promise before it resolves.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "v1";
      };
      // Fire 5 concurrent gets for the same key.
      const results = await Promise.all([
        cache.get("k1", slowFetcher),
        cache.get("k1", slowFetcher),
        cache.get("k1", slowFetcher),
        cache.get("k1", slowFetcher),
        cache.get("k1", slowFetcher),
      ]);
      // The fetcher was invoked exactly once.
      expect(fetchInvocations).toBe(1);
      expect(cache.fetchCount).toBe(1);
      // Every caller received the same value.
      for (const r of results) {
        expect(r.value).toBe("v1");
        expect(r.source).toBe("miss");
      }
    });

    it("concurrent gets for DIFFERENT keys each fire their own fetcher", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      const results = await Promise.all([
        cache.get("a", fetcher("va", 20)),
        cache.get("b", fetcher("vb", 20)),
        cache.get("c", fetcher("vc", 20)),
      ]);
      expect(results.map((r) => r.value)).toEqual(["va", "vb", "vc"]);
      expect(cache.fetchCount).toBe(3);
    });

    it("a concurrent miss that arrives after the fetcher starts but before it resolves is coalesced onto the in-flight fetch", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      let invocations = 0;
      const slow = async (): Promise<number> => {
        invocations += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 42;
      };
      // Kick off the first call (it begins the fetch).
      const p1 = cache.get("k", slow);
      // Yield once so the first fetcher actually starts.
      await new Promise((resolve) => setTimeout(resolve, 5));
      // Second concurrent call should join the in-flight promise.
      const p2 = cache.get("k", slow);
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(invocations).toBe(1);
      expect(r1.value).toBe(42);
      expect(r2.value).toBe(42);
    });
  });

  describe("size + invalidate", () => {
    it("size reflects the number of cached entries", async () => {
      let now = 1_000_000;
      const cache = new CacheStrategy({
        ttlMs: 1000,
        staleWhileRevalidateMs: 1000,
        now: () => now,
      });
      expect(cache.size()).toBe(0);
      await cache.get("a", fetcher(1));
      await cache.get("b", fetcher(2));
      expect(cache.size()).toBe(2);
      cache.invalidate("a");
      expect(cache.size()).toBe(1);
    });
  });
});
