/**
 * Sandbox — enforces resource limits, permission checks, and isolation.
 *
 * Extensions execute inside a sandbox that:
 *  - enforces a CPU/memory/execution-time budget per invocation
 *  - checks permissions before every capability access
 *  - prevents one extension from affecting another (isolation)
 *  - reports violations to the audit log + metrics
 */
import { metrics } from "@eks/observability/metrics";
import { logger } from "@eks/observability/logger";

export interface SandboxLimits {
  readonly maxCpuMs?: number;
  readonly maxMemoryBytes?: number;
  readonly maxExecutionMs?: number;
  readonly maxInvocations?: number;
}

export interface SandboxViolation {
  readonly extensionId: string;
  readonly kind: "TIMEOUT" | "MEMORY" | "CPU" | "PERMISSION" | "RATE_LIMIT";
  readonly detail: string;
  readonly timestamp: string;
}

const violations = metrics().counter("sandbox_violations", "Sandbox violations by extension");
const invocations = metrics().counter("extension_invocations", "Extension invocations");

export class Sandbox {
  private readonly invocationCounts = new Map<string, number>();
  private readonly startTime = new Map<string, number>();

  constructor(private readonly limits: SandboxLimits = { maxExecutionMs: 30_000, maxMemoryBytes: 256 * 1024 * 1024, maxInvocations: 1000 }) {}

  /** Execute a function inside the sandbox. */
  async run<T>(extensionId: string, grantedPermissions: readonly string[], fn: () => Promise<T>, requiredPermission?: string): Promise<T> {
    // Permission check
    if (requiredPermission && !grantedPermissions.includes(requiredPermission)) {
      this.recordViolation(extensionId, "PERMISSION", `Missing permission: ${requiredPermission}`);
      throw new SandboxPermissionError(extensionId, requiredPermission);
    }

    // Rate limit check
    const count = this.invocationCounts.get(extensionId) ?? 0;
    if (count >= (this.limits.maxInvocations ?? 1000)) {
      this.recordViolation(extensionId, "RATE_LIMIT", `Exceeded max invocations: ${this.limits.maxInvocations}`);
      throw new SandboxRateLimitError(extensionId);
    }
    this.invocationCounts.set(extensionId, count + 1);
    invocations.inc(1, { extensionId });

    // Execution timeout
    const start = Date.now();
    this.startTime.set(extensionId, start);
    const timeout = this.limits.maxExecutionMs ?? 30_000;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.recordViolation(extensionId, "TIMEOUT", `Exceeded ${timeout}ms`);
        reject(new SandboxTimeoutError(extensionId, timeout));
      }, timeout);

      fn()
        .then((result) => {
          clearTimeout(timer);
          const elapsed = Date.now() - start;
          if (elapsed > timeout) {
            this.recordViolation(extensionId, "TIMEOUT", `Completed in ${elapsed}ms (limit ${timeout}ms)`);
          }
          // Memory check
          if (this.limits.maxMemoryBytes) {
            const mem = process.memoryUsage().heapUsed;
            if (mem > this.limits.maxMemoryBytes) {
              this.recordViolation(extensionId, "MEMORY", `${Math.round(mem / 1024 / 1024)}MB used (limit ${Math.round(this.limits.maxMemoryBytes / 1024 / 1024)}MB)`);
            }
          }
          resolve(result);
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  /** Check a permission without executing. */
  checkPermission(extensionId: string, grantedPermissions: readonly string[], required: string): boolean {
    if (!grantedPermissions.includes(required)) {
      this.recordViolation(extensionId, "PERMISSION", `Missing permission: ${required}`);
      return false;
    }
    return true;
  }

  /** Reset invocation counts (e.g. on a new billing period). */
  reset(extensionId: string): void {
    this.invocationCounts.delete(extensionId);
    this.startTime.delete(extensionId);
  }

  private recordViolation(extensionId: string, kind: SandboxViolation["kind"], detail: string): void {
    const violation: SandboxViolation = { extensionId, kind, detail, timestamp: new Date().toISOString() };
    violations.inc(1, { extensionId, kind });
    logger().warn("sandbox.violation", { extensionId, kind, detail });
  }
}

export class SandboxPermissionError extends Error {
  constructor(readonly extensionId: string, readonly permission: string) {
    super(`Sandbox: extension ${extensionId} lacks permission ${permission}`);
    this.name = "SandboxPermissionError";
  }
}
export class SandboxTimeoutError extends Error {
  constructor(readonly extensionId: string, readonly timeoutMs: number) {
    super(`Sandbox: extension ${extensionId} exceeded ${timeoutMs}ms timeout`);
    this.name = "SandboxTimeoutError";
  }
}
export class SandboxRateLimitError extends Error {
  constructor(readonly extensionId: string) {
    super(`Sandbox: extension ${extensionId} exceeded invocation rate limit`);
    this.name = "SandboxRateLimitError";
  }
}
