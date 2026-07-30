/**
 * Brute-force protection — progressive account lockout.
 *
 * Tracks failed login attempts per user. After a threshold of consecutive
 * failures, the account is locked for an exponentially increasing duration.
 * Resets on successful login. State is held in the cache (Redis in prod) so it
 * works across instances.
 */
import { cache } from "@eks/cache";

const KEY_PREFIX = "bf:";
const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 60_000; // 1 min
const MAX_LOCK_MS = 60 * 60_000; // 1 hour

export interface LockoutState {
  attempts: number;
  locked: boolean;
  lockedUntilMs: number | null;
}

export class BruteForceProtector {
  async recordFailure(userId: string): Promise<LockoutState> {
    const key = `${KEY_PREFIX}${userId}`;
    const c = cache<{ attempts: number; lockedUntil: number | null }>();
    const state = (await c.get(key)) ?? { attempts: 0, lockedUntil: null };
    const now = Date.now();
    // If a lock has expired, reset the attempt counter.
    if (state.lockedUntil && state.lockedUntil < now) {
      state.attempts = 0;
      state.lockedUntil = null;
    }
    const attempts = state.attempts + 1;
    let lockedUntil: number | null = null;
    if (attempts >= MAX_ATTEMPTS) {
      const lockMs = Math.min(BASE_LOCK_MS * 2 ** (attempts - MAX_ATTEMPTS), MAX_LOCK_MS);
      lockedUntil = now + lockMs;
    }
    await c.set(key, { attempts, lockedUntil }, { ttlMs: 24 * 60 * 60_000 });
    return { attempts, locked: lockedUntil !== null && lockedUntil > now, lockedUntilMs: lockedUntil };
  }

  async recordSuccess(userId: string): Promise<void> {
    await cache().delete(`${KEY_PREFIX}${userId}`);
  }

  async getState(userId: string): Promise<LockoutState> {
    const state = await cache<{ attempts: number; lockedUntil: number | null }>().get(`${KEY_PREFIX}${userId}`);
    if (!state) return { attempts: 0, locked: false, lockedUntilMs: null };
    const now = Date.now();
    const locked = state.lockedUntil !== null && state.lockedUntil > now;
    return { attempts: state.attempts, locked, lockedUntilMs: state.lockedUntil };
  }

  async reset(userId: string): Promise<void> {
    await cache().delete(`${KEY_PREFIX}${userId}`);
  }
}
