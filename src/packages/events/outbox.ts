/**
 * Transactional outbox — persists domain events in the same DB transaction as
 * the aggregate write, then a relay publishes them to the event bus. Guarantees
 * at-least-once delivery without dual-write inconsistency.
 *
 * Production: this is a Prisma-backed table scanned by a worker. The in-memory
 * implementation here is for the foundation milestone and unit tests; the
 * Prisma model `EventOutbox` is defined in the schema for production use.
 */
import type { DomainEvent } from "./types";
import { eventBus } from "./bus";
import { logger } from "@eks/observability/logger";
import { asISODate } from "@eks/common";

interface OutboxRecord {
  readonly id: string;
  readonly event: DomainEvent;
  readonly status: "PENDING" | "PUBLISHED" | "FAILED";
  readonly attempts: number;
  readonly createdAt: string;
  readonly publishedAt: string | null;
  readonly lastError: string | null;
}

export class EventOutbox {
  private readonly records = new Map<string, OutboxRecord>();

  /** Stage an event for publication (call inside the aggregate's DB transaction). */
  async stage(event: DomainEvent): Promise<string> {
    const id = event.eventId;
    this.records.set(id, {
      id, event, status: "PENDING", attempts: 0,
      createdAt: asISODate(new Date()), publishedAt: null, lastError: null,
    });
    return id;
  }

  /** Relay pending events to the bus. Called by a worker on a schedule. */
  async relayBatch(batchSize = 50): Promise<{ published: number; failed: number }> {
    const pending = Array.from(this.records.values())
      .filter((r) => r.status === "PENDING")
      .slice(0, batchSize);
    let published = 0;
    let failed = 0;
    for (const record of pending) {
      try {
        await eventBus().publish(record.event);
        this.records.set(record.id, { ...record, status: "PUBLISHED", publishedAt: asISODate(new Date()), attempts: record.attempts + 1 });
        published += 1;
      } catch (e) {
        const attempts = record.attempts + 1;
        const failed_ = attempts >= 5;
        this.records.set(record.id, {
          ...record,
          status: failed_ ? "FAILED" : "PENDING",
          attempts,
          lastError: e instanceof Error ? e.message : String(e),
        });
        failed += 1;
        logger().warn("outbox.relay_failed", { eventId: record.id, attempts });
      }
    }
    return { published, failed };
  }

  /** Replay a single event (admin operation). */
  async replay(eventId: string): Promise<boolean> {
    const record = this.records.get(eventId);
    if (!record) return false;
    try {
      await eventBus().publish(record.event);
      this.records.set(eventId, { ...record, status: "PUBLISHED", publishedAt: asISODate(new Date()) });
      return true;
    } catch {
      return false;
    }
  }

  pendingCount(): number {
    let n = 0;
    for (const r of this.records.values()) if (r.status === "PENDING") n += 1;
    return n;
  }

  stats(): { pending: number; published: number; failed: number; total: number } {
    let pending = 0, published = 0, failed = 0;
    for (const r of this.records.values()) {
      if (r.status === "PENDING") pending += 1;
      else if (r.status === "PUBLISHED") published += 1;
      else if (r.status === "FAILED") failed += 1;
    }
    return { pending, published, failed, total: this.records.size };
  }

  clear(): void {
    this.records.clear();
  }
}

let _outbox: EventOutbox;
export function outbox(): EventOutbox {
  if (!_outbox) _outbox = new EventOutbox();
  return _outbox;
}
