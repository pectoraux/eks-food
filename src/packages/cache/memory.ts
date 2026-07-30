/** In-memory cache with TTL, namespaces, stampede protection & metrics. */
import type { Cache, CacheOptions, Lock, LockOptions } from "./types";
import { metrics } from "@eks/observability/metrics";

interface Entry<V> {
  value: V;
  expiresAt: number | null;
}

const hits = metrics().counter("cache_hits", "Cache hits");
const misses = metrics().counter("cache_misses", "Cache misses");
const sets = metrics().counter("cache_sets", "Cache sets");
const evictions = metrics().counter("cache_evictions", "Cache evictions");

export class InMemoryCache<V = unknown> implements Cache<V> {
  private readonly store = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>(); // single-flight
  private readonly defaultTtlMs: number;
  private readonly defaultNamespace: string;

  constructor(opts?: CacheOptions) {
    this.defaultTtlMs = opts?.ttlMs ?? 60_000;
    this.defaultNamespace = opts?.namespace ?? "";
  }

  get size(): number {
    return this.store.size;
  }

  async get<T>(key: string): Promise<T | null> {
    const k = this.ns(key);
    const entry = this.store.get(k);
    if (!entry) { misses.inc(); return null; }
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(k);
      evictions.inc();
      misses.inc();
      return null;
    }
    hits.inc();
    return entry.value as T;
  }

  async set<T>(key: string, value: T, opts?: CacheOptions): Promise<void> {
    const k = this.ns(key);
    const ttl = opts?.ttlMs ?? this.defaultTtlMs;
    this.store.set(k, { value, expiresAt: ttl > 0 ? Date.now() + ttl : null });
    sets.inc();
  }

  async delete(key: string): Promise<void> {
    this.store.delete(this.ns(key));
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const full = this.ns(prefix);
    let count = 0;
    for (const k of this.store.keys()) {
      if (k.startsWith(full)) { this.store.delete(k); count += 1; }
    }
    return count;
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(this.ns(key));
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.inflight.clear();
  }

  async getOrSet<T>(key: string, loader: () => Promise<T>, opts?: CacheOptions): Promise<T> {
    const existing = await this.get<T>(key);
    if (existing !== null) return existing;
    const k = this.ns(key);
    const inflight = this.inflight.get(k);
    if (inflight) return inflight as Promise<T>;
    const p = (async () => {
      try {
        const value = await loader();
        await this.set(key, value, opts);
        return value;
      } finally {
        this.inflight.delete(k);
      }
    })();
    this.inflight.set(k, p);
    return p;
  }

  /** Acquire a simple spin-lock keyed on `key`. */
  async acquireLock(key: string, opts?: LockOptions): Promise<Lock> {
    const k = `lock:${this.ns(key)}`;
    const ttl = opts?.ttlMs ?? 5000;
    const retryDelay = opts?.retryDelayMs ?? 50;
    const retryCount = opts?.retryCount ?? 20;
    let acquired = false;
    for (let i = 0; i < retryCount; i++) {
      if (!this.store.has(k)) {
        this.store.set(k, { value: true, expiresAt: Date.now() + ttl });
        acquired = true;
        break;
      }
      await sleep(retryDelay);
    }
    return new InMemoryLock(this, k, acquired);
  }

  private ns(key: string): string {
    return this.defaultNamespace ? `${this.defaultNamespace}:${key}` : key;
  }
}

class InMemoryLock implements Lock {
  constructor(
    private readonly cache: InMemoryCache,
    public readonly key: string,
    public readonly acquired: boolean
  ) {}

  async release(): Promise<void> {
    this.cache["delete"](this.key);
  }

  async extend(ttlMs: number): Promise<boolean> {
    const entry = this.cache["store"].get(this.key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + ttlMs;
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
