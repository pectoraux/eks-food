/**
 * @file shared/domain-event.ts
 * @package @eks-food/domain/shared
 *
 * Shared kernel: base `DomainEvent` contract that every event in every
 * Eks-Food bounded context must satisfy.
 *
 * Responsibility:
 *  - Establish the canonical envelope (eventId, occurredAt, correlationId,
 *    causationId, version, aggregateType, aggregateId, eventType, payload)
 *    so that the application layer, the message bus and the event store
 *    can treat all events uniformly.
 *  - Enable end-to-end tracing via `correlationId` (one per user request)
 *    and causal chaining via `causationId` (the event that triggered this
 *    one, or `null` for the originating event).
 *
 * Constraints:
 *  - Pure TypeScript, immutable, strongly typed.
 *  - `version` is fixed at the literal `1` so the bus can evolve the
 *    envelope schema in a backward-compatible way.
 */

import type { ISODateString, UUID } from './value-objects';

/**
 * Base contract for all domain events raised by any Eks-Food aggregate.
 * Concrete events extend this interface and add typed payload fields
 * (they do not need to use the loose `payload` bag, but the bag is
 * retained so the envelope can be serialised generically).
 */
export interface DomainEvent {
  /** Globally unique identifier for this event. */
  readonly eventId: UUID;

  /** When the event occurred, in ISO-8601 UTC. */
  readonly occurredAt: ISODateString;

  /** Identifier shared by every event in the same user request / saga. */
  readonly correlationId: UUID;

  /** Event that caused this one, or `null` when this is the originator. */
  readonly causationId: UUID | null;

  /** Envelope schema version. Always `1` for the current generation. */
  readonly version: 1;

  /** Aggregate type that raised the event, e.g. `"BookingAggregate"`. */
  readonly aggregateType: string;

  /** Identifier of the aggregate that raised the event. */
  readonly aggregateId: UUID;

  /** Stable, namespaced event type, e.g. `"booking.created.v1"`. */
  readonly eventType: string;

  /**
   * Generic, schema-less payload bag. Concrete event sub-types SHOULD
   * expose their payload via typed fields instead of relying on this
   * bag, but it is provided for serialisation and instrumentation.
   */
  readonly payload: Readonly<Record<string, unknown>>;
}
