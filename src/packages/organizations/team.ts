/** Team service — create teams, add/remove members. */
import { asUUID } from "@eks/common";
import { db } from "@/lib/db";
import { buildIdentityEvent } from "@eks/identity";
import { outbox } from "@eks/events";
import { audit } from "@eks/observability";
import { IDENTITY_AUDIT_ACTIONS } from "@eks/identity";
import { ConflictError, NotFoundError } from "@eks/errors";

export class TeamService {
  async list(organizationId: string) {
    return db.team.findMany({ where: { organizationId }, include: { _count: { select: { members: true } } }, orderBy: { createdAt: "desc" } });
  }

  async create(organizationId: string, name: string, kind: string, creatorUserId: string, description?: string) {
    const existing = await db.team.findUnique({ where: { organizationId_name: { organizationId, name } } });
    if (existing) throw new ConflictError("Team name already exists in this organization");
    const team = await db.team.create({ data: { organizationId, name, kind, description } });
    const event = buildIdentityEvent("TeamCreated", asUUID(team.id), { organizationId, name, kind });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.TEAM_CREATED, entityType: "Team", entityId: team.id, organizationId, actorUserId: creatorUserId, metadata: { name, kind } });
    return team;
  }

  async addMember(teamId: string, membershipId: string, actorUserId: string, roleId?: string) {
    const existing = await db.teamMember.findUnique({ where: { teamId_membershipId: { teamId, membershipId } } });
    if (existing) throw new ConflictError("Member already in this team");
    const member = await db.teamMember.create({ data: { teamId, membershipId, roleId } });
    const event = buildIdentityEvent("TeamMemberAdded", asUUID(member.id), { teamId, membershipId });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.TEAM_MEMBER_ADDED, entityType: "TeamMember", entityId: member.id, organizationId: "", actorUserId, metadata: { teamId, membershipId } });
    return member;
  }

  async removeMember(teamId: string, membershipId: string, actorUserId: string) {
    const member = await db.teamMember.delete({ where: { teamId_membershipId: { teamId, membershipId } } });
    const event = buildIdentityEvent("TeamMemberRemoved", asUUID(member.id), { teamId, membershipId });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.TEAM_MEMBER_REMOVED, entityType: "TeamMember", entityId: member.id, organizationId: "", actorUserId, metadata: { teamId, membershipId } });
    return member;
  }
}
