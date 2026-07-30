/**
 * Idempotency-key support for POST/PUT endpoints.
 *
 * Stores the response for an Idempotency-Key so a retry within the window
 * returns the original result instead of double-executing. Mirrors the
 * Stripe/Payswap semantics.
 */
import type { NextRequest } from "next/server";
import { cache } from "@eks/cache";

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

export interface IdempotentResult {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

export async function idempotency<T>(
  req: NextRequest,
  fn: () => Promise<IdempotentResult & { body: T }>
): Promise<IdempotentResult> {
  const key = req.headers.get("idempotency-key");
  if (!key) return fn();

  const cacheKey = `idm:${key}:${req.nextUrl.pathname}`;
  const c = cache<IdempotentResult>();
  const cached = await c.get(cacheKey);
  if (cached) return cached;

  const result = await fn();
  await c.set(cacheKey, result, { ttlMs: WINDOW_MS });
  return result;
}
