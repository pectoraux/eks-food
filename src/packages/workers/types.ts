export interface Job<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly payload: T;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly priority: number; // higher = sooner
  readonly runAt: number; // epoch ms (supports delays/scheduling)
  readonly createdAt: number;
  readonly idempotencyKey?: string;
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>;

export interface JobOptions {
  readonly delayMs?: number;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly idempotencyKey?: string;
  readonly runAt?: number;
}

export interface QueueStats {
  readonly pending: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly deadLettered: number;
}
