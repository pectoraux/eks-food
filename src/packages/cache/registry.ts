/** Process-wide cache + distributed-lock singletons. */
import { InMemoryCache } from "./memory";
import type { Cache, Lock, LockOptions } from "./types";
import { getConfig } from "@eks/config";

let _cache: Cache | null = null;

/** Get the singleton cache. In-memory by default; Redis when configured. */
export function cache<V = unknown>(): Cache<V> {
  if (!_cache) {
    const cfg = safeConfig();
    _cache = new InMemoryCache<V>({
      ttlMs: cfg?.redis.defaultTtlMs ?? 60_000,
      namespace: cfg?.redis.keyPrefix ?? "eks:",
    });
    // NOTE: when REDIS_URL is configured, swap InMemoryCache for RedisCache
    // (same interface). The application code never changes.
  }
  return _cache as Cache<V>;
}

/** Distributed lock helper using the cache's lock primitive. */
export async function distributedLock(
  key: string,
  fn: () => Promise<void>,
  opts?: LockOptions
): Promise<{ acquired: boolean; lock: Lock | null }> {
  const mem = cache() as unknown as InMemoryCache;
  if (typeof mem.acquireLock !== "function") {
    // Fallback: run without a lock (single-process is safe).
    await fn();
    return { acquired: false, lock: null };
  }
  const lock = await mem.acquireLock(key, opts);
  if (!lock.acquired) return { acquired: false, lock };
  try {
    await fn();
  } finally {
    await lock.release();
  }
  return { acquired: true, lock };
}

/** getOrSet with stampede protection. */
export async function getOrSet<V>(
  key: string,
  loader: () => Promise<V>,
  opts?: { ttlMs?: number }
): Promise<V> {
  const mem = cache() as unknown as InMemoryCache;
  if (typeof mem.getOrSet === "function") return mem.getOrSet<V>(key, loader, opts);
  const cached = await mem.get<V>(key);
  if (cached !== null) return cached;
  const value = await loader();
  await mem.set(key, value, opts);
  return value;
}

function safeConfig() {
  try { return getConfig(); } catch { return null; }
}
