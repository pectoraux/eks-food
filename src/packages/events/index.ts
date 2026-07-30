/**
 * @eks/events — event-driven infrastructure.
 *
 * Three tiers:
 *  - Domain Events:   raised inside a transaction, persisted to the outbox,
 *                     delivered at-least-once to in-process handlers.
 *  - Integration Events: published across service boundaries (future microservices).
 *  - Internal Events:   in-process pub/sub for decoupled modules (no persistence).
 *
 * Supports: event versioning, replay, idempotency, dead-letter queue, retries,
 * ordering (per aggregate), correlation & causation IDs.
 */
export type { DomainEvent, IntegrationEvent, InternalEvent, EventEnvelope, EventMetadata } from "./types";
export { EventBus, eventBus } from "./bus";
export { EventOutbox, outbox } from "./outbox";
export { DeadLetterQueue, dlq } from "./dlq";
export { InMemoryEventStore } from "./store";
export { EventName, EVENT_VERSION } from "./naming";
