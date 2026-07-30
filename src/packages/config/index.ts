/**
 * @eks/config — strongly-typed, validated configuration.
 *
 * Loads from process.env, validates against a Zod schema at startup, and fails
 * fast if invalid. Supports environment overrides (development/test/staging/
 * production). Secrets are never logged.
 */
export { createConfig, defineConfigSchema, type ConfigLoader, getConfig, ConfigValidationError } from "./loader";
export { AppConfig, setAppConfig, type AppConfigShape, type RuntimeConfig } from "./schema";
export { isProduction, isStaging, isTest, isDevelopment, currentEnvironment, type Environment } from "./environment";
