/** Cache-aside & write-through patterns built on the Cache interface. */
import type { Cache } from "./types";

/**
 * Cache-aside: read from cache; on miss, load from source, populate cache, return.
 */
export async function cacheAside<V, S>(
  cache: Cache,
  key: string,
  loader: () => Promise<V>,
  opts?: { ttlMs?: number; namespace?: string }
): Promise<V> {
  const cached = await cache.get<V>(key);
  if (cached !== null) return cached;
  const value = await loader();
  await cache.set(key, value, opts);
  return value;
}

/**
 * Write-through: write to the source, then synchronously update the cache.
 * Returns the source result; cache update failures are logged but non-fatal.
 */
export async function writeThrough<V, R>(
  cache: Cache,
  key: string,
  writer: () => Promise<R>,
  readBack: () => Promise<V>,
  opts?: { ttlMs?: number; namespace?: string }
): Promise<R> {
  const result = await writer();
  try {
    const fresh = await readBack();
    await cache.set(key, fresh, opts);
  } catch {
    // cache refresh is best-effort; the source write already succeeded
  }
  return result;
}
