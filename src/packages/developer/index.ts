/**
 * @eks/developer — Developer Platform domain events registry + audit
 * action codes.
 *
 * Milestone 3 Developer Platform foundation. Provides:
 *  - `DEVELOPER_EVENTS` — canonical map of developer-platform domain
 *    event names to `{Aggregate}.{PastTenseVerb}` strings.
 *  - `DeveloperEvent` — string-literal union derived from the registry.
 *  - `buildDeveloperEvent` — factory producing envelope-compliant
 *    `DomainEvent` instances for any developer event.
 *  - `DEVELOPER_AUDIT_ACTIONS` — canonical audit action codes for
 *    every security-relevant developer operation.
 *
 * Sibling packages (in flight) own the runtime: `@eks/sdk` (extension
 * context), `@eks/connector-sdk` (connectors), `@eks/runtime`
 * (extension lifecycle + sandboxing), `@eks/workflow` (workflow
 * engine), `@eks/registry` (manifest validation + packaging). This
 * package owns only the event/action vocabularies and the event
 * builder — pure, dependency-light, side-effect-free.
 */

export {
  DEVELOPER_EVENTS,
  type DeveloperEvent,
  type DeveloperEventMeta,
  buildDeveloperEvent,
} from "./events";

export {
  DEVELOPER_AUDIT_ACTIONS,
  type DeveloperAuditAction,
} from "./audit-actions";
