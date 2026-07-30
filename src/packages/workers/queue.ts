/**
 * In-process job queue with priority, delay, retries, and DLQ.
 *
 * Production swap: implement the same `JobQueue` interface against BullMQ
 * (Redis). Application code (handlers + enqueue calls) never changes.
 */
import type { Job, JobHandler, JobOptions, QueueStats } from "./types";
import { uuid } from "@eks/common";
import { logger } from "@eks/observability/logger";
import { metrics } from "@eks/observability/metrics";

const enqueued = metrics().counter("jobs_enqueued", "Jobs enqueued");
const completed = metrics().counter("jobs_completed", "Jobs completed");
const failed = metrics().counter("jobs_failed", "Jobs failed");
const deadLettered = metrics().counter("jobs_dead_lettered", "Jobs dead-lettered");

export interface Worker {
  readonly type: string;
  stop(): void;
}

export class JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly pending: Job[] = [];
  private active = 0;
  private completedCount = 0;
  private failedCount = 0;
  private readonly dlq: Job[] = [];
  private readonly inflightIdempotency = new Set<string>();
  private readonly concurrency: number;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(concurrency = 4) {
    this.concurrency = concurrency;
  }

  register<T>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  enqueue<T>(type: string, payload: T, opts?: JobOptions): string {
    const id = uuid();
    if (opts?.idempotencyKey && this.inflightIdempotency.has(opts.idempotencyKey)) {
      return id; // duplicate — skip
    }
    if (opts?.idempotencyKey) this.inflightIdempotency.add(opts.idempotencyKey);
    const job: Job<T> = {
      id,
      type,
      payload,
      attempts: 0,
      maxAttempts: opts?.maxAttempts ?? 3,
      priority: opts?.priority ?? 0,
      runAt: opts?.runAt ?? (opts?.delayMs ? Date.now() + opts.delayMs : Date.now()),
      createdAt: Date.now(),
      idempotencyKey: opts?.idempotencyKey,
    };
    this.pending.push(job);
    // Max-heap by priority, then earliest runAt.
    this.pending.sort((a, b) => b.priority - a.priority || a.runAt - b.runAt);
    enqueued.inc();
    return id;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollTimer = setInterval(() => this.tick(), 100);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async tick(): Promise<void> {
    if (this.active >= this.concurrency) return;
    const now = Date.now();
    const idx = this.pending.findIndex((j) => j.runAt <= now);
    if (idx < 0) return;
    const job = this.pending.splice(idx, 1)[0];
    this.active += 1;
    void this.runJob(job).finally(() => { this.active -= 1; });
  }

  private async runJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      logger().error("jobs.no_handler", { type: job.type });
      this.dlq.push(job);
      deadLettered.inc();
      return;
    }
    try {
      await handler(job);
      this.completedCount += 1;
      completed.inc();
      if (job.idempotencyKey) this.inflightIdempotency.delete(job.idempotencyKey);
    } catch (e) {
      const attempts = job.attempts + 1;
      (job as { attempts: number }).attempts = attempts;
      logger().warn("jobs.failed", { type: job.type, attempts, error: e instanceof Error ? e.message : String(e) });
      if (attempts >= job.maxAttempts) {
        this.dlq.push({ ...job, attempts });
        deadLettered.inc();
        this.failedCount += 1;
        failed.inc();
        if (job.idempotencyKey) this.inflightIdempotency.delete(job.idempotencyKey);
      } else {
        // Re-enqueue with exponential backoff.
        this.pending.push({ ...job, runAt: Date.now() + 200 * 2 ** (attempts - 1) });
        this.pending.sort((a, b) => b.priority - a.priority || a.runAt - b.runAt);
      }
    }
  }

  stats(): QueueStats {
    return {
      pending: this.pending.length,
      active: this.active,
      completed: this.completedCount,
      failed: this.failedCount,
      deadLettered: this.dlq.length,
    };
  }

  deadLetter(): readonly Job[] {
    return [...this.dlq];
  }

  clear(): void {
    this.pending.length = 0;
    this.dlq.length = 0;
    this.inflightIdempotency.clear();
    this.completedCount = 0;
    this.failedCount = 0;
  }
}

let _queue: JobQueue | null = null;
export function queue(): JobQueue {
  if (!_queue) {
    _queue = new JobQueue();
    _queue.start();
  }
  return _queue;
}

export function registerWorker<T>(type: string, handler: JobHandler<T>): Worker {
  queue().register(type, handler);
  return {
    type,
    stop() { /* in-process: nothing to stop per-type */ },
  };
}
