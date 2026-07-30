import { describe, it, expect } from "vitest";
import { JobQueue } from "../queue";

describe("JobQueue", () => {
  it("processes enqueued jobs", async () => {
    const q = new JobQueue(1);
    const results: string[] = [];
    q.register("greet", async (job) => { results.push(`hi ${job.payload as string}`); });
    q.enqueue("greet", "world");
    q.start();
    await flush();
    expect(results).toEqual(["hi world"]);
    q.stop();
  });

  it("retries failed jobs up to maxAttempts", async () => {
    const q = new JobQueue(1);
    let attempts = 0;
    q.register("flaky", async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("transient");
    });
    q.enqueue("flaky", null, { maxAttempts: 3, delayMs: 0 });
    q.start();
    await flush(800);
    expect(attempts).toBe(2);
    q.stop();
  });

  it("dead-letters after exhausting attempts", async () => {
    const q = new JobQueue(1);
    q.register("doomed", async () => { throw new Error("always"); });
    q.enqueue("doomed", null, { maxAttempts: 1, delayMs: 0 });
    q.start();
    await flush(200);
    expect(q.deadLetter().length).toBe(1);
    expect(q.stats().deadLettered).toBe(1);
    q.stop();
  });

  it("respects priority ordering", async () => {
    const q = new JobQueue(1);
    const order: number[] = [];
    q.register("prio", async (job) => { order.push(job.payload as number); });
    q.enqueue("prio", 1, { priority: 1, delayMs: 0 });
    q.enqueue("prio", 2, { priority: 10, delayMs: 0 });
    q.enqueue("prio", 3, { priority: 5, delayMs: 0 });
    q.start();
    await flush(200);
    // highest priority (10) should run first
    expect(order[0]).toBe(2);
    q.stop();
  });
});

function flush(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
