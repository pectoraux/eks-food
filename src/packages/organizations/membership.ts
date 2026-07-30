/** Membership service — add, remove, change role, suspend, list. */
import { asUUID } from "@eks/common";
import { db } from "@/lib/db";
import { buildIdentityEvent } from "@eks/identity";
import { outbox } from "@eks/events";
import { audit } from "@eks/observability";
import { IDENTITY_AUDIT_ACTIONS } from "@eks/identity";
import { NotFoundError, ConflictError } from "@eks/errors";

export class MembershipService {
  async listForOrg(organizationId: string) {
    return db.membership.findMany({
      where: { organizationId },
      include: { user: true, role: true, teamMembers: { include: { team: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async listForUser(userId: string) {
    return db.membership.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: { include: { type: true } }, role: true },
    });
  }

  async add(userId: string, organizationId: string, roleCode: string, invitedById: string) {
    const existing = await db.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
    if (existing) throw new ConflictError("User is already a member of this organization");
    const role = await db.role.findFirst({ where: { organizationId, code: roleCode } });
    if (!role) throw new NotFoundError("Role", roleCode);
    const membership = await db.membership.create({
      data: { userId, organizationId, roleId: role.id, status: "ACTIVE", acceptedAt: new Date(), invitedById },
    });
    const event = buildIdentityEvent("MembershipAdded", asUUID(membership.id), { userId, organizationId, roleCode });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.MEMBERSHIP_ADDED, entityType: "Membership", entityId: membership.id, organizationId, actorUserId: invitedById, metadata: { userId, roleCode } });
    return membership;
  }

  async remove(userId: string, organizationId: string, removedById: string) {
    const membership = await db.membership.delete({ where: { userId_organizationId: { userId, organizationId } } });
    const event = buildIdentityEvent("MembershipRemoved", asUUID(membership.id), { userId, organizationId });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.MEMBERSHIP_REMOVED, entityType: "Membership", entityId: membership.id, organizationId, actorUserId: removedById, metadata: { userId } });
    return membership;
  }

  async changeRole(userId: string, organizationId: string, newRoleCode: string, changedById: string) {
    const role = await db.role.findFirst({ where: { organizationId, code: newRoleCode } });
    if (!role) throw new NotFoundError("Role", newRoleCode);
    const membership = await db.membership.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { roleId: role.id },
    });
    const event = buildIdentityEvent("RoleAssigned", asUUID(membership.id), { userId, organizationId, roleCode: newRoleCode });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.ROLE_ASSIGNED, entityType: "Membership", entityId: membership.id, organizationId, actorUserId: changedById, metadata: { userId, newRoleCode } });
    return membership;
  }

  async suspend(userId: string, organizationId: string, suspendedById: string, reason: string) {
    const membership = await db.membership.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { status: "SUSPENDED", suspendedAt: new Date() },
    });
    await db.session.updateMany({ where: { userId, organizationId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "MEMBERSHIP_SUSPENDED" } });
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.ACCOUNT_SUSPENDED, entityType: "Membership", entityId: membership.id, organizationId, actorUserId: suspendedById, metadata: { userId, reason } });
    return membership;
  }
}
