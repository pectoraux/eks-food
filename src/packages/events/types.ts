import type { UUID, ISODateString } from "@eks/common";

/** Base metadata shared by every event tier. */
export interface EventMetadata {
  readonly eventId: UUID;
  readonly occurredAt: ISODateString;
  readonly correlationId: UUID;
  readonly causationId: UUID | null;
  readonly version: 1;
  readonly traceId?: UUID;
  readonly actorUserId?: UUID | null;
  readonly organizationId?: UUID | null;
}

/** Domain event — raised within an aggregate, persisted to the outbox. */
export interface DomainEvent extends EventMetadata {
  readonly tier: "domain";
  readonly aggregateType: string;
  readonly aggregateId: UUID;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Integration event — published across service boundaries. */
export interface IntegrationEvent extends EventMetadata {
  readonly tier: "integration";
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Consumers that have acknowledged (for exactly-once coordination). */
  readonly ackedConsumers?: readonly string[];
}

/** Internal event — in-process pub/sub, never persisted. */
export interface InternalEvent extends EventMetadata {
  readonly tier: "internal";
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type EventEnvelope = DomainEvent | IntegrationEvent | InternalEvent;
