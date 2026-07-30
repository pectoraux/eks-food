import { z } from "zod";
import { currentEnvironment, type Environment } from "./environment";
import { AppConfig, setAppConfig, type AppConfigShape } from "./schema";

const ConfigSchema = z.object({
  env: z.enum(["development", "test", "staging", "production"]),
  app: z.object({
    name: z.string().default("eks-food"),
    version: z.string().default("0.1.0"),
    port: z.coerce.number().int().positive().default(3000),
    logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
    logFormat: z.enum(["json", "pretty"]).default("json"),
  }),
  database: z.object({
    url: z.string().min(1, "DATABASE_URL is required"),
    poolSize: z.coerce.number().int().positive().default(10),
    statementTimeoutMs: z.coerce.number().int().positive().default(30000),
  }),
  redis: z.object({
    url: z.string().nullable().default(null),
    keyPrefix: z.string().default("eks:"),
    defaultTtlMs: z.coerce.number().int().positive().default(60000),
  }),
  security: z.object({
    secretKey: z.string().min(16, "EKS_SECRET_KEY must be at least 16 chars in non-dev"),
    allowedOrigins: z
      .union([z.string(), z.array(z.string())])
      .transform((s) => (Array.isArray(s) ? s : s.split(",").map((x) => x.trim()).filter(Boolean))),
    rateLimitPerMinute: z.coerce.number().int().positive().default(120),
  }),
  observability: z.object({
    enableMetrics: z.coerce.boolean().default(true),
    enableTracing: z.coerce.boolean().default(true),
    sampleRate: z.coerce.number().min(0).max(1).default(1),
  }),
  payments: z.object({
    provider: z.enum(["payswap", "stripe", "mock"]).default("mock"),
    apiBaseUrl: z.string().url().default("https://api.payswap.com"),
    apiKey: z.string().nullable().default(null),
    webhookSecret: z.string().nullable().default(null),
  }),
  ai: z.object({
    enabled: z.coerce.boolean().default(true),
    model: z.string().default("glm-4.6"),
  }),
});

export interface ConfigLoader {
  load(env?: NodeJS.ProcessEnv): AppConfigShape;
}

export function defineConfigSchema() {
  return ConfigSchema;
}

/**
 * Load & validate configuration. Fails fast (throws) on invalid config in
 * production; in development provides safe defaults for missing secrets.
 */
export function createConfig(): ConfigLoader {
  return {
    load(env = process.env): AppConfigShape {
      const environment: Environment = currentEnvironment();
      const devSecret = "eks-dev-secret-key-do-not-use-in-prod";

      const raw = {
        env: environment,
        app: {
          name: env.EKS_APP_NAME ?? "eks-food",
          version: env.EKS_APP_VERSION ?? "0.1.0",
          port: env.EKS_PORT ?? env.PORT ?? "3000",
          logLevel: env.EKS_LOG_LEVEL ?? (environment === "production" ? "info" : "debug"),
          logFormat: env.EKS_LOG_FORMAT ?? (environment === "production" ? "json" : "pretty"),
        },
        database: {
          url: env.DATABASE_URL ?? "file:./db/custom.db",
          poolSize: env.EKS_DB_POOL_SIZE ?? "10",
          statementTimeoutMs: env.EKS_DB_STATEMENT_TIMEOUT_MS ?? "30000",
        },
        redis: {
          url: env.REDIS_URL ?? env.EKS_REDIS_URL ?? null,
          keyPrefix: env.EKS_REDIS_PREFIX ?? "eks:",
          defaultTtlMs: env.EKS_REDIS_TTL_MS ?? "60000",
        },
        security: {
          secretKey: env.EKS_SECRET_KEY ?? (environment === "production" ? undefined : devSecret),
          allowedOrigins: env.EKS_ALLOWED_ORIGINS ?? "*",
          rateLimitPerMinute: env.EKS_RATE_LIMIT_PER_MINUTE ?? "120",
        },
        observability: {
          enableMetrics: env.EKS_METRICS_ENABLED ?? "true",
          enableTracing: env.EKS_TRACING_ENABLED ?? "true",
          sampleRate: env.EKS_TRACE_SAMPLE_RATE ?? (environment === "production" ? "0.1" : "1"),
        },
        payments: {
          provider: env.EKS_PAYMENT_PROVIDER ?? "mock",
          apiBaseUrl: env.EKS_PAYSWAP_API_BASE_URL ?? "https://api.payswap.com",
          apiKey: env.EKS_PAYSWAP_API_KEY ?? null,
          webhookSecret: env.EKS_PAYSWAP_WEBHOOK_SECRET ?? null,
        },
        ai: {
          enabled: env.EKS_AI_ENABLED ?? "true",
          model: env.EKS_AI_MODEL ?? "glm-4.6",
        },
      };

      const parsed = ConfigSchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
          .join("\n");
        throw new ConfigValidationError(
          `Invalid Eks-Food configuration:\n${issues}\n\nSet the required environment variables and restart.`
        );
      }
      setAppConfig(parsed.data);
      return parsed.data;
    },
  };
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/** Convenience: get the loaded config (must call createConfig().load() first). */
export function getConfig(): AppConfigShape {
  if (!AppConfig) {
    throw new Error("Config not loaded. Call createConfig().load() at startup.");
  }
  return AppConfig;
}
