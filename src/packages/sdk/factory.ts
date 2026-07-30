/** Factory that assembles an ExtensionContext for a running extension. */
import type { ExtensionContext, ExtensionManifest } from "./context";
import { ExtensionStorage } from "./storage";
import { ExtensionLogger } from "./logger";
import { InProcessApiClient } from "./api-client";
import { cache as getCache } from "@eks/cache";
import { eventBus } from "@eks/events";
import { metrics as getMetrics } from "@eks/observability/metrics";
import { startSpan } from "@eks/observability/tracing";
import { withRetry } from "@eks/common";
import { db } from "@/lib/db";
import { decrypt } from "@eks/security";

export interface SdkOptions {
  readonly extensionId: string;
  readonly installationId: string;
  readonly organizationId: string;
  readonly manifest: ExtensionManifest;
  readonly grantedPermissions: readonly string[];
  readonly config: Record<string, unknown>;
  readonly userId: string | null;
  readonly roles: readonly string[];
  readonly secretKey: string;
}

export function createSdk(opts: SdkOptions): ExtensionContext {
  const storage = new ExtensionStorage(opts.extensionId, opts.organizationId);
  const logger = new ExtensionLogger(opts.extensionId, opts.organizationId);
  const apis = new InProcessApiClient(opts.organizationId, opts.userId, opts.grantedPermissions);
  const m = getMetrics();

  return {
    extensionId: opts.extensionId,
    installationId: opts.installationId,
    organizationId: opts.organizationId,
    manifest: opts.manifest,
    grantedPermissions: opts.grantedPermissions,

    apis,
    events: eventBus(),
    storage,
    cache: getCache(),
    config: opts.config,
    logger,
    metrics: {
      counter: (name, help) => m.counter(`ext_${opts.extensionId}_${name}`, help),
      gauge: (name, help) => m.gauge(`ext_${opts.extensionId}_${name}`, help),
      histogram: (name, help) => m.histogram(`ext_${opts.extensionId}_${name}`, help),
    },
    tracer: {
      startSpan(name) {
        const span = startSpan({ name: `ext:${opts.extensionId}:${name}` });
        return {
          end: () => span.end(),
          setAttribute: (k, v) => span.setAttribute(k, v),
          recordError: (e) => span.recordError(e),
        };
      },
    },
    auth: {
      userId: opts.userId,
      roles: opts.roles,
      hasPermission: (perm) => opts.grantedPermissions.includes(perm),
    },
    secrets: {
      async get(key) {
        const secret = await db.secret.findFirst({
          where: { extensionId: opts.extensionId, organizationId: opts.organizationId, key, active: true },
        });
        if (!secret) return null;
        return decrypt(JSON.parse(secret.encryptedValue), opts.secretKey);
      },
      async list() {
        const secrets = await db.secret.findMany({
          where: { extensionId: opts.extensionId, organizationId: opts.organizationId, active: true },
          select: { key: true },
        });
        return secrets.map((s) => s.key);
      },
    },
    retry: async (fn, retryOpts) => {
      const { result } = await withRetry(fn, { maxAttempts: retryOpts?.maxAttempts ?? 3, baseDelayMs: retryOpts?.baseDelayMs ?? 100 });
      if (!result.ok) throw result.error;
      return result.value;
    },
  };
}
