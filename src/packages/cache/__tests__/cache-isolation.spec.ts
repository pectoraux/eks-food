import { describe, it, expect } from "vitest";
import { InMemoryCache } from "../memory";

/**
 * Cache isolation & single-flight coverage — exercises namespace
 * isolation across cache instances, deleteByPrefix scoping, and
 * getOrSet single-flight across many concurrent callers.
 *
 * The base cache suite (cache.spec.ts) covers set/get round-trip, TTL
 * expiry, two-caller single-flight, and locks; these tests cover the
 * isolation guarantees that are critical for multi-tenant and
 * multi-extension safety on the developer platform.
 */

describe("InMemoryCache — namespaced isolation", () => {
  it("two caches with different namespaces do not share keys", async () => {
    const alpha = new InMemoryCache<unknown>({ namespace: "alpha", ttlMs: 60_000 });
    const beta = new InMemoryCache<unknown>({ namespace: "beta", ttlMs: 60_000 });

    await alpha.set("user:1", "alpha-user-1");
    await beta.set("user:1", "beta-user-1");

    expect(await alpha.get("user:1")).toBe("alpha-user-1");
    expect(await beta.get("user:1")).toBe("beta-user-1");

    // Deleting from one does not affect the other.
    await alpha.delete("user:1");
    expect(await alpha.get("user:1")).toBeNull();
    expect(await beta.get("user:1")).toBe("beta-user-1");
  });

  it("namespaced caches with same key but different namespaces hold independent values", async () => {
    const prod = new InMemoryCache<unknown>({ namespace: "prod", ttlMs: 60_000 });
    const staging = new InMemoryCache<unknown>({ namespace: "staging", ttlMs: 60_000 });

    await prod.set("feature-flag:experimental", true);
    await staging.set("feature-flag:experimental", false);

    expect(await prod.get("feature-flag:experimental")).toBe(true);
    expect(await staging.get("feature-flag:experimental")).toBe(false);
  });

  it("namespaced cache has() does not leak across instances", async () => {
    const a = new InMemoryCache<unknown>({ namespace: "ns-a", ttlMs: 60_000 });
    const b = new InMemoryCache<unknown>({ namespace: "ns-b", ttlMs: 60_000 });

    await a.set("k", "v");
    expect(await a.has("k")).toBe(true);
    expect(await b.has("k")).toBe(false);
  });

  it("deleteByPrefix only affects keys matching the namespaced prefix within a single cache", async () => {
    const cache = new InMemoryCache<unknown>({ namespace: "ext-1", ttlMs: 60_000 });

    // Within namespace "ext-1", keys are stored as "ext-1:user:1", etc.
    await cache.set("user:1", "u1");
    await cache.set("user:2", "u2");
    await cache.set("user:3", "u3");
    await cache.set("session:1", "s1");
    await cache.set("config:timeout", 30_000);

    const removed = await cache.deleteByPrefix("user:");
    expect(removed).toBe(3);

    expect(await cache.get("user:1")).toBeNull();
    expect(await cache.get("user:2")).toBeNull();
    expect(await cache.get("user:3")).toBeNull();
    // Non-matching keys are untouched.
    expect(await cache.get("session:1")).toBe("s1");
    expect(await cache.get("config:timeout")).toBe(30_000);
  });

  it("deleteByPrefix on one cache instance does not affect another cache instance", async () => {
    const a = new InMemoryCache<unknown>({ namespace: "alpha", ttlMs: 60_000 });
    const b = new InMemoryCache<unknown>({ namespace: "beta", ttlMs: 60_000 });

    await a.set("user:1", "a1");
    await a.set("user:2", "a2");
    await a.set("other", "a-other");
    await b.set("user:1", "b1");
    await b.set("other", "b-other");

    const removedA = await a.deleteByPrefix("user:");
    expect(removedA).toBe(2);

    // alpha: only user:* keys removed.
    expect(await a.get("user:1")).toBeNull();
    expect(await a.get("user:2")).toBeNull();
    expect(await a.get("other")).toBe("a-other");

    // beta: entirely unaffected — separate store.
    expect(await b.get("user:1")).toBe("b1");
    expect(await b.get("other")).toBe("b-other");
  });

  it("deleteByPrefix with empty prefix deletes every key in the namespaced cache", async () => {
    const cache = new InMemoryCache<unknown>({ namespace: "ext-2", ttlMs: 60_000 });
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3);

    const removed = await cache.deleteByPrefix("");
    expect(removed).toBe(3);
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBeNull();
    expect(await cache.get("c")).toBeNull();
  });

  it("clear() wipes every key in the cache but leaves the namespace intact for future writes", async () => {
    const cache = new InMemoryCache<unknown>({ namespace: "ext-3", ttlMs: 60_000 });
    await cache.set("k1", "v1");
    await cache.set("k2", "v2");
    expect(cache.size).toBe(2);

    await cache.clear();
    expect(cache.size).toBe(0);
    expect(await cache.get("k1")).toBeNull();

    // Post-clear writes still go through the namespace prefix.
    await cache.set("k3", "v3");
    expect(await cache.get("k3")).toBe("v3");
    expect(cache.size).toBe(1);
  });
});

