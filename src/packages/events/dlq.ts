/** Dead-letter queue for events that exhausted all delivery attempts. */
import type { EventEnvelope } from "./types";
import type { ISODateString } from "@eks/common";
import { logger } from "@eks/observability/logger";

export interface DeadLetterEntry {
  readonly event: EventEnvelope;
  readonly subscriptionId: string;
  readonly error: unknown;
  readonly attempts: number;
  readonly deadLetteredAt: ISODateString;
  /** Set when an operator replays the event. */
  replayedAt?: ISODateString;
}

export class DeadLetterQueue {
  private readonly entries: DeadLetterEntry[] = [];

  async push(entry: DeadLetterEntry): Promise<void> {
    this.entries.push(entry);
    logger().warn("dlq.push", { eventType: entry.event.eventType, attempts: entry.attempts });
  }

  list(): readonly DeadLetterEntry[] {
    return [...this.entries];
  }

  size(): number {
    return this.entries.length;
  }

  /** Remove an entry (after manual review). */
  remove(eventId: string, subscriptionId: string): void {
    const idx = this.entries.findIndex((e) => e.event.eventId === eventId && e.subscriptionId === subscriptionId);
    if (idx >= 0) this.entries.splice(idx, 1);
  }

  /** Clear all (admin / test). */
  clear(): void {
    this.entries.length = 0;
  }
}

let _dlq: DeadLetterQueue;
export function dlq(): DeadLetterQueue {
  if (!_dlq) _dlq = new DeadLetterQueue();
  return _dlq;
}
