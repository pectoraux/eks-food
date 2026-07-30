/**
 * Event bus — in-process pub/sub with idempotency, per-aggregate ordering,
 * retries, and a dead-letter queue. Designed to be swapped for a distributed
 * broker (Redis Streams / Kafka / NATS) without changing consumer code.
 */
import type { EventEnvelope } from "./types";
import { dlq as getDlq } from "./dlq";
import { requestContext } from "@eks/observability/context";
import { logger } from "@eks/observability/logger";
import { uuid, asISODate } from "@eks/common";

export type EventHandler<E extends EventEnvelope = EventEnvelope> = (event: E) => Promise<void>;

interface Subscription {
  readonly id: string;
  readonly eventType: string;
  readonly handler: EventHandler;
  readonly maxAttempts: number;
}

export class EventBus {
  private readonly subscriptions = new Map<string, Subscription[]>();
  private readonly deliveryLog = new Set<string>(); // eventId:subscriptionId for idempotency
  private readonly perAggregateQueue = new Map<string, Promise<void>>();

  subscribe(eventType: string, handler: EventHandler, opts?: { maxAttempts?: number }): () => void {
    const id = uuid();
    const sub: Subscription = { id, eventType, handler, maxAttempts: opts?.maxAttempts ?? 3 };
    const list = this.subscriptions.get(eventType) ?? [];
    list.push(sub);
    this.subscriptions.set(eventType, list);
    return () => {
      const arr = this.subscriptions.get(eventType);
      if (!arr) return;
      this.subscriptions.set(eventType, arr.filter((s) => s.id !== id));
    };
  }

  /** Publish synchronously to all matching handlers, preserving per-aggregate order. */
  async publish(event: EventEnvelope): Promise<void> {
    const handlers = this.subscriptions.get(event.eventType) ?? [];
    if (handlers.length === 0) return;

    // Per-aggregate ordering: serialize deliveries for the same aggregate.
    const orderKey = "aggregateId" in event ? event.aggregateId : event.eventId;
    const prev = this.perAggregateQueue.get(orderKey) ?? Promise.resolve();
    const next = prev.then(() => this.deliverToAll(event, handlers)).catch(() => {
      // already logged inside deliverToAll; swallow to keep the chain alive
    });
    this.perAggregateQueue.set(orderKey, next);
    await next;
  }

  private async deliverToAll(event: EventEnvelope, handlers: Subscription[]): Promise<void> {
    await Promise.all(handlers.map((h) => this.deliverOne(event, h)));
  }

  private async deliverOne(event: EventEnvelope, sub: Subscription): Promise<void> {
    const idempotencyKey = `${event.eventId}:${sub.id}`;
    if (this.deliveryLog.has(idempotencyKey)) {
      logger().debug("event.skipped_idempotent", { eventType: event.eventType, subId: sub.id });
      return;
    }

    for (let attempt = 1; attempt <= sub.maxAttempts; attempt++) {
      try {
        await sub.handler(event);
        this.deliveryLog.add(idempotencyKey);
        return;
      } catch (e) {
        logger().warn("event.handler_failed", {
          eventType: event.eventType, subId: sub.id, attempt, error: e instanceof Error ? e.message : String(e),
        });
        if (attempt >= sub.maxAttempts) {
          await getDlq().push({ event, subscriptionId: sub.id, error: e, attempts: attempt, deadLetteredAt: asISODate(new Date()) });
          logger().error("event.dead_lettered", { eventType: event.eventType, subId: sub.id });
          return;
        }
        await sleep(50 * 2 ** (attempt - 1)); // backoff
      }
    }
  }

  /** Test helper. */
  clear(): void {
    this.subscriptions.clear();
    this.deliveryLog.clear();
    this.perAggregateQueue.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let _bus: EventBus;
export function eventBus(): EventBus {
  if (!_bus) _bus = new EventBus();
  return _bus;
}
