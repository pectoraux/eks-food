/**
 * Connector Cache — stale-while-revalidate + request coalescing.
 * Reduces external API calls and costs. Per-provider + per-tenant namespacing.
 */
import { cache as getCache } from "@eks/cache";

export interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  ttlMs: number;
}

export class ConnectorCache {
  private readonly c = getCache<unknown>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Get a value from the cache, or fetch it. If the value is stale (past TTL
   * but within 2x TTL), return the stale value AND trigger a background refresh
   * (stale-while-revalidate). If multiple requests arrive for the same key
   * simultaneously, they share a single fetch (request coalescing).
   */
  async getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
    const namespacedKey = this.ns(key);
    const entry = (await this.c.get<CacheEntry<T>>(namespacedKey)) as CacheEntry<T> | null;

    if (entry) {
      const age = Date.now() - entry.fetchedAt;
      // Fresh: return immediately.
      if (age < entry.ttlMs) return entry.value;
      // Stale (within 2x TTL): return stale + background refresh (SWR).
      if (age < entry.ttlMs * 2) {
        this.backgroundRefresh(namespacedKey, fetcher, ttlMs);
        return entry.value;
      }
      // Expired: fall through to fetch.
    }

    // Request coalescing: if a fetch is already in flight for this key, await it.
    const inflight = this.inflight.get(namespacedKey);
    if (inflight) return inflight as Promise<T>;

    const promise = this.doFetch(namespacedKey, fetcher, ttlMs);
    this.inflight.set(namespacedKey, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(namespacedKey);
    }
  }

  /** Invalidate a cache entry. */
  async invalidate(key: string): Promise<void> {
    await this.c.delete(this.ns(key));
  }

  /** Invalidate all entries for a provider (by prefix). */
  async invalidateProvider(providerCode: string): Promise<void> {
    await this.c.deleteByPrefix(`conn:${providerCode}:`);
  }

  private async doFetch<T>(namespacedKey: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
    const value = await fetcher();
    const entry: CacheEntry<T> = { value, fetchedAt: Date.now(), ttlMs };
    await this.c.set(namespacedKey, entry, { ttlMs: ttlMs * 2 });
    return value;
  }

  private backgroundRefresh<T>(namespacedKey: string, fetcher: () => Promise<T>, ttlMs: number): void {
    // Fire-and-forget background refresh (no request coalescing for SWR).
    this.doFetch(namespacedKey, fetcher, ttlMs).catch(() => {
      // Background refresh failure is non-fatal; the stale value remains.
    });
  }

  private ns(key: string): string {
    return `conn:${key}`;
  }
}
