/** Invitation service — create, accept, revoke, list. */
import { createHash } from "node:crypto";
import { asUUID } from "@eks/common";
import { db } from "@/lib/db";
import { buildIdentityEvent } from "@eks/identity";
import { outbox } from "@eks/events";
import { audit } from "@eks/observability";
import { IDENTITY_AUDIT_ACTIONS } from "@eks/identity";
import { ConflictError, NotFoundError, ValidationError } from "@eks/errors";

const INVITATION_TTL_DAYS = 7;

export class InvitationService {
  async create(organizationId: string, email: string, roleCode: string, invitedById: string) {
    const role = await db.role.findFirst({ where: { organizationId, code: roleCode } });
    if (!role) throw new NotFoundError("Role", roleCode);
    // Revoke any existing pending invitation for this email+org.
    await db.invitation.updateMany({ where: { organizationId, email: email.toLowerCase(), status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
    const rawToken = generateToken();
    const invitation = await db.invitation.create({
      data: {
        organizationId,
        email: email.toLowerCase(),
        invitedById,
        roleId: role.id,
        status: "PENDING",
        tokenHash: hash(rawToken),
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60_000),
      },
    });
    const event = buildIdentityEvent("InvitationCreated", asUUID(invitation.id), { organizationId, email, roleCode });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.INVITATION_CREATED, entityType: "Invitation", entityId: invitation.id, organizationId, actorUserId: invitedById, metadata: { email, roleCode } });
    return { invitation, rawToken };
  }

  async list(organizationId: string) {
    return db.invitation.findMany({ where: { organizationId }, include: { role: true }, orderBy: { createdAt: "desc" } });
  }

  /** Accept an invitation. The user must exist (registered) and not already be a member. */
  async accept(rawToken: string, userId: string) {
    const invitation = await db.invitation.findUnique({ where: { tokenHash: hash(rawToken) } });
    if (!invitation) throw new NotFoundError("Invitation");
    if (invitation.status !== "PENDING") throw new ValidationError("Invitation is no longer pending");
    if (invitation.expiresAt < new Date()) {
      await db.invitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
      throw new ValidationError("Invitation has expired");
    }
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User", userId);
    if (user.email.toLowerCase() !== invitation.email) throw new ValidationError("Invitation email does not match your account");

    const existing = await db.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: invitation.organizationId } } });
    if (existing) throw new ConflictError("You are already a member of this organization");

    const membership = await db.membership.create({
      data: { userId, organizationId: invitation.organizationId, roleId: invitation.roleId, status: "ACTIVE", acceptedAt: new Date(), invitedById: invitation.invitedById },
    });
    await db.invitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByUserId: userId } });
    const event = buildIdentityEvent("InvitationAccepted", asUUID(invitation.id), { organizationId: invitation.organizationId, userId, roleCode: (await db.role.findUnique({ where: { id: invitation.roleId } }))?.code });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.INVITATION_ACCEPTED, entityType: "Invitation", entityId: invitation.id, organizationId: invitation.organizationId, actorUserId: userId, metadata: { membershipId: membership.id } });
    return { membership, organizationId: invitation.organizationId };
  }

  async revoke(invitationId: string, revokedById: string) {
    const invitation = await db.invitation.update({ where: { id: invitationId }, data: { status: "REVOKED", revokedAt: new Date() } });
    const event = buildIdentityEvent("InvitationRevoked", asUUID(invitation.id), { organizationId: invitation.organizationId });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.INVITATION_REVOKED, entityType: "Invitation", entityId: invitation.id, organizationId: invitation.organizationId, actorUserId: revokedById });
    return invitation;
  }
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `inv_${Buffer.from(bytes).toString("base64url")}`;
}

function hash(token: string): string {
  
  return createHash("sha256").update(Buffer.from(token)).digest("hex");
}
