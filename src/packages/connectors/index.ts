/**
 * @eks/connectors — Production Connector Implementations & External Service Integrations.
 *
 * Built on top of the M4 Universal Connector Platform. Provider-agnostic with
 * a selection engine, normalization, failover, and caching. Every connector
 * supports retries, caching, observability, rate limiting, circuit breakers,
 * health monitoring, versioning, schema validation, secret management,
 * multi-tenancy, and audit logging.
 */

// Domain events + audit actions
export { CONNECTOR_EVENTS, type ConnectorEvent, type ConnectorEventMeta, buildConnectorEvent } from "./events";
export { CONNECTOR_AUDIT_ACTIONS, type ConnectorAuditAction } from "./audit-actions";

// Core engine
export { ProviderSelector, type ProviderCandidate, type SelectionContext, type SelectionResult } from "./selection";
export { FailoverEngine, AllProvidersFailedError, type FailoverResult } from "./failover";
export { ConnectorCache, type CacheEntry } from "./cache";
export {
  type CanonicalGeocode, type CanonicalRoute, type CanonicalWeather, type CanonicalCalendarEvent,
  type CanonicalMenuItem, type CanonicalCatalogItem,
  kmToMi, miToKm, cToF, fToC, kphToMph, timezoneToOffsetMinutes, toUTC, stripProviderMetadata, validateCanonical,
} from "./normalization";

// Connector categories
export { MapsConnector, type GeocodeInput, type RouteInput, type PlaceInput } from "./maps";
export { WeatherConnector, type WeatherQuery } from "./weather";
export { CalendarConnector, type CalendarEventInput } from "./calendar";
export { GovernmentConnector, type VerificationInput } from "./government";
export { RestaurantConnector, type MenuSyncInput } from "./restaurants";
export { ProcurementConnector, type CatalogSyncInput, type PurchaseOrderInput } from "./procurement";
export { MerchantConnector, type MerchantOrderInput } from "./merchant";
export { NotificationConnector, type NotificationInput } from "./notifications";
export { CommunicationConnector, type CommunicationInput } from "./communications";
export { IdentityConnector, type IdentityProviderConfig } from "./identity";
