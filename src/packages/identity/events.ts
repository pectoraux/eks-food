/**
 * @file identity/events.ts
 * @package @eks/identity
 *
 * Identity domain events registry.
 *
 * Responsibility:
 *  - Define the canonical set of identity-domain events as a single
 *    constant (`IDENTITY_EVENTS`) so producers and consumers reference
 *    the same literal strings for `eventType`. Each entry maps a
 *    PascalCase key (used in code) to the wire-format
 *    `{Aggregate}.{PastTenseVerb}` string that goes onto every
 *    DomainEvent envelope (see docs/EVENT_CONVENTIONS.md).
 *  - Expose `IdentityEvent` — a string-literal union derived from the
 *    registry keys — so call sites are exhaustively checked by the
 *    compiler when switching over identity events.
 *  - Provide `buildIdentityEvent`, the single factory that produces
 *    envelope-compliant {@link DomainEvent} instances for any identity
 *    event, with correlation/causation/trace ids pulled from the
 *    ambient request context (set via `withRequestContext`).
 *
 * Constraints:
 *  - Pure TypeScript, no `any`, no I/O.
 *  - The returned object strictly satisfies the `DomainEvent` contract
 *    from `@eks/events` (`tier: "domain"`, `version: 1`).
 */

import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, asISODate, uuid, type UUID, type ISODateString } from "@eks/common";
import { requestContext } from "@eks/observability";

/**
 * Canonical identity domain events.
 *
 * The single source of truth for identity event type strings. Every
 * consumer of identity events (audit log, outbox, projections,
 * notifications, analytics) MUST reference these constants rather than
 * spelling out the literal string — that way the compiler catches
 * typos and renaming is a single edit.
 *
 * Naming follows the `{Aggregate}.{PastTenseVerb}` convention
 * documented in docs/EVENT_CONVENTIONS.md §3 (e.g. `User.Registered`,
 * `Session.Revoked`).
 */
export const IDENTITY_EVENTS = {
  UserRegistered: "User.Registered",
  UserVerified: "User.Verified",
  UserLoggedIn: "User.LoggedIn",
  UserLoggedOut: "User.LoggedOut",
  SessionCreated: "Session.Created",
  SessionRevoked: "Session.Revoked",
  SessionRefreshed: "Session.Refreshed",
  OrganizationCreated: "Organization.Created",
  OrganizationUpdated: "Organization.Updated",
  OrganizationSuspended: "Organization.Suspended",
  MembershipAdded: "Membership.Added",
  MembershipRemoved: "Membership.Removed",
  RoleAssigned: "Role.Assigned",
  RoleRevoked: "Role.Revoked",
  PermissionGranted: "Permission.Granted",
  PermissionDenied: "Permission.Denied",
  InvitationCreated: "Invitation.Created",
  InvitationAccepted: "Invitation.Accepted",
  InvitationRevoked: "Invitation.Revoked",
  MFAEnabled: "MFA.Enabled",
  MFADisabled: "MFA.Disabled",
  RecoveryCodesGenerated: "RecoveryCodes.Generated",
  PasswordChanged: "Password.Changed",
  PasswordResetRequested: "Password.ResetRequested",
  AccountLocked: "Account.Locked",
  AccountSuspended: "Account.Suspended",
  AccountDeleted: "Account.Deleted",
  TeamCreated: "Team.Created",
  TeamMemberAdded: "TeamMember.Added",
  TeamMemberRemoved: "TeamMember.Removed",
  VerificationRequested: "Verification.Requested",
  VerificationCompleted: "Verification.Completed",
} as const;

/**
 * Union of every canonical identity event name. Use this as the type
 * of `name` arguments to {@link buildIdentityEvent} so the compiler
 * rejects unknown events at the call site.
 */
export type IdentityEvent = keyof typeof IDENTITY_EVENTS;

/** Optional overrides accepted by {@link buildIdentityEvent}. */
export interface IdentityEventMeta {
  readonly eventId?: UUID;
  readonly occurredAt?: ISODateString;
  readonly correlationId?: UUID;
  readonly causationId?: UUID | null;
  readonly traceId?: UUID;
  readonly actorUserId?: UUID | null;
  readonly organizationId?: UUID | null;
}

/**
 * Build an envelope-compliant {@link DomainEvent} for an identity
 * aggregate.
 *
 * Behaviour:
 *  - `eventType` is the canonical `{Aggregate}.{Verb}` string from
 *    {@link IDENTITY_EVENTS}.
 *  - `aggregateType` is parsed from the canonical string (everything
 *    before the first `.`), so `User.Registered` → `User`,
 *    `Password.Changed` → `Password`, etc.
 *  - `tier` is fixed at `"domain"` (identity events are raised inside
 *    an aggregate and persisted to the outbox).
 *  - `version` is fixed at {@link EVENT_VERSION} (= 1).
 *  - `eventId`, `occurredAt` default to a fresh uuid / now unless
 *    overridden via `meta`.
 *  - `correlationId`, `causationId`, `traceId`, `actorUserId`,
 *    `organizationId` are pulled from the ambient request context (set
 *    via `withRequestContext`) when present, falling back to fresh
 *    uuids / `null` otherwise. Explicit `meta` overrides always win.
 *
 * @example
 *   const evt = buildIdentityEvent(
 *     "UserRegistered",
 *     userId,
 *     { email, displayName, tenantId },
 *   );
 *   await eventBus().publish(evt);
 */
export function buildIdentityEvent(
  name: IdentityEvent,
  aggregateId: UUID,
  payload: Readonly<Record<string, unknown>>,
  meta?: IdentityEventMeta,
): DomainEvent {
  const eventType = IDENTITY_EVENTS[name];
  const aggregateType = eventType.split(".", 2)[0] ?? "Identity";
  const ctx = requestContext();

  const correlationId: UUID =
    meta?.correlationId ?? (ctx ? asUUID(ctx.correlationId) : uuid());
  const causationId: UUID | null =
    meta?.causationId ?? (ctx?.causationId ? asUUID(ctx.causationId) : null);
  const traceId: UUID | undefined =
    meta?.traceId ?? (ctx ? asUUID(ctx.traceId) : undefined);
  const actorUserId: UUID | null =
    meta?.actorUserId ?? (ctx?.actorUserId ? asUUID(ctx.actorUserId) : null);
  const organizationId: UUID | null =
    meta?.organizationId ?? (ctx?.organizationId ? asUUID(ctx.organizationId) : null);

  return {
    tier: "domain",
    eventId: meta?.eventId ?? uuid(),
    occurredAt: meta?.occurredAt ?? asISODate(new Date()),
    correlationId,
    causationId,
    version: EVENT_VERSION,
    traceId,
    actorUserId,
    organizationId,
    aggregateType,
    aggregateId,
    eventType,
    payload,
  };
}
