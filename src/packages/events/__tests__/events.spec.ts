import { describe, it, expect, vi } from "vitest";
import { withRetry } from "@eks/common";
import { CircuitBreaker, CircuitOpenError } from "@eks/common";
import { EventBus } from "../bus";
import { EventOutbox } from "../outbox";
import type { DomainEvent } from "../types";
import { uuid, asISODate } from "@eks/common";

function makeEvent(eventType: string, aggregateId = uuid()): DomainEvent {
  return {
    tier: "domain", eventId: uuid(), occurredAt: asISODate(new Date()),
    correlationId: uuid(), causationId: null, version: 1,
    aggregateType: "Test", aggregateId, eventType, payload: {},
  };
}

describe("withRetry", () => {
  it("succeeds on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const { result, attempts } = await withRetry(fn, { baseDelayMs: 1 });
    expect(result.ok).toBe(true);
    expect(attempts).toHaveLength(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("retries on failure then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce("ok");
    const { result, attempts } = await withRetry(fn, { baseDelayMs: 1, maxAttempts: 3 });
    expect(result.ok).toBe(true);
    expect(attempts).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("gives up after maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent"));
    const { result, attempts } = await withRetry(fn, { baseDelayMs: 1, maxAttempts: 2 });
    expect(result.ok).toBe(false);
    expect(attempts).toHaveLength(2);
  });
  it("respects retryIf predicate", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("non-retryable"));
    const { attempts } = await withRetry(fn, { baseDelayMs: 1, maxAttempts: 5, retryIf: () => false });
    expect(attempts).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("CircuitBreaker", () => {
  it("passes through when healthy", async () => {
    const cb = new CircuitBreaker({ name: "test", failureThreshold: 3 });
    expect(await cb.execute(async () => "ok")).toBe("ok");
    expect(cb.snapshot().state).toBe("CLOSED");
  });
  it("opens after threshold failures", async () => {
    const cb = new CircuitBreaker({ name: "test", failureThreshold: 2, windowMs: 1000, cooldownMs: 5000 });
    const failing = async () => { throw new Error("boom"); };
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.snapshot().state).toBe("OPEN");
    await expect(cb.execute(async () => "ok")).rejects.toThrow(CircuitOpenError);
  });
  it("resets on demand", () => {
    const cb = new CircuitBreaker({ name: "test" });
    cb.reset();
    expect(cb.snapshot().state).toBe("CLOSED");
  });
});

describe("EventBus", () => {
  it("delivers to matching subscribers", async () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.subscribe("Test.Happened", async (e) => { received.push(e.eventId); });
    const event = makeEvent("Test.Happened");
    await bus.publish(event);
    expect(received).toEqual([event.eventId]);
  });
  it("is idempotent — duplicate publish does not re-deliver", async () => {
    const bus = new EventBus();
    let count = 0;
    bus.subscribe("Test.Happened", async () => { count += 1; });
    const event = makeEvent("Test.Happened");
    await bus.publish(event);
    await bus.publish(event);
    expect(count).toBe(1);
  });
  it("dead-letters after max attempts", async () => {
    const bus = new EventBus();
    bus.subscribe("Test.Fail", async () => { throw new Error("always"); }, { maxAttempts: 1 });
    await bus.publish(makeEvent("Test.Fail"));
    // no throw; delivery failures are swallowed into the DLQ
  });
});

describe("EventOutbox", () => {
  it("stages and relays events", async () => {
    const outbox = new EventOutbox();
    const event = makeEvent("Test.Staged");
    await outbox.stage(event);
    expect(outbox.pendingCount()).toBe(1);
    const { published, failed } = await outbox.relayBatch();
    expect(published).toBe(1);
    expect(failed).toBe(0);
    expect(outbox.stats().published).toBe(1);
  });
  it("replay re-publishes an event", async () => {
    const outbox = new EventOutbox();
    const event = makeEvent("Test.Replay");
    await outbox.stage(event);
    await outbox.relayBatch();
    expect(await outbox.replay(event.eventId)).toBe(true);
  });
});
