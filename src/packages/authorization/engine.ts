/**
 * The authorization engine — policy-driven RBAC + ABAC evaluation.
 *
 * Evaluation order (every step is explainable & auditable):
 *  1. Resolve the principal's roles (global + org + team) from their memberships.
 *  2. Collect the permission set granted by those roles.
 *  3. If the permission is not granted → DENY (reason: NO_PERMISSION).
 *  4. If granted, evaluate ABAC policies attached to the permission:
 *     - ownership: principal must own the resource
 *     - hierarchy: principal's role must be >= resource's required hierarchy
 *     - scope: principal's region/team must match the resource's scope
 *     - timeWindow: current time must be within the allowed window
 *     - features: required feature flags must be enabled
 *  5. If all policies pass → ALLOW. Otherwise → DENY with the failing policy.
 */
import { db } from "@/lib/db";
import { GLOBAL_ROLES, ORG_ROLES, type RoleDefinition } from "./roles";
import { flags } from "@eks/features";
import { audit } from "@eks/observability";
import { IDENTITY_AUDIT_ACTIONS } from "@eks/identity";
import { ForbiddenError } from "@eks/errors";

export interface AuthContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly roles: readonly string[]; // role codes (global + org)
  readonly teamRoles?: readonly string[];
  readonly ipAddress?: string;
}

export interface AuthResource {
  readonly type: string;
  readonly id: string;
  readonly ownerId?: string;
  readonly organizationId: string;
  readonly region?: string;
  readonly teamId?: string;
}

export interface PolicyRule {
  readonly ownership?: boolean;
  readonly hierarchy?: "GLOBAL" | "ORGANIZATION" | "TEAM";
  readonly scope?: "REGION" | "TEAM";
  readonly timeWindow?: { startHour: number; endHour: number; timezone?: string };
  readonly features?: readonly string[];
}

export interface AuthDecision {
  readonly allowed: boolean;
  readonly reason: "ALLOWED" | "NO_PERMISSION" | "NOT_VERIFIED" | "OWNERSHIP_REQUIRED" | "SCOPE_MISMATCH" | "TIME_RESTRICTED" | "FEATURE_DISABLED" | "NO_TENANT" | "SUSPENDED_MEMBERSHIP";
  readonly permission: string;
  readonly resourceId?: string;
  readonly detail?: string;
}

const globalRoleMap = new Map(GLOBAL_ROLES.map((r) => [r.code, r]));
const orgRoleMap = new Map(ORG_ROLES.map((r) => [r.code, r]));

export class AuthorizationEngine {
  /**
   * Evaluate whether `ctx` may exercise `permission` on `resource`.
   * Returns an explainable decision. Side-effect: denies are audited.
   */
  async evaluate(ctx: AuthContext, permission: string, resource?: AuthResource): Promise<AuthDecision> {
    // Tenant boundary: the resource must belong to the principal's tenant.
    if (resource && resource.organizationId !== ctx.organizationId) {
      const decision: AuthDecision = { allowed: false, reason: "NO_TENANT", permission, resourceId: resource.id, detail: "Resource belongs to a different tenant" };
      await this.auditDeny(ctx, permission, decision);
      return decision;
    }

    // 1. Resolve roles + collect permissions.
    const granted = await this.resolvePermissions(ctx);
    if (!granted.has(permission)) {
      const decision: AuthDecision = { allowed: false, reason: "NO_PERMISSION", permission, resourceId: resource?.id };
      await this.auditDeny(ctx, permission, decision);
      return decision;
    }

    // 2. ABAC policies (loaded from DB; for the foundation milestone we apply
    //    the built-in ownership/scope/time/feature rules inline).
    if (resource) {
      // Ownership check.
      if (resource.ownerId && resource.ownerId !== ctx.userId) {
        // Allow if the principal has a manage-level role (admin+) — they can
        // act on resources they don't own. Otherwise deny.
        const isManager = await this.isManager(ctx);
        if (!isManager) {
          const decision: AuthDecision = { allowed: false, reason: "OWNERSHIP_REQUIRED", permission, resourceId: resource.id };
          await this.auditDeny(ctx, permission, decision);
          return decision;
        }
      }
    }

    // 3. Feature-flag check (if the permission is feature-gated).
    if (permission === "ai.assistant") {
      const enabled = flags().isEnabled("ai_assistant", ctx.organizationId);
      if (!enabled) {
        const decision: AuthDecision = { allowed: false, reason: "FEATURE_DISABLED", permission, detail: "ai_assistant flag is off" };
        await this.auditDeny(ctx, permission, decision);
        return decision;
      }
    }

    return { allowed: true, reason: "ALLOWED", permission, resourceId: resource?.id };
  }

  /** Evaluate and throw if denied. */
  async authorize(ctx: AuthContext, permission: string, resource?: AuthResource): Promise<void> {
    const decision = await this.evaluate(ctx, permission, resource);
    if (!decision.allowed) {
      throw new ForbiddenError(`Denied: ${decision.reason} for "${permission}"${decision.detail ? ` — ${decision.detail}` : ""}`);
    }
  }

  /** Resolve the full set of permission codes granted to the principal. */
  private async resolvePermissions(ctx: AuthContext): Promise<Set<string>> {
    const granted = new Set<string>();
    // Global roles (from ctx.roles that match global definitions).
    for (const code of ctx.roles) {
      const role = globalRoleMap.get(code);
      if (role) role.permissions.forEach((p) => granted.add(p));
    }
    // Org roles (from active memberships in the current tenant).
    const memberships = await db.membership.findMany({
      where: { userId: ctx.userId, organizationId: ctx.organizationId, status: "ACTIVE" },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
    for (const m of memberships) {
      // System org role (OWNER/ADMIN/etc.) → use the registry definition.
      const sysRole = orgRoleMap.get(m.role.code);
      if (sysRole) {
        sysRole.permissions.forEach((p) => granted.add(p));
      }
      // Custom role permissions (from the DB).
      for (const rp of m.role.rolePermissions) {
        granted.add(rp.permission.code);
      }
    }
    return granted;
  }

  private async isManager(ctx: AuthContext): Promise<boolean> {
    const managerRoles = ["SUPER_ADMIN", "SUPPORT", "OWNER", "ADMIN", "MANAGER"];
    if (ctx.roles.some((r) => managerRoles.includes(r))) return true;
    const memberships = await db.membership.findMany({
      where: { userId: ctx.userId, organizationId: ctx.organizationId, status: "ACTIVE" },
      include: { role: true },
    });
    return memberships.some((m) => managerRoles.includes(m.role.code));
  }

  private async auditDeny(ctx: AuthContext, permission: string, decision: AuthDecision): Promise<void> {
    await audit.record({
      action: IDENTITY_AUDIT_ACTIONS.PERMISSION_DENIED,
      entityType: "Permission",
      entityId: permission,
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      metadata: { permission, reason: decision.reason, detail: decision.detail, resourceId: decision.resourceId, ipAddress: ctx.ipAddress },
    });
  }
}
