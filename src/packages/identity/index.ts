/**
 * @eks/identity — IAM domain events registry + audit action codes.
 *
 * Milestone 2 Identity & Access Management foundation. Provides:
 *  - `IDENTITY_EVENTS` — canonical map of identity domain event names
 *    to `{Aggregate}.{PastTenseVerb}` strings.
 *  - `IdentityEvent` — string-literal union derived from the registry.
 *  - `buildIdentityEvent` — factory producing envelope-compliant
 *    `DomainEvent` instances for any identity event.
 *  - `IDENTITY_AUDIT_ACTIONS` — canonical audit action codes for every
 *    security-relevant identity operation.
 *
 * Authentication engine (login flow, password hashing, JWT issuance,
 * MFA verification, session storage) is implemented in a sibling
 * package (`@eks/auth`, in flight); this package owns only the
 * event/action vocabularies and the event builder.
 */

export {
  IDENTITY_EVENTS,
  type IdentityEvent,
  type IdentityEventMeta,
  buildIdentityEvent,
} from "./events";

export {
  IDENTITY_AUDIT_ACTIONS,
  type IdentityAuditAction,
} from "./audit-actions";
