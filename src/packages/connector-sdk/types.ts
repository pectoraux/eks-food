import type { ExtensionContext } from "@eks/sdk";

export interface ConnectorConfig {
  readonly id: string;
  readonly organizationId: string;
  readonly connectorCode: string;
  /** Decrypted auth credentials (provider-specific). */
  readonly credentials: Record<string, unknown>;
  /** Sync state (cursor, lastSyncAt, etc.). */
  readonly syncState: Record<string, unknown>;
}

export interface ConnectorContext {
  /** The extension context (if the connector is owned by an extension). */
  readonly sdk: ExtensionContext;
  /** The connector configuration. */
  readonly config: ConnectorConfig;
  /** Logger scoped to this connector. */
  readonly log: { info(msg: string, fields?: Record<string, unknown>): void; warn(msg: string, fields?: Record<string, unknown>): void; error(msg: string, fields?: Record<string, unknown>): void };
}

export interface SyncResult {
  readonly recordsProcessed: number;
  readonly recordsCreated: number;
  readonly recordsUpdated: number;
  readonly recordsDeleted: number;
  readonly conflicts: number;
  readonly nextCursor?: string;
  readonly errors: readonly { recordId: string; error: string }[];
}

export interface PollResult {
  readonly records: readonly unknown[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

export interface WebhookResult {
  readonly processed: boolean;
  readonly records?: readonly unknown[];
  readonly error?: string;
}

export interface HealthCheckResult {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly detail?: string;
}

export interface SchemaMapping {
  readonly source: Record<string, unknown>;
  readonly target: Record<string, unknown>;
}

/** The Connector interface — implement this to build a connector. */
export interface Connector {
  readonly code: string;
  readonly name: string;
  /** Authenticate with the external system (validate credentials). */
  authenticate(ctx: ConnectorContext): Promise<{ ok: boolean; detail?: string }>;
  /** Poll for changes since the last cursor. */
  poll(ctx: ConnectorContext, cursor?: string): Promise<PollResult>;
  /** Handle an incoming webhook. */
  handleWebhook?(ctx: ConnectorContext, payload: unknown, headers: Record<string, string>): Promise<WebhookResult>;
  /** Run a full sync (poll + map + persist). */
  sync(ctx: ConnectorContext, cursor?: string): Promise<SyncResult>;
  /** Map an external record to the Eks-Food schema. */
  mapSchema(ctx: ConnectorContext, source: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Check the external system's health. */
  healthCheck(ctx: ConnectorContext): Promise<HealthCheckResult>;
}
