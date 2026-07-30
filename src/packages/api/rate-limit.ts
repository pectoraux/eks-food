import type { NextRequest } from "next/server";
import { RateLimitError } from "@eks/errors";
import { cache } from "@eks/cache";

export interface RateLimiter {
  /** Returns when the next request is allowed; throws RateLimitError if exceeded. */
  check(req: NextRequest, opts?: { limit?: number; windowMs?: number }): Promise<void>;
}

/** Sliding-window rate limiter backed by the cache. Keyed on IP + route. */
export async function rateLimit(
  req: NextRequest,
  opts: { limit?: number; windowMs?: number; keyFn?: (req: NextRequest) => string } = {}
): Promise<void> {
  const limit = opts.limit ?? 120;
  const windowMs = opts.windowMs ?? 60_000;
  const key = opts.keyFn ? opts.keyFn(req) : `rl:${req.headers.get("x-forwarded-for") ?? "anon"}:${req.nextUrl.pathname}`;

  const now = Date.now();
  const c = cache<ReadonlyArray<number>>();
  const hits = (await c.get(key)) ?? [];
  const recent = hits.filter((t) => t > now - windowMs);
  if (recent.length >= limit) {
    const retryAfterMs = windowMs - (now - recent[0]);
    throw new RateLimitError(`Rate limit exceeded (${limit} per ${windowMs / 1000}s)`, retryAfterMs);
  }
  recent.push(now);
  await c.set(key, recent, { ttlMs: windowMs });
}
