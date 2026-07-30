/**
 * The ExtensionContext — the single object handed to an extension at activation.
 * Every capability is accessed through this context; extensions never touch
 * infrastructure directly.
 */
import type { ExtensionStorage } from "./storage";
import type { ExtensionLogger } from "./logger";
import type { ApiClient } from "./api-client";
import type { Cache } from "@eks/cache";
import type { EventBus } from "@eks/events";

export interface ExtensionPermission {
  readonly code: string; // e.g. "read.customers", "write.schedules"
  readonly description: string;
}

export interface ExtensionCapability {
  readonly name: string; // e.g. "api.handler", "event.subscriber", "background.worker"
  readonly config?: Record<string, unknown>;
}

export interface ExtensionManifest {
  readonly metadata: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly publisher: string;
  };
  readonly capabilities: readonly ExtensionCapability[];
  readonly permissions: readonly ExtensionPermission[];
  readonly requiredAPIs: readonly string[];
  readonly requiredEvents: readonly string[];
  readonly configurationSchema: Record<string, unknown>;
  readonly connectorDependencies: readonly string[];
  readonly localization: { readonly defaultLanguage: string; readonly supportedLanguages: readonly string[] };
  readonly licensing: { readonly type: string; readonly licenseUrl?: string };
  readonly compatibility: { readonly platformRange: string };
}

export interface ExtensionContext {
  /** The extension's unique identifier. */
  readonly extensionId: string;
  /** The installation ID (scoped to a tenant). */
  readonly installationId: string;
  /** The tenant this extension is running for. */
  readonly organizationId: string;
  /** The manifest (validated at install time). */
  readonly manifest: ExtensionManifest;
  /** The granted permissions (subset of requested, reviewed at install). */
  readonly grantedPermissions: readonly string[];

  // --- Platform capabilities ---

  /** Call platform APIs (e.g. `bookings.list`, `cooks.find`). */
  readonly apis: ApiClient;
  /** Subscribe to domain/integration events. */
  readonly events: EventBus;
  /** Namespaced key/value + document storage (per extension + tenant). */
  readonly storage: ExtensionStorage;
  /** Namespaced cache (per extension + tenant). */
  readonly cache: Cache;
  /** The extension's configuration (validated against the manifest schema). */
  readonly config: Record<string, unknown>;
  /** Structured logger (auto-tagged with extensionId + orgId). */
  readonly logger: ExtensionLogger;
  /** Metrics (auto-tagged with extensionId). */
  readonly metrics: {
    counter(name: string, help: string): { inc(delta?: number, tags?: Record<string, string>): void };
    gauge(name: string, help: string): { set(value: number, tags?: Record<string, string>): void };
    histogram(name: string, help: string): { observe(value: number, tags?: Record<string, string>): void };
  };
  /** Tracing (auto-tagged with extensionId). */
  readonly tracer: {
    startSpan(name: string): { end(): void; setAttribute(key: string, value: unknown): void; recordError(e: unknown): void };
  };
  /** The authenticated principal (if the request is user-scoped). */
  readonly auth: { readonly userId: string | null; readonly roles: readonly string[]; hasPermission(perm: string): boolean };
  /** Secret access (decrypted on-demand; never exposed raw to the extension code). */
  readonly secrets: { get(key: string): Promise<string | null>; list(): Promise<readonly string[]> };
  /** Retry helper (exponential backoff + circuit breaker). */
  readonly retry: <T>(fn: () => Promise<T>, opts?: { maxAttempts?: number; baseDelayMs?: number }) => Promise<T>;
}
