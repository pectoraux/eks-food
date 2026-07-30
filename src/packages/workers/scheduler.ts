/** Schedule a job to run at a specific time (cron-style scheduling lives in the infra layer). */
import { queue } from "./queue";
import type { JobOptions } from "./types";

export function scheduleJob<T>(type: string, payload: T, runAt: Date, opts?: Omit<JobOptions, "delayMs" | "runAt">): string {
  return queue().enqueue(type, payload, { ...opts, runAt: runAt.getTime() });
}
