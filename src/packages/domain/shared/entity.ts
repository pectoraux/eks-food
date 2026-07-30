/**
 * @file shared/entity.ts
 * @package @eks-food/domain/shared
 *
 * Shared kernel: base contracts for entities and aggregate roots.
 *
 * Responsibility:
 *  - Define the structural contract every domain entity must satisfy
 *    (identity + optimistic-concurrency version).
 *  - Distinguish aggregate roots (entities that own a consistency
 *    boundary and may emit domain events) from subordinate entities.
 *
 * Constraints:
 *  - Pure TypeScript interfaces only — no implementation, no behaviour.
 *  - Aggregate roots expose their uncommitted events so the application
 *    layer can persist + publish them in a single transaction.
 */

import type { DomainEvent } from './domain-event';
import type { UUID, Version } from './value-objects';

/**
 * Base contract for a domain entity. Entities have identity (`id`) that
 * persists across state changes, plus a `version` used for optimistic
 * concurrency control when persisted.
 */
export interface Entity<TId> {
  readonly id: TId;
  readonly version: Version;
}

/**
 * Base contract for an aggregate root. Aggregate roots additionally
 * declare their `aggregateType` (used to namespace events and repository
 * routing) and expose their uncommitted domain events.
 *
 * Concrete aggregate interfaces in each bounded context extend this
 * interface and add behaviour contracts (method signatures returning
 * `Result<T, DomainError>`).
 */
export interface AggregateRoot<TId> extends Entity<TId> {
  /** Stable aggregate type name, e.g. `"BookingAggregate"`. */
  readonly aggregateType: string;

  /**
   * Domain events raised by the aggregate since it was loaded from the
   * repository. The application layer is responsible for clearing this
   * list after the events have been persisted + published.
   */
  readonly uncommittedEvents: ReadonlyArray<DomainEvent>;
}
