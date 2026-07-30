/**
 * @file connectors/events.ts
 * @package @eks/connectors
 *
 * Production Connector domain events registry.
 *
 * Responsibility:
 *  - Define the canonical set of connector-domain events as a single
 *    constant (`CONNECTOR_EVENTS`) so producers and consumers reference
 *    the same literal strings for `eventType`. Each entry maps a
 *    PascalCase key (used in code) to the wire-format
 *    `{Aggregate}.{PastTenseVerb}` string that goes onto every
 *    DomainEvent envelope (see docs/EVENT_CONVENTIONS.md).
 *  - Expose `ConnectorEvent` — a string-literal union derived from the
 *    registry keys — so call sites are exhaustively checked by the
 *    compiler when switching over connector events.
 *  - Provide `buildConnectorEvent`, the single factory that produces
 *    envelope-compliant {@link DomainEvent} instances for any connector
 *    event, with correlation/causation/trace ids pulled from the
 *    ambient request context (set via `withRequestContext`).
 *
 * Constraints:
 *  - Pure TypeScript, no `any`, no I/O.
 *  - The returned object strictly satisfies the `DomainEvent` contract
 *    from `@eks/events` (`tier: "domain"`, `version: 1`).
 *  - Follows the EXACT same convention as `@eks/identity/events.ts`,
 *    `@eks/developer/events.ts`, and `@eks/integration/events.ts`.
 */

import type { DomainEvent } from "@eks/events";
import { EVENT_VERSION } from "@eks/events";
import { asUUID, asISODate, uuid, type UUID, type ISODateString } from "@eks/common";
import { requestContext } from "@eks/observability";

/**
 * Canonical production connector domain events.
 *
 * The single source of truth for connector event type strings. Every
 * consumer of connector events (audit log, outbox, projections,
 * provider registry, sync engine, failover controller, cache layer,
 * rate limiter, circuit breaker, marketplace registry) MUST reference
 * these constants rather than spelling out the literal string — that
 * way the compiler catches typos and renaming is a single edit.
 *
 * Naming follows the `{Aggregate}.{PastTenseVerb}` convention
 * documented in docs/EVENT_CONVENTIONS.md §3 (e.g.
 * `Provider.Registered`, `Synchronization.Completed`,
 * `Route.Calculated`, `Cache.Invalidated`).
 */
export const CONNECTOR_EVENTS = {
  // Provider lifecycle
  ProviderRegistered: "Provider.Registered",
  ProviderActivated: "Provider.Activated",
  ProviderDeactivated: "Provider.Deactivated",
  ProviderHealthChanged: "Provider.HealthChanged",
  ProviderFailoverTriggered: "Provider.FailoverTriggered",
  ProviderSelected: "Provider.Selected",

  // Synchronization lifecycle
  SynchronizationStarted: "Synchronization.Started",
  SynchronizationCompleted: "Synchronization.Completed",
  SynchronizationFailed: "Synchronization.Failed",

  // Calendar connector
  CalendarSynchronized: "Calendar.Synchronized",

  // Weather connector
  WeatherUpdated: "Weather.Updated",
  WeatherAlertReceived: "Weather.AlertReceived",

  // Maps connector
  RouteCalculated: "Route.Calculated",
  GeocodingResolved: "Geocoding.Resolved",
  PlaceLookupCompleted: "PlaceLookup.Completed",

  // Procurement connector
  ProcurementCatalogUpdated: "ProcurementCatalog.Updated",
  ProcurementOrderPlaced: "ProcurementOrder.Placed",

  // Restaurant connector
  RestaurantMenuUpdated: "RestaurantMenu.Updated",
  RestaurantReservationSynced: "RestaurantReservation.Synced",

  // Merchant connector
  MerchantContractImported: "MerchantContract.Imported",
  MerchantOrderCreated: "MerchantOrder.Created",

  // Government connector
  GovernmentVerificationCompleted: "GovernmentVerification.Completed",
  GovernmentLicenseVerified: "GovernmentLicense.Verified",

  // Notifications connector
  NotificationSent: "Notification.Sent",
  NotificationFailed: "Notification.Failed",

  // Communications connector
  CommunicationDelivered: "Communication.Delivered",
  CommunicationFailed: "Communication.Failed",

  // Identity connector
  IdentityProviderLinked: "IdentityProvider.Linked",
  IdentityProviderUnlinked: "IdentityProvider.Unlinked",

  // Cache layer
  CacheHit: "Cache.Hit",
  CacheMiss: "Cache.Miss",
  CacheInvalidated: "Cache.Invalidated",

  // Resilience
  RateLimitTriggered: "RateLimit.Triggered",
  CircuitBreakerOpened: "CircuitBreaker.Opened",
  CircuitBreakerClosed: "CircuitBreaker.Closed",

  // Registry / publishing
  ConnectorVersionPublished: "ConnectorVersion.Published",
} as const;

/**
 * Union of every canonical connector event name. Use this as the type
 * of `name` arguments to {@link buildConnectorEvent} so the compiler
 * rejects unknown events at the call site.
 */
export type ConnectorEvent = keyof typeof CONNECTOR_EVENTS;

/** Optional overrides accepted by {@link buildConnectorEvent}. */
export interface ConnectorEventMeta {
  readonly eventId?: UUID;
  readonly occurredAt?: ISODateString;
  readonly correlationId?: UUID;
  readonly causationId?: UUID | null;
  readonly traceId?: UUID;
  readonly actorUserId?: UUID | null;
  readonly organizationId?: UUID | null;
}

/**
 * Build an envelope-compliant {@link DomainEvent} for a connector
 * aggregate.
 *
 * Behaviour:
 *  - `eventType` is the canonical `{Aggregate}.{Verb}` string from
 *    {@link CONNECTOR_EVENTS}.
 *  - `aggregateType` is parsed from the canonical string (everything
 *    before the first `.`), so `Provider.Registered` → `Provider`,
 *    `Synchronization.Completed` → `Synchronization`,
 *    `Route.Calculated` → `Route`, etc.
 *  - `tier` is fixed at `"domain"` (connector events are raised
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
 *   const evt = buildConnectorEvent(
 *     "RouteCalculated",
 *     routeId,
 *     { provider: "google-maps", distanceMeters: 8420, durationSeconds: 932 },
 *   );
 *   await eventBus().publish(evt);
 */
export function buildConnectorEvent(
  name: ConnectorEvent,
  aggregateId: UUID,
  payload: Readonly<Record<string, unknown>>,
  meta?: ConnectorEventMeta,
): DomainEvent {
  const eventType = CONNECTOR_EVENTS[name];
  const aggregateType = eventType.split(".", 2)[0] ?? "Connector";
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
