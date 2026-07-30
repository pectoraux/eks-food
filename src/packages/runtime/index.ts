/**
 * @eks/runtime — the extension runtime.
 *
 * Manages the extension lifecycle (install → activate → suspend → upgrade →
 * rollback → remove), dependency injection (assembles the ExtensionContext),
 * capability registration, startup validation, graceful shutdown, and health
 * reporting. Extensions execute inside a sandbox that enforces resource limits,
 * permissions, and isolation — one extension cannot crash another.
 */
export { ExtensionRuntime, type RuntimeOptions, type HealthStatus } from "./runtime";
export { Sandbox, type SandboxLimits, type SandboxViolation } from "./sandbox";
export { LifecycleManager, type LifecycleEvent } from "./lifecycle";
export { type ExtensionEntrypoint, type ExtensionModule } from "./entrypoint";
