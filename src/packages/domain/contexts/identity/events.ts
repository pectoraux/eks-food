/**
 * @file contexts/identity/events.ts
 * @package @eks-food/domain/contexts/identity
 *
 * Identity bounded context — domain events.
 *
 * Responsibility:
 *  - Capture the immutable facts raised by the identity context's
 *    aggregates (User, Role, Permission, Session, Credential). These
 *    events are the only public, temporal surface the context exposes
 *    to the rest of the system; downstream contexts subscribe to them
 *    to build projections, sagas and notifications.
 *
 * Constraints:
 *  - Pure TypeScript interfaces extending {@link DomainEvent}.
 *  - Field names are stable and versioned via the `eventType` literal
 *    (e.g. `"identity.user.registered.v1"`).
 */

import type { DomainEvent } from '../../shared/domain-event';
import type {
  EmailAddress,
  ISODateString,
  UUID,
} from '../../shared/value-objects';

/**
 * Raised when a new User aggregate is registered. The User is created in
 * a `PENDING_ACTIVATION` state until {@link UserActivatedEvent} fires.
 */
export interface UserRegisteredEvent extends DomainEvent {
  readonly eventType: 'identity.user.registered.v1';
  readonly email: EmailAddress;
  readonly displayName: string;
  readonly tenantId: UUID;
}

/**
 * Raised when a User transitions to the `ACTIVE` state (after email
 * verification or admin approval).
 */
export interface UserActivatedEvent extends DomainEvent {
  readonly eventType: 'identity.user.activated.v1';
  readonly activatedAt: ISODateString;
}

/**
 * Raised when a Role is granted to a User. Mirrored by
 * `identity.role.revoked.v1` (not modelled here for brevity).
 */
export interface RoleGrantedEvent extends DomainEvent {
  readonly eventType: 'identity.user.role.granted.v1';
  readonly roleId: UUID;
  readonly grantedBy: UUID;
  readonly grantedAt: ISODateString;
}

/**
 * Raised when a Session is started for a User after successful
 * authentication. Used by the audit log and the notifications context.
 */
export interface SessionStartedEvent extends DomainEvent {
  readonly eventType: 'identity.session.started.v1';
  readonly userId: UUID;
  readonly issuedAt: ISODateString;
  readonly expiresAt: ISODateString;
  readonly userAgent?: string;
  readonly ipHash?: string;
}
