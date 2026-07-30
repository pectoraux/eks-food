/**
 * @file developer/events.ts
 * @package @eks/developer
 *
 * Developer Platform domain events registry.
 *
 * Responsibility:
 *  - Define the canonical set of developer-platform domain events as a
 *    single constant (`DEVELOPER_EVENTS`) so producers and consumers
 *    reference the same literal strings for `eventType`. Each entry maps
 *    a PascalCase key (used in code) to the wire-format
 *    `{Aggregate}.{PastTenseVerb}` string that goes onto every
 *    DomainEvent envelope (see docs/EVENT_CONVENTIONS.md).
 *  - Expose `DeveloperEvent` — a string-literal union derived from the
 *    registry keys — so call sites are exhaustively checked by the
 *    compiler when switching over developer events.
 *  - Provide `buildDeveloperEvent`, the single factory that produces
 *    envelope-compliant {@link DomainEvent} instances for any
 *    developer-platform event, with correlation/causation/trace ids
 *    pulled from the ambient request context (set via
 *    `withRequestContext`).
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
 * Canonical developer-platform domain events.
 *
 * The single source of truth for developer event type strings. Every
 * consumer of developer events (audit log, outbox, projections,
 * notifications, analytics) MUST reference these constants rather than
 * spelling out the literal string — that way the compiler catches
 * typos and renaming is a single edit.
 *
 * Naming follows the `{Aggregate}.{PastTenseVerb}` convention
 * documented in docs/EVENT_CONVENTIONS.md §3 (e.g.
 * `Extension.Installed`, `Connector.Executed`, `Workflow.Started`).
 */
export const DEVELOPER_EVENTS = {
  // Extension lifecycle
  ExtensionInstalled: "Extension.Installed",
  ExtensionActivated: "Extension.Activated",
  ExtensionSuspended: "Extension.Suspended",
  ExtensionRemoved: "Extension.Removed",
  ExtensionUpgraded: "Extension.Upgraded",
  ExtensionRolledBack: "Extension.RolledBack",
  ExtensionHealthChanged: "Extension.HealthChanged",
  ExtensionLogEmitted: "Extension.LogEmitted",

  // Connector lifecycle
  ConnectorExecuted: "Connector.Executed",
  ConnectorFailed: "Connector.Failed",

  // Workflow lifecycle
  WorkflowStarted: "Workflow.Started",
  WorkflowCompleted: "Workflow.Completed",
  WorkflowFailed: "Workflow.Failed",

  // Eventing infrastructure
  EventReplayed: "Event.Replayed",

  // Manifest validation
  ManifestValidated: "Manifest.Validated",
  ManifestValidationFailed: "Manifest.ValidationFailed",

  // Package publishing
  PackagePublished: "Package.Published",
  PackageSignatureVerified: "Package.SignatureVerified",

  // Secrets
  SecretRotated: "Secret.Rotated",
} as const;

/**
 * Union of every canonical developer-platform event name. Use this as
 * the type of `name` arguments to {@link buildDeveloperEvent} so the
 * compiler rejects unknown events at the call site.
 */
export type DeveloperEvent = keyof typeof DEVELOPER_EVENTS;

/** Optional overrides accepted by {@link buildDeveloperEvent}. */
export interface DeveloperEventMeta {
  readonly eventId?: UUID;
  readonly occurredAt?: ISODateString;
  readonly correlationId?: UUID;
  readonly causationId?: UUID | null;
  readonly traceId?: UUID;
  readonly actorUserId?: UUID | null;
  readonly organizationId?: UUID | null;
}

/**
 * Build an envelope-compliant {@link DomainEvent} for a
 * developer-platform aggregate.
 *
 * Behaviour:
 *  - `eventType` is the canonical `{Aggregate}.{Verb}` string from
 *    {@link DEVELOPER_EVENTS}.
 *  - `aggregateType` is parsed from the canonical string (everything
 *    before the first `.`), so `Extension.Installed` → `Extension`,
 *    `Workflow.Started` → `Workflow`, etc.
 *  - `tier` is fixed at `"domain"` (developer events are raised
 *    inside an aggregate and persisted to the outbox).
 *  - `version` is fixed at {@link EVENT_VERSION} (= 1).
 *  - `eventId`, `occurredAt` default to a fresh uuid / now unless
 *    overridden via `meta`.
 *  - `correlationId`, `causationId`, `traceId`, `actorUserId`,
 *    `organizationId` are pulled from the ambient request context
 *    (set via `withRequestContext`) when present, falling back to
 *    fresh uuids / `null` otherwise. Explicit `meta` overrides always
 *    win.
 *
 * @example
 *   const evt = buildDeveloperEvent(
 *     "ExtensionInstalled",
 *     extensionId,
 *     { version: "1.0.0", publisherId },
 *   );
 *   await eventBus().publish(evt);
 */
export function buildDeveloperEvent(
  name: DeveloperEvent,
  aggregateId: UUID,
  payload: Readonly<Record<string, unknown>>,
  meta?: DeveloperEventMeta,
): DomainEvent {
  const eventType = DEVELOPER_EVENTS[name];
  const aggregateType = eventType.split(".", 2)[0] ?? "Developer";
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
