/**
 * Polling engine — configurable intervals, adaptive polling, backoff, batching,
 * pagination, checkpointing, throttling.
 */
import { db } from "@/lib/db";
import { RateLimiter } from "./rate-limiter";

export interface PollConfig {
  readonly resource: string;
  readonly intervalSec: number;
  readonly adaptive?: boolean;
  readonly batchSize?: number;
  readonly maxRecords?: number;
}

export interface PollResult {
  readonly records: readonly unknown[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly recordCount: number;
  readonly durationMs: number;
}

export class PollingEngine {
  private readonly rateLimiter = new RateLimiter({ capacity: 50, refillRate: 10 });

  /** Execute a poll for a connector configuration. */
  async poll(
    configId: string,
    config: PollConfig,
    fetchFn: (cursor: string | null, batchSize: number) => Promise<{ records: readonly unknown[]; nextCursor: string | null; hasMore: boolean }>,
  ): Promise<PollResult> {
    const startedAt = Date.now();
    const rlKey = `poll:${configId}`;

    // Rate-limit check.
    const rl = await this.rateLimiter.acquire(rlKey);
    if (!rl.allowed) {
      throw new Error(`Rate limited; retry after ${rl.retryAfterMs}ms`);
    }

    try {
      // Load the last cursor.
      const job = await db.pollingJob.findFirst({ where: { configId, resource: config.resource } });
      const cursor = job?.lastCursor ?? null;
      const batchSize = config.batchSize ?? 100;

      const result = await fetchFn(cursor, batchSize);
      const recordCount = result.records.length;

      // Update the polling job with the new cursor + count.
      await db.pollingJob.upsert({
        where: { configId_resource: { configId, resource: config.resource } } as never,
        update: { lastCursor: result.nextCursor, lastRecordCount: recordCount, lastPollAt: new Date(), status: "ACTIVE" },
        create: {
          configId,
          resource: config.resource,
          intervalSec: config.intervalSec,
          adaptive: config.adaptive ?? false,
          lastCursor: result.nextCursor,
          lastRecordCount: recordCount,
          lastPollAt: new Date(),
          status: "ACTIVE",
        },
      });

      this.rateLimiter.release(rlKey);
      return {
        records: result.records,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        recordCount,
        durationMs: Date.now() - startedAt,
      };
    } catch (e) {
      this.rateLimiter.release(rlKey);
      this.rateLimiter.reportError(rlKey);
      await db.pollingJob.updateMany({
        where: { configId, resource: config.resource },
        data: { status: "ERROR", lastError: e instanceof Error ? e.message : String(e) },
      });
      throw e;
    }
  }

  /** Adaptive polling: adjust the interval based on record volume. */
  computeAdaptiveInterval(currentIntervalSec: number, recordCount: number, targetRecords: number = 50): number {
    if (recordCount === 0) return Math.min(currentIntervalSec * 2, 3600); // back off when no data
    if (recordCount > targetRecords * 2) return Math.max(Math.floor(currentIntervalSec / 2), 10); // speed up when busy
    return currentIntervalSec;
  }
}
