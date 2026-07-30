/**
 * @file integration/events.ts
 * @package @eks/integration
 *
 * Universal Connector Platform & Enterprise Integration domain events
 * registry.
 *
 * Responsibility:
 *  - Define the canonical set of integration-platform domain events as
 *    a single constant (`INTEGRATION_EVENTS`) so producers and
 *    consumers reference the same literal strings for `eventType`.
 *    Each entry maps a PascalCase key (used in code) to the
 *    wire-format `{Aggregate}.{PastTenseVerb}` string that goes onto
 *    every DomainEvent envelope (see docs/EVENT_CONVENTIONS.md).
 *  - Expose `IntegrationEvent` — a string-literal union derived from
 *    the registry keys — so call sites are exhaustively checked by the
 *    compiler when switching over integration events.
 *  - Provide `buildIntegrationEvent`, the single factory that produces
 *    envelope-compliant {@link DomainEvent} instances for any
 *    integration event, with correlation/causation/trace ids pulled
 *    from the ambient request context (set via
 *    `withRequestContext`).
 *
 * Constraints:
 *  - Pure TypeScript, no `any`, no I/O.
 *  - The returned object strictly satisfies the `DomainEvent` contract
 *    from `@eks/events` (`tier: "domain"`, `version: 1`).
 *  - Follows the EXACT same convention as `@eks/identity/events.ts`
 *    and `@eks/developer/events.ts`.
 */

import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, asISODate, uuid, type UUID, type ISODateString } from "@eks/common";
import { requestContext } from "@eks/observability";

/**
 * Canonical integration-platform domain events.
 *
 * The single source of truth for integration event type strings. Every
 * consumer of integration events (audit log, outbox, projections,
 * connector registry, sync engine, webhook delivery, scheduling,
 * health checks) MUST reference these constants rather than spelling
 * out the literal string — that way the compiler catches typos and
 * renaming is a single edit.
 *
 * Naming follows the `{Aggregate}.{PastTenseVerb}` convention
 * documented in docs/EVENT_CONVENTIONS.md §3 (e.g.
 * `Connector.Installed`, `Synchronization.Completed`,
 * `Webhook.Delivered`).
 */
export const INTEGRATION_EVENTS = {
  // Connector lifecycle
  ConnectorInstalled: "Connector.Installed",
  ConnectorActivated: "Connector.Activated",
  ConnectorDeactivated: "Connector.Deactivated",
  ConnectorRemoved: "Connector.Removed",
  ConnectorUpgraded: "Connector.Upgraded",

  // Connector execution
  ConnectorExecutionStarted: "ConnectorExecution.Started",
  ConnectorExecutionCompleted: "ConnectorExecution.Completed",
  ConnectorExecutionFailed: "ConnectorExecution.Failed",

  // Synchronization lifecycle
  SynchronizationStarted: "Synchronization.Started",
  SynchronizationCompleted: "Synchronization.Completed",
  SynchronizationFailed: "Synchronization.Failed",
  SynchronizationResumed: "Synchronization.Resumed",

  // Webhook delivery
  WebhookReceived: "Webhook.Received",
  WebhookDelivered: "Webhook.Delivered",
  WebhookDeliveryFailed: "Webhook.DeliveryFailed",

  // Polling
  PollingExecuted: "Polling.Executed",
  PollingFailed: "Polling.Failed",

  // Schema registry & mapping
  SchemaUpdated: "Schema.Updated",
  SchemaValidated: "Schema.Validated",
  MappingValidated: "Mapping.Validated",
  TransformationApplied: "Transformation.Applied",

  // Retry & rate limiting
  RetryTriggered: "Retry.Triggered",
  RetryExhausted: "Retry.Exhausted",
  RateLimited: "Rate.Limited",

  // Health
  HealthCheckPassed: "HealthCheck.Passed",
  HealthCheckFailed: "HealthCheck.Failed",

  // Credentials
  CredentialRotated: "Credential.Rotated",

  // Scheduling
  ScheduleTriggered: "Schedule.Triggered",
} as const;

/**
 * Union of every canonical integration-platform event name. Use this
 * as the type of `name` arguments to {@link buildIntegrationEvent} so
 * the compiler rejects unknown events at the call site.
 */
export type IntegrationEvent = keyof typeof INTEGRATION_EVENTS;

/** Optional overrides accepted by {@link buildIntegrationEvent}. */
export interface IntegrationEventMeta {
  readonly eventId?: UUID;
  readonly occurredAt?: ISODateString;
  readonly correlationId?: UUID;
  readonly causationId?: UUID | null;
  readonly traceId?: UUID;
  readonly actorUserId?: UUID | null;
  readonly organizationId?: UUID | null;
}

/**
 * Build an envelope-compliant {@link DomainEvent} for an
 * integration-platform aggregate.
 *
 * Behaviour:
 *  - `eventType` is the canonical `{Aggregate}.{Verb}` string from
 *    {@link INTEGRATION_EVENTS}.
 *  - `aggregateType` is parsed from the canonical string (everything
 *    before the first `.`), so `Connector.Installed` → `Connector`,
 *    `Synchronization.Completed` → `Synchronization`, etc.
 *  - `tier` is fixed at `"domain"` (integration events are raised
 *    inside an aggregate and persisted to the outbox).
 *  - `version` is fixed at {@link EVENT_VERSION} (= 1).
 *  - `eventId`, `occurredAt` default to a fresh uuid / now unless
 *    overridden via `meta`.
 *  - `correlationId`, `causationId`, `traceId`, `actorUserId`,
 *    `organizationId` are pulled from the ambient request context
 *    (set via `withRequestContext`) when present, falling back to
 *    fresh uuids / `null` otherwise. Explicit `meta` overrides
 *    always win.
 *
 * @example
 *   const evt = buildIntegrationEvent(
 *     "ConnectorExecutionCompleted",
 *     connectorId,
 *     { connectorName: "stripe", operation: "sync", durationMs: 142 },
 *   );
 *   await eventBus().publish(evt);
 */
export function buildIntegrationEvent(
  name: IntegrationEvent,
  aggregateId: UUID,
  payload: Readonly<Record<string, unknown>>,
  meta?: IntegrationEventMeta,
): DomainEvent {
  const eventType = INTEGRATION_EVENTS[name];
  const aggregateType = eventType.split(".", 2)[0] ?? "Integration";
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
