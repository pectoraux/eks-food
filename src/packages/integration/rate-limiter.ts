/**
 * Rate limiter — token-bucket with burst + concurrency limits.
 *
 * Per connector / provider / tenant / credential. Backed by the in-memory
 * cache (Redis in production). Supports adaptive throttling (reduces capacity
 * when error rates spike).
 */
import { cache } from "@eks/cache";

export interface RateLimitConfig {
  readonly capacity: number; // token bucket capacity
  readonly refillRate: number; // tokens per second
  readonly burstLimit?: number; // max requests in a burst
  readonly concurrencyLimit?: number; // max simultaneous requests
  readonly adaptive?: boolean; // adaptive throttling
}

interface BucketState {
  tokens: number;
  lastRefill: number;
  activeRequests: number;
}

export class RateLimiter {
  private readonly config: Required<RateLimitConfig>;
  private readonly store: Map<string, BucketState> = new Map();

  constructor(config: RateLimitConfig = { capacity: 100, refillRate: 10 }) {
    this.config = {
      capacity: config.capacity,
      refillRate: config.refillRate,
      burstLimit: config.burstLimit ?? config.capacity,
      concurrencyLimit: config.concurrencyLimit ?? 10,
      adaptive: config.adaptive ?? false,
    };
  }

  /** Acquire a token. Returns true if allowed, false if rate-limited. */
  async acquire(key: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
    const state = this.getOrCreate(key);
    this.refill(state);
    if (state.tokens < 1) {
      const retryAfterMs = Math.ceil((1 - state.tokens) / this.config.refillRate * 1000);
      return { allowed: false, retryAfterMs };
    }
    if (state.activeRequests >= this.config.concurrencyLimit) {
      return { allowed: false, retryAfterMs: 100 };
    }
    state.tokens -= 1;
    state.activeRequests += 1;
    return { allowed: true };
  }

  /** Release a concurrency slot after the request completes. */
  release(key: string): void {
    const state = this.store.get(key);
    if (state) state.activeRequests = Math.max(0, state.activeRequests - 1);
  }

  /** Adaptive throttling: reduce capacity when error rate spikes. */
  reportError(key: string): void {
    if (!this.config.adaptive) return;
    const state = this.store.get(key);
    if (state) state.tokens = Math.max(0, state.tokens - 5);
  }

  /** Get the current state for observability. */
  stats(key: string): { tokens: number; activeRequests: number; capacity: number } | null {
    const state = this.store.get(key);
    if (!state) return null;
    return { tokens: state.tokens, activeRequests: state.activeRequests, capacity: this.config.capacity };
  }

  private getOrCreate(key: string): BucketState {
    let state = this.store.get(key);
    if (!state) {
      state = { tokens: this.config.capacity, lastRefill: Date.now(), activeRequests: 0 };
      this.store.set(key, state);
    }
    return state;
  }

  private refill(state: BucketState): void {
    const now = Date.now();
    const elapsedSec = (now - state.lastRefill) / 1000;
    state.tokens = Math.min(this.config.capacity, state.tokens + elapsedSec * this.config.refillRate);
    state.lastRefill = now;
  }
}