describe("InMemoryCache — getOrSet single-flight", () => {
  it("single-flight across many concurrent callers (only one loader invocation)", async () => {
    const cache = new InMemoryCache<unknown>({ ttlMs: 60_000 });
    let calls = 0;
    const loader = async (): Promise<string> => {
      calls += 1;
      // Simulate a slow loader so concurrent callers arrive while the
      // first one is still in-flight.
      await new Promise((r) => setTimeout(r, 30));
      return `loaded-${calls}`;
    };

    const results = await Promise.all([
      cache.getOrSet("hot-key", loader),
      cache.getOrSet("hot-key", loader),
      cache.getOrSet("hot-key", loader),
      cache.getOrSet("hot-key", loader),
      cache.getOrSet("hot-key", loader),
    ]);

    // Every caller received the same value (from the single loader invocation).
    expect(calls).toBe(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("loaded-1");

    // Subsequent calls hit the cache; loader is NOT invoked again.
    const cached = await cache.getOrSet("hot-key", loader);
    expect(cached).toBe("loaded-1");
    expect(calls).toBe(1);
  });

  it("concurrent getOrSet for DIFFERENT keys invoke the loader once per key", async () => {
    const cache = new InMemoryCache<unknown>({ ttlMs: 60_000 });
    const callsByKey = new Map<string, number>();

    const loader = async (key: string): Promise<string> => {
      const n = (callsByKey.get(key) ?? 0) + 1;
      callsByKey.set(key, n);
      await new Promise((r) => setTimeout(r, 20));
      return `value-${key}`;
    };

    // For each key, fire three concurrent getOrSet calls.
    const keys = ["k1", "k2", "k3"];
    await Promise.all(
      keys.flatMap((k) => [
        cache.getOrSet(k, () => loader(k)),
        cache.getOrSet(k, () => loader(k)),
        cache.getOrSet(k, () => loader(k)),
      ]),
    );

    // Each key's loader was invoked exactly once.
    for (const k of keys) {
      expect(callsByKey.get(k)).toBe(1);
    }
  });

  it("single-flight releases the in-flight slot after a loader throws", async () => {
    const cache = new InMemoryCache<unknown>({ ttlMs: 60_000 });
    let calls = 0;
    const failingLoader = async (): Promise<string> => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("loader failure");
    };

    // Three concurrent callers — all see the same failure.
    const results = await Promise.allSettled([
      cache.getOrSet("fail-key", failingLoader),
      cache.getOrSet("fail-key", failingLoader),
      cache.getOrSet("fail-key", failingLoader),
    ]);

    // Every caller was rejected.
    for (const r of results) {
      expect(r.status).toBe("rejected");
    }
    // The loader was invoked exactly once (single-flight).
    expect(calls).toBe(1);

    // The in-flight slot was released — a fresh getOrSet after the failure
    // invokes the loader again rather than hanging on a stale promise.
    const beforeRetry = calls;
    await expect(cache.getOrSet("fail-key", failingLoader)).rejects.toThrow(
      "loader failure",
    );
    expect(calls).toBe(beforeRetry + 1);
  });

  it("single-flight honours custom TTL options on the cache write", async () => {
    const cache = new InMemoryCache<unknown>({ ttlMs: 60_000 });
    let calls = 0;
    const loader = async (): Promise<string> => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return "short-lived";
    };

    // First call populates the cache with a 20ms TTL.
    const first = await cache.getOrSet("ttl-key", loader, { ttlMs: 20 });
    expect(first).toBe("short-lived");
    expect(calls).toBe(1);

    // Immediate subsequent call hits the cache (no new loader call).
    const second = await cache.getOrSet("ttl-key", loader, { ttlMs: 20 });
    expect(second).toBe("short-lived");
    expect(calls).toBe(1);

    // After the TTL expires, the loader is invoked again.
    await new Promise((r) => setTimeout(r, 30));
    const third = await cache.getOrSet("ttl-key", loader, { ttlMs: 20 });
    expect(third).toBe("short-lived");
    expect(calls).toBe(2);
  });
});
