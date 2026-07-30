/**
 * @eks/sdk — the platform SDK given to every extension.
 *
 * The `ExtensionContext` is the ONLY sanctioned surface for extensions to
 * access platform capabilities. Developers never touch infrastructure directly
 * (no Prisma, no Redis, no raw HTTP). The SDK provides: APIs, events, storage,
 * caching, configuration, logging, metrics, tracing, auth, secrets, and retries.
 */
export type { ExtensionContext, ExtensionManifest, ExtensionPermission, ExtensionCapability } from "./context";
export { ExtensionStorage } from "./storage";
export { createSdk, type SdkOptions } from "./factory";
export { ExtensionLogger, type LogLevel } from "./logger";
export { type ApiClient, type ApiRequestOptions, type ApiResponse } from "./api-client";
