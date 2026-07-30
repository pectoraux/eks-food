/** Lifecycle manager — install → activate → suspend → upgrade → rollback → remove. */
import { db } from "@/lib/db";
import { buildDeveloperEvent } from "@eks/developer";
import { DEVELOPER_AUDIT_ACTIONS } from "@eks/developer";
import { outbox } from "@eks/events";
import { audit } from "@eks/observability";
import { asUUID } from "@eks/common";
import { NotFoundError, ConflictError, ValidationError } from "@eks/errors";

export interface LifecycleEvent {
  readonly type: "installed" | "activated" | "suspended" | "removed" | "upgraded" | "rolled_back";
  readonly extensionId: string;
  readonly organizationId: string;
  readonly versionId: string;
  readonly actorUserId: string;
}

export class LifecycleManager {
  async install(input: { extensionId: string; versionId: string; organizationId: string; installedById: string; grantedPermissions: string[]; configuration: Record<string, unknown> }): Promise<{ installationId: string }> {
    const existing = await db.extensionInstallation.findUnique({ where: { extensionId_organizationId: { extensionId: input.extensionId, organizationId: input.organizationId } } });
    if (existing) throw new ConflictError("Extension already installed for this organization");
    const installation = await db.extensionInstallation.create({
      data: {
        extensionId: input.extensionId,
        versionId: input.versionId,
        organizationId: input.organizationId,
        status: "PENDING",
        grantedPermissions: JSON.stringify(input.grantedPermissions),
        configuration: JSON.stringify(input.configuration),
        installedById: input.installedById,
      },
    });
    await this.emit("installed", installation.extensionId, installation.organizationId, installation.versionId, input.installedById);
    await audit.record({ action: DEVELOPER_AUDIT_ACTIONS.EXTENSION_INSTALLED, entityType: "ExtensionInstallation", entityId: installation.id, organizationId: input.organizationId, actorUserId: input.installedById, metadata: { extensionId: input.extensionId, versionId: input.versionId, permissions: input.grantedPermissions } });
    return { installationId: installation.id };
  }

  async activate(installationId: string, actorUserId: string): Promise<void> {
    const installation = await db.extensionInstallation.update({ where: { id: installationId }, data: { status: "ACTIVE", activatedAt: new Date() } });
    await this.emit("activated", installation.extensionId, installation.organizationId, installation.versionId, actorUserId);
    await audit.record({ action: DEVELOPER_AUDIT_ACTIONS.EXTENSION_ACTIVATED, entityType: "ExtensionInstallation", entityId: installationId, organizationId: installation.organizationId, actorUserId, metadata: { extensionId: installation.extensionId } });
  }

  async suspend(installationId: string, actorUserId: string, reason: string): Promise<void> {
    const installation = await db.extensionInstallation.update({ where: { id: installationId }, data: { status: "SUSPENDED", suspendedAt: new Date() } });
    await this.emit("suspended", installation.extensionId, installation.organizationId, installation.versionId, actorUserId);
    await audit.record({ action: DEVELOPER_AUDIT_ACTIONS.EXTENSION_SUSPENDED, entityType: "ExtensionInstallation", entityId: installationId, organizationId: installation.organizationId, actorUserId, metadata: { extensionId: installation.extensionId, reason } });
  }

  async remove(installationId: string, actorUserId: string): Promise<void> {
    const installation = await db.extensionInstallation.update({ where: { id: installationId }, data: { status: "REMOVED", removedAt: new Date() } });
    await this.emit("removed", installation.extensionId, installation.organizationId, installation.versionId, actorUserId);
    await audit.record({ action: DEVELOPER_AUDIT_ACTIONS.EXTENSION_REMOVED, entityType: "ExtensionInstallation", entityId: installationId, organizationId: installation.organizationId, actorUserId, metadata: { extensionId: installation.extensionId } });
  }

  async upgrade(installationId: string, newVersionId: string, actorUserId: string): Promise<void> {
    const installation = await db.extensionInstallation.update({ where: { id: installationId }, data: { versionId: newVersionId } });
    await this.emit("upgraded", installation.extensionId, installation.organizationId, newVersionId, actorUserId);
    await audit.record({ action: DEVELOPER_AUDIT_ACTIONS.EXTENSION_UPGRADED, entityType: "ExtensionInstallation", entityId: installationId, organizationId: installation.organizationId, actorUserId, metadata: { extensionId: installation.extensionId, newVersionId } });
  }

  async rollback(installationId: string, previousVersionId: string, actorUserId: string): Promise<void> {
    const installation = await db.extensionInstallation.update({ where: { id: installationId }, data: { versionId: previousVersionId } });
    await this.emit("rolled_back", installation.extensionId, installation.organizationId, previousVersionId, actorUserId);
    await audit.record({ action: DEVELOPER_AUDIT_ACTIONS.EXTENSION_ROLLED_BACK, entityType: "ExtensionInstallation", entityId: installationId, organizationId: installation.organizationId, actorUserId, metadata: { extensionId: installation.extensionId, previousVersionId } });
  }

  private async emit(type: LifecycleEvent["type"], extensionId: string, orgId: string, versionId: string, actorId: string): Promise<void> {
    const eventMap = { installed: "ExtensionInstalled", activated: "ExtensionActivated", suspended: "ExtensionSuspended", removed: "ExtensionRemoved", upgraded: "ExtensionUpgraded", rolled_back: "ExtensionRolledBack" } as const;
    const event = buildDeveloperEvent(eventMap[type], asUUID(extensionId), { organizationId: orgId, versionId, actorUserId: actorId });
    await outbox().stage(event);
  }
}
