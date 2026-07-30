/** Household Service — member management, relationships, permissions. */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";
import { buildCustomerEvent } from "./events";
import { outbox } from "@eks/events";
import { audit } from "@eks/observability";
import { CUSTOMER_AUDIT_ACTIONS } from "./audit-actions";
import { asUUID } from "@eks/common";

export interface HouseholdMemberInput {
  householdId: string;
  customerProfileId: string;
  role?: string;
  ageGroup?: string;
  isDependent?: boolean;
}

export class HouseholdService {
  async addMember(input: HouseholdMemberInput, addedById: string): Promise<{ memberId: string }> {
    const existing = await db.householdMember.findUnique({
      where: { householdId_customerProfileId: { householdId: input.householdId, customerProfileId: input.customerProfileId } },
    });
    if (existing) throw new Error("Member already exists in this household");

    const member = await db.householdMember.create({
      data: {
        id: uuid(),
        householdId: input.householdId,
        customerProfileId: input.customerProfileId,
        role: input.role ?? "MEMBER",
        ageGroup: input.ageGroup ?? "ADULT",
        isDependent: input.isDependent ?? false,
        canManageHousehold: input.role === "ADMIN",
      },
    });
    const event = buildCustomerEvent("HouseholdMemberAdded", asUUID(input.householdId), { memberId: member.id, customerProfileId: input.customerProfileId, role: input.role });
    await outbox().stage(event);
    await audit.record({ action: CUSTOMER_AUDIT_ACTIONS.HOUSEHOLD_MEMBER_ADDED, entityType: "HouseholdMember", entityId: member.id, organizationId: "", actorUserId: addedById, metadata: { householdId: input.householdId, customerProfileId: input.customerProfileId, role: input.role } });
    return { memberId: member.id };
  }

  async removeMember(householdId: string, customerProfileId: string, removedById: string): Promise<void> {
    await db.householdMember.update({
      where: { householdId_customerProfileId: { householdId, customerProfileId } },
      data: { leftAt: new Date() },
    });
    const event = buildCustomerEvent("HouseholdMemberRemoved", asUUID(householdId), { customerProfileId });
    await outbox().stage(event);
    await audit.record({ action: CUSTOMER_AUDIT_ACTIONS.HOUSEHOLD_MEMBER_REMOVED, entityType: "HouseholdMember", entityId: "", organizationId: "", actorUserId: removedById, metadata: { householdId, customerProfileId } });
  }

  async listMembers(householdId: string): Promise<readonly unknown[]> {
    return db.householdMember.findMany({ where: { householdId, leftAt: null } });
  }

  async createRelationship(householdId: string, fromMemberId: string, toMemberId: string, type: string): Promise<{ id: string }> {
    const rel = await db.householdRelationship.create({
      data: { id: uuid(), householdId, fromMemberId, toMemberId, type },
    });
    const event = buildCustomerEvent("HouseholdRelationshipCreated", asUUID(rel.id), { householdId, type });
    await outbox().stage(event);
    return { id: rel.id };
  }
}

export { uuid };
