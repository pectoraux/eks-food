/**
 * Retry policies with exponential backoff + jitter. Production-grade: honours
 * a max-attempts cap, an overall deadline, optional predicate to decide which
 * errors are retryable, and an injectable sleeper for testability.
 */
import type { Result } from "./result";
import { ok, err } from "./result";

export interface RetryOptions {
  /** Max total attempts (including the first). Default 3. */
  readonly maxAttempts?: number;
  /** Base delay in ms. Default 100. */
  readonly baseDelayMs?: number;
  /** Backoff multiplier. Default 2. */
  readonly multiplier?: number;
  /** Max delay cap per attempt. Default 5000. */
  readonly maxDelayMs?: number;
  /** Overall deadline in ms. Default 15000. */
  readonly deadlineMs?: number;
  /** Decide whether an error should be retried. Default: retry on all errors. */
  readonly retryIf?: (error: unknown) => boolean;
  /** Inject sleeper (tests). Default: real setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface RetryAttempt {
  readonly attempt: number;
  readonly delayMs: number;
  readonly error: unknown;
}

export interface RetryOutcome<T> {
  readonly result: Result<T>;
  readonly attempts: readonly RetryAttempt[];
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryOutcome<T>> {
  const {
    maxAttempts = 3,
    baseDelayMs = 100,
    multiplier = 2,
    maxDelayMs = 5000,
    deadlineMs = 15000,
    retryIf = () => true,
    sleep = defaultSleep,
  } = options;

  const deadline = Date.now() + deadlineMs;
  const attempts: RetryAttempt[] = [];
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn(attempt);
      return { result: ok(value), attempts };
    } catch (e) {
      lastError = e;
      const delay = computeDelay(attempt, baseDelayMs, multiplier, maxDelayMs);
      attempts.push({ attempt, delayMs: delay, error: e });

      const isLast = attempt >= maxAttempts;
      const pastDeadline = Date.now() + delay > deadline;
      if (isLast || pastDeadline || !retryIf(e)) {
        return { result: err(lastError as Error), attempts };
      }
      await sleep(delay);
    }
  }
  return { result: err(lastError as Error), attempts };
}

export function computeDelay(
  attempt: number,
  base: number,
  multiplier: number,
  max: number
): number {
  const exp = base * multiplier ** (attempt - 1);
  // Full jitter — never delay more than the exponential cap.
  const capped = Math.min(exp, max);
  return Math.floor(Math.random() * capped);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
