/**
 * ExtensionRuntime — the top-level orchestrator.
 *
 * Manages active extensions: loads their entrypoints, assembles the
 * ExtensionContext, runs them inside the sandbox, and reports health.
 */
import { db } from "@/lib/db";
import { createSdk } from "@eks/sdk";
import type { ExtensionContext, ExtensionManifest } from "@eks/sdk";
import { Sandbox, type SandboxLimits } from "./sandbox";
import type { ExtensionModule } from "./entrypoint";
import { logger } from "@eks/observability/logger";
import { metrics } from "@eks/observability/metrics";

export interface RuntimeOptions {
  readonly sandboxLimits?: SandboxLimits;
  readonly secretKey: string;
}

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "OFFLINE";

interface ActiveExtension {
  readonly installationId: string;
  readonly extensionId: string;
  readonly organizationId: string;
  readonly module: ExtensionModule;
  readonly context: ExtensionContext;
  readonly activatedAt: Date;
  health: HealthStatus;
}

const activeCount = metrics().gauge("extensions_active", "Active extensions");
const healthGauge = metrics().gauge("extensions_by_health", "Extensions by health status");

export class ExtensionRuntime {
  private readonly active = new Map<string, ActiveExtension>();
  private readonly sandbox: Sandbox;

  constructor(private readonly options: RuntimeOptions) {
    this.sandbox = new Sandbox(options.sandboxLimits);
  }

  /** Activate an installed extension — load its module, assemble context, call activate(). */
  async activate(installationId: string): Promise<void> {
    const installation = await db.extensionInstallation.findUnique({
      where: { id: installationId },
      include: { extension: { include: { publisher: true } }, version: true },
    });
    if (!installation) throw new Error(`Installation not found: ${installationId}`);
    if (installation.status !== "ACTIVE") throw new Error(`Installation is not ACTIVE: ${installation.status}`);

    // Load the extension module (in production, from the package artifact).
    const mod = await this.loadModule(installation.extension.identifier, installation.version.version);

    // Parse the manifest from the version.
    const manifest = JSON.parse(installation.version.manifest) as ExtensionManifest;

    // Assemble the ExtensionContext.
    const context = createSdk({
      extensionId: installation.extensionId,
      installationId: installation.id,
      organizationId: installation.organizationId,
      manifest,
      grantedPermissions: JSON.parse(installation.grantedPermissions) as string[],
      config: JSON.parse(installation.configuration) as Record<string, unknown>,
      userId: null,
      roles: [],
      secretKey: this.options.secretKey,
    });

    // Run the extension's activate() inside the sandbox.
    await this.sandbox.run(installation.extensionId, context.grantedPermissions, async () => {
      await mod.activate(context);
    });

    this.active.set(installationId, {
      installationId,
      extensionId: installation.extensionId,
      organizationId: installation.organizationId,
      module: mod,
      context,
      activatedAt: new Date(),
      health: "HEALTHY",
    });
    activeCount.set(this.active.size);
    healthGauge.set(this.countByHealth("HEALTHY"), { status: "HEALTHY" });
    logger().info("extension.activated", { extensionId: installation.extensionId, organizationId: installation.organizationId });
  }

  /** Deactivate an extension (graceful shutdown). */
  async deactivate(installationId: string): Promise<void> {
    const active = this.active.get(installationId);
    if (!active) return;
    if (active.module.deactivate) {
      await this.sandbox.run(active.extensionId, active.context.grantedPermissions, async () => {
        await active.module.deactivate!();
      }).catch((e) => logger().warn("extension.deactivate_failed", { extensionId: active.extensionId, error: e instanceof Error ? e.message : String(e) }));
    }
    this.active.delete(installationId);
    activeCount.set(this.active.size);
  }

  /** Run a health check for an extension. */
  async checkHealth(installationId: string): Promise<{ status: HealthStatus; detail?: string }> {
    const active = this.active.get(installationId);
    if (!active) return { status: "OFFLINE" };
    if (!active.module.healthCheck) return { status: "HEALTHY" };
    try {
      const result = await this.sandbox.run(active.extensionId, active.context.grantedPermissions, async () => {
        return active.module.healthCheck!(active.context);
      });
      active.health = result.healthy ? "HEALTHY" : "DEGRADED";
      return { status: active.health, detail: result.detail };
    } catch (e) {
      active.health = "UNHEALTHY";
      return { status: "UNHEALTHY", detail: e instanceof Error ? e.message : String(e) };
    }
  }

  /** List active extensions. */
  listActive(): readonly { installationId: string; extensionId: string; organizationId: string; health: HealthStatus; activatedAt: Date }[] {
    return Array.from(this.active.values()).map((a) => ({
      installationId: a.installationId,
      extensionId: a.extensionId,
      organizationId: a.organizationId,
      health: a.health,
      activatedAt: a.activatedAt,
    }));
  }

  /** Execute an extension handler inside the sandbox. */
  async execute<T>(installationId: string, handler: (ctx: ExtensionContext) => Promise<T>, requiredPermission?: string): Promise<T> {
    const active = this.active.get(installationId);
    if (!active) throw new Error(`Extension not active: ${installationId}`);
    return this.sandbox.run(active.extensionId, active.context.grantedPermissions, () => handler(active.context), requiredPermission);
  }

  private async loadModule(identifier: string, _version: string): Promise<ExtensionModule> {
    // In production, this dynamically imports the extension's compiled entrypoint
    // from the package artifact (verified by signature + checksum). For the
    // foundation milestone, extensions register themselves in an in-process map.
    const mod = registeredExtensions.get(identifier);
    if (!mod) throw new Error(`Extension module not found: ${identifier}. Register it via registerExtension().`);
    return mod;
  }

  private countByHealth(status: HealthStatus): number {
    let n = 0;
    for (const a of this.active.values()) if (a.health === status) n += 1;
    return n;
  }
}

/** Extension registration (for the foundation milestone — production uses dynamic imports). */
export const registeredExtensions = new Map<string, ExtensionModule>();

export function registerExtension(identifier: string, mod: ExtensionModule): void {
  registeredExtensions.set(identifier, mod);
}
