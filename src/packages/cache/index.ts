/**
 * @eks/cache — Redis abstraction with an in-memory fallback.
 *
 * Supports: cache-aside, write-through, TTL, namespaced keys, distributed
 * locks, cache invalidation, stampede protection (single-flight), and metrics.
 *
 * The `Cache` interface is provider-agnostic. `InMemoryCache` is the default
 * implementation; `RedisCache` drops in when a Redis URL is configured.
 */
export type { Cache, Lock, LockOptions, CacheOptions } from "./types";
export { InMemoryCache } from "./memory";
export { distributedLock, cache, getOrSet } from "./registry";
export { cacheAside, writeThrough } from "./patterns";
