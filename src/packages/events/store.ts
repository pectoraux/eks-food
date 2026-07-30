/** In-memory event store for replay & audit. Production uses the DB outbox table. */
import type { DomainEvent } from "./types";

export class InMemoryEventStore {
  private readonly byAggregate = new Map<string, DomainEvent[]>();
  private readonly all: DomainEvent[] = [];

  append(event: DomainEvent): void {
    this.all.push(event);
    const key = `${event.aggregateType}:${event.aggregateId}`;
    const list = this.byAggregate.get(key) ?? [];
    list.push(event);
    this.byAggregate.set(key, list);
  }

  /** Replay events for a single aggregate, in order. */
  replay(aggregateType: string, aggregateId: string): readonly DomainEvent[] {
    return this.byAggregate.get(`${aggregateType}:${aggregateId}`) ?? [];
  }

  /** Replay all events of a given type (for projections/read models). */
  replayType(eventType: string): readonly DomainEvent[] {
    return this.all.filter((e) => e.eventType === eventType);
  }

  size(): number {
    return this.all.length;
  }

  clear(): void {
    this.byAggregate.clear();
    this.all.length = 0;
  }
}
