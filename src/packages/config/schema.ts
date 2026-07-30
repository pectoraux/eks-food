import type { Environment } from "./environment";

/**
 * The single source of truth for Eks-Food application configuration.
 * Every field is validated by a Zod schema at startup.
 */
export interface AppConfigShape {
  readonly env: Environment;
  readonly app: {
    readonly name: string;
    readonly version: string;
    readonly port: number;
    readonly logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
    readonly logFormat: "json" | "pretty";
  };
  readonly database: {
    readonly url: string;
    readonly poolSize: number;
    readonly statementTimeoutMs: number;
  };
  readonly redis: {
    readonly url: string | null;
    readonly keyPrefix: string;
    readonly defaultTtlMs: number;
  };
  readonly security: {
    readonly secretKey: string;
    readonly allowedOrigins: readonly string[];
    readonly rateLimitPerMinute: number;
  };
  readonly observability: {
    readonly enableMetrics: boolean;
    readonly enableTracing: boolean;
    readonly sampleRate: number;
  };
  readonly payments: {
    readonly provider: "payswap" | "stripe" | "mock";
    readonly apiBaseUrl: string;
    readonly apiKey: string | null;
    readonly webhookSecret: string | null;
  };
  readonly ai: {
    readonly enabled: boolean;
    readonly model: string;
  };
}

/** Runtime config singleton, populated after validation. */
export let AppConfig: AppConfigShape;

export function setAppConfig(cfg: AppConfigShape): void {
  AppConfig = cfg;
}

export type RuntimeConfig = AppConfigShape;
