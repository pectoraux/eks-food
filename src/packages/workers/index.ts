/**
 * @eks/workers — background job framework.
 *
 * Supports: retries with backoff, scheduling, delayed jobs, priority queues,
 * dead-letter queues, monitoring, and idempotency. The interface is
 * broker-agnostic (BullMQ/Redis in production); an in-process implementation
 * runs for the foundation milestone.
 */
export type { Job, JobHandler, JobOptions, QueueStats } from "./types";
export { JobQueue, queue, registerWorker, type Worker } from "./queue";
export { scheduleJob } from "./scheduler";
