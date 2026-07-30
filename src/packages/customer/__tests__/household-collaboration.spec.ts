import { describe, expect, it } from "vitest";

/**
 * Household collaboration reference implementation + tests.
 *
 * Implements a `HouseholdManager` that tracks members of one or more
 * households, each member having a role from a fixed enum (ADMIN,
 * GUARDIAN, DEPENDENT, GUEST, CAREGIVER). Member removal is gated by
 * role: ADMIN can remove any member, GUARDIAN/CAREGIVER can remove
 * GUEST members (treated as ordinary non-dependent actors here),
 * DEPENDENT members cannot remove anyone, GUEST members cannot remove
 * anyone either. The same user cannot be added twice to the same
 * household.
 */

type HouseholdRole = "ADMIN" | "GUARDIAN" | "DEPENDENT" | "GUEST" | "CAREGIVER";

const HOUSEHOLD_ROLES: readonly HouseholdRole[] = [
  "ADMIN",
  "GUARDIAN",
  "DEPENDENT",
  "GUEST",
  "CAREGIVER",
] as const;

interface HouseholdMember {
  readonly householdId: string;
  readonly userId: string;
  readonly role: HouseholdRole;
  readonly addedAt: Date;
}

class HouseholdMemberAlreadyExistsError extends Error {
  constructor(
    public readonly householdId: string,
    public readonly userId: string,
  ) {
    super(
      `User "${userId}" is already a member of household "${householdId}"`,
    );
    this.name = "HouseholdMemberAlreadyExistsError";
  }
}

class HouseholdMemberNotFoundError extends Error {
  constructor(
    public readonly householdId: string,
    public readonly userId: string,
  ) {
    super(`User "${userId}" is not a member of household "${householdId}"`);
    this.name = "HouseholdMemberNotFoundError";
  }
}

class InsufficientHouseholdRoleError extends Error {
  constructor(
    public readonly actorId: string,
    public readonly actorRole: HouseholdRole,
    public readonly targetId: string,
  ) {
    super(
      `Actor "${actorId}" with role "${actorRole}" cannot remove member "${targetId}"`,
    );
    this.name = "InsufficientHouseholdRoleError";
  }
}

class HouseholdManager {
  /** householdId → (userId → member). */
  private readonly households = new Map<string, Map<string, HouseholdMember>>();

  addMember(
    householdId: string,
    userId: string,
    role: HouseholdRole,
  ): HouseholdMember {
    if (!HOUSEHOLD_ROLES.includes(role)) {
      throw new Error(`Invalid household role: "${role}"`);
    }
    let members = this.households.get(householdId);
    if (!members) {
      members = new Map();
      this.households.set(householdId, members);
    }
    if (members.has(userId)) {
      throw new HouseholdMemberAlreadyExistsError(householdId, userId);
    }
    // First member of a household must be an ADMIN (bootstraps the
    // permission boundary so subsequent mutations can be authorized).
    if (members.size === 0 && role !== "ADMIN") {
      throw new Error(
        `First member of household "${householdId}" must be ADMIN (got "${role}")`,
      );
    }
    const member: HouseholdMember = {
      householdId,
      userId,
      role,
      addedAt: new Date(),
    };
    members.set(userId, member);
    return member;
  }

  /**
   * Remove a member from a household.
   *
   * Permission rules:
   *  - ADMIN can remove any member (including other ADMINs).
   *  - GUARDIAN and CAREGIVER can remove GUEST members only.
   *  - DEPENDENT members cannot remove anyone.
   *  - GUEST members cannot remove anyone.
   *
   * A member is always allowed to remove themselves (self-removal is
   * not a privilege escalation).
   */
  removeMember(
    householdId: string,
    actorUserId: string,
    targetUserId: string,
  ): HouseholdMember {
    const members = this.households.get(householdId);
    if (!members) {
      throw new HouseholdMemberNotFoundError(householdId, targetUserId);
    }
    const target = members.get(targetUserId);
    if (!target) {
      throw new HouseholdMemberNotFoundError(householdId, targetUserId);
    }
    // Self-removal is always allowed.
    if (actorUserId === targetUserId) {
      members.delete(targetUserId);
      return target;
    }
    const actor = members.get(actorUserId);
    if (!actor) {
      throw new HouseholdMemberNotFoundError(householdId, actorUserId);
    }
    if (!canRemove(actor.role, target.role)) {
      throw new InsufficientHouseholdRoleError(
        actorUserId,
        actor.role,
        targetUserId,
      );
    }
    members.delete(targetUserId);
    return target;
  }

  listMembers(householdId: string): readonly HouseholdMember[] {
    const members = this.households.get(householdId);
    if (!members) return [];
    // Return a stable, sorted snapshot (by addedAt then userId) so
    // callers can rely on deterministic ordering in tests.
    return Array.from(members.values()).sort((a, b) => {
      const t = a.addedAt.getTime() - b.addedAt.getTime();
      if (t !== 0) return t;
      return a.userId.localeCompare(b.userId);
    });
  }

  getRole(householdId: string, userId: string): HouseholdRole | undefined {
    const members = this.households.get(householdId);
    if (!members) return undefined;
    return members.get(userId)?.role;
  }

  hasMember(householdId: string, userId: string): boolean {
    const members = this.households.get(householdId);
    return members?.has(userId) ?? false;
  }

  size(householdId: string): number {
    return this.households.get(householdId)?.size ?? 0;
  }
}

function canRemove(
  actorRole: HouseholdRole,
  targetRole: HouseholdRole,
): boolean {
  if (actorRole === "ADMIN") return true;
  if (actorRole === "GUARDIAN" || actorRole === "CAREGIVER") {
    return targetRole === "GUEST";
  }
  // DEPENDENT and GUEST cannot remove anyone.
  return false;
}

describe("HouseholdManager", () => {
  describe("addMember", () => {
    it("adds members to a household", () => {
      const mgr = new HouseholdManager();
      const m = mgr.addMember("h-1", "u-1", "ADMIN");
      expect(m.householdId).toBe("h-1");
      expect(m.userId).toBe("u-1");
      expect(m.role).toBe("ADMIN");
      expect(m.addedAt instanceof Date).toBe(true);
      expect(mgr.size("h-1")).toBe(1);
      expect(mgr.hasMember("h-1", "u-1")).toBe(true);
    });

    it("rejects adding the same user twice to the same household", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-1", "ADMIN");
      expect(() => mgr.addMember("h-1", "u-1", "GUARDIAN")).toThrow(
        HouseholdMemberAlreadyExistsError,
      );
      expect(mgr.size("h-1")).toBe(1);
    });

    it("allows the same user to be a member of different households", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-1", "ADMIN");
      mgr.addMember("h-2", "u-1", "ADMIN");
      expect(mgr.hasMember("h-1", "u-1")).toBe(true);
      expect(mgr.hasMember("h-2", "u-1")).toBe(true);
      expect(mgr.getRole("h-1", "u-1")).toBe("ADMIN");
      expect(mgr.getRole("h-2", "u-1")).toBe("ADMIN");
    });

    it("rejects an invalid role", () => {
      const mgr = new HouseholdManager();
      // Use a runtime coercion to bypass the type system because the
      // test specifically exercises the runtime guard.
      expect(() =>
        mgr.addMember("h-1", "u-1", "SUPERUSER" as HouseholdRole),
      ).toThrow(/Invalid household role/);
    });

    it("requires the first member of a household to be an ADMIN", () => {
      const mgr = new HouseholdManager();
      expect(() => mgr.addMember("h-1", "u-1", "GUEST")).toThrow(/ADMIN/);
      expect(mgr.size("h-1")).toBe(0);
    });

    it("accepts every supported role after the ADMIN bootstrap", () => {
      const mgr = new HouseholdManager();
      // Bootstrap with an ADMIN under a distinct userId so the loop
      // can add one member per role (including another ADMIN) without
      // tripping the duplicate-member guard.
      mgr.addMember("h-1", "u-bootstrap", "ADMIN");
      for (const role of HOUSEHOLD_ROLES) {
        mgr.addMember("h-1", `u-${role.toLowerCase()}`, role);
      }
      expect(mgr.size("h-1")).toBe(HOUSEHOLD_ROLES.length + 1);
    });
  });

  describe("getRole", () => {
    it("returns the role for an existing member", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-1", "ADMIN");
      mgr.addMember("h-1", "u-2", "GUARDIAN");
      mgr.addMember("h-1", "u-3", "DEPENDENT");
      mgr.addMember("h-1", "u-4", "GUEST");
      mgr.addMember("h-1", "u-5", "CAREGIVER");
      expect(mgr.getRole("h-1", "u-1")).toBe("ADMIN");
      expect(mgr.getRole("h-1", "u-2")).toBe("GUARDIAN");
      expect(mgr.getRole("h-1", "u-3")).toBe("DEPENDENT");
      expect(mgr.getRole("h-1", "u-4")).toBe("GUEST");
      expect(mgr.getRole("h-1", "u-5")).toBe("CAREGIVER");
    });

    it("returns undefined for a non-member", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-1", "ADMIN");
      expect(mgr.getRole("h-1", "u-2")).toBeUndefined();
    });

    it("returns undefined for a non-existent household", () => {
      const mgr = new HouseholdManager();
      expect(mgr.getRole("h-missing", "u-1")).toBeUndefined();
    });
  });

  describe("listMembers", () => {
    it("returns all members of a household", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-1", "ADMIN");
      mgr.addMember("h-1", "u-2", "GUARDIAN");
      mgr.addMember("h-1", "u-3", "DEPENDENT");
      const members = mgr.listMembers("h-1");
      expect(members).toHaveLength(3);
      const ids = members.map((m) => m.userId).sort();
      expect(ids).toEqual(["u-1", "u-2", "u-3"]);
    });

    it("returns an empty array for a non-existent household", () => {
      const mgr = new HouseholdManager();
      expect(mgr.listMembers("h-missing")).toEqual([]);
    });

    it("isolates members across households", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-1", "ADMIN");
      mgr.addMember("h-1", "u-2", "GUEST");
      mgr.addMember("h-2", "u-3", "ADMIN");
      mgr.addMember("h-2", "u-4", "GUEST");
      expect(mgr.listMembers("h-1")).toHaveLength(2);
      expect(mgr.listMembers("h-2")).toHaveLength(2);
      expect(mgr.listMembers("h-1").map((m) => m.userId).sort()).toEqual([
        "u-1",
        "u-2",
      ]);
      expect(mgr.listMembers("h-2").map((m) => m.userId).sort()).toEqual([
        "u-3",
        "u-4",
      ]);
    });
  });

  describe("removeMember — permission rules", () => {
    it("admin can remove any member (including another admin)", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-admin-1", "ADMIN");
      mgr.addMember("h-1", "u-admin-2", "ADMIN");
      mgr.addMember("h-1", "u-guardian", "GUARDIAN");
      mgr.addMember("h-1", "u-dependent", "DEPENDENT");
      mgr.addMember("h-1", "u-guest", "GUEST");
      mgr.addMember("h-1", "u-caregiver", "CAREGIVER");

      const removed = mgr.removeMember("h-1", "u-admin-1", "u-admin-2");
      expect(removed.userId).toBe("u-admin-2");
      expect(removed.role).toBe("ADMIN");
      expect(mgr.hasMember("h-1", "u-admin-2")).toBe(false);
      expect(mgr.size("h-1")).toBe(5);

      mgr.removeMember("h-1", "u-admin-1", "u-guardian");
      mgr.removeMember("h-1", "u-admin-1", "u-dependent");
      mgr.removeMember("h-1", "u-admin-1", "u-guest");
      mgr.removeMember("h-1", "u-admin-1", "u-caregiver");
      expect(mgr.size("h-1")).toBe(1);
      expect(mgr.hasMember("h-1", "u-admin-1")).toBe(true);
    });

    it("dependent members cannot remove others", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-admin", "ADMIN");
      mgr.addMember("h-1", "u-dep", "DEPENDENT");
      mgr.addMember("h-1", "u-guest", "GUEST");

      expect(() => mgr.removeMember("h-1", "u-dep", "u-guest")).toThrow(
        InsufficientHouseholdRoleError,
      );
      expect(() => mgr.removeMember("h-1", "u-dep", "u-admin")).toThrow(
        InsufficientHouseholdRoleError,
      );
      // Members are still present.
      expect(mgr.hasMember("h-1", "u-guest")).toBe(true);
      expect(mgr.hasMember("h-1", "u-admin")).toBe(true);
    });

    it("dependent members CAN remove themselves (self-removal)", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-admin", "ADMIN");
      mgr.addMember("h-1", "u-dep", "DEPENDENT");
      const removed = mgr.removeMember("h-1", "u-dep", "u-dep");
      expect(removed.userId).toBe("u-dep");
      expect(mgr.hasMember("h-1", "u-dep")).toBe(false);
    });

    it("guest members cannot remove others", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-admin", "ADMIN");
      mgr.addMember("h-1", "u-guest-1", "GUEST");
      mgr.addMember("h-1", "u-guest-2", "GUEST");
      expect(() => mgr.removeMember("h-1", "u-guest-1", "u-guest-2")).toThrow(
        InsufficientHouseholdRoleError,
      );
    });

    it("guardian can remove guest members only", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-admin", "ADMIN");
      mgr.addMember("h-1", "u-guardian", "GUARDIAN");
      mgr.addMember("h-1", "u-guest", "GUEST");
      mgr.addMember("h-1", "u-dependent", "DEPENDENT");

      // Can remove GUEST.
      expect(mgr.removeMember("h-1", "u-guardian", "u-guest").userId).toBe(
        "u-guest",
      );

      // Cannot remove DEPENDENT or ADMIN.
      expect(() => mgr.removeMember("h-1", "u-guardian", "u-dependent")).toThrow(
        InsufficientHouseholdRoleError,
      );
      expect(() => mgr.removeMember("h-1", "u-guardian", "u-admin")).toThrow(
        InsufficientHouseholdRoleError,
      );
    });

    it("caregiver can remove guest members only", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-admin", "ADMIN");
      mgr.addMember("h-1", "u-caregiver", "CAREGIVER");
      mgr.addMember("h-1", "u-guest", "GUEST");
      expect(mgr.removeMember("h-1", "u-caregiver", "u-guest").userId).toBe(
        "u-guest",
      );
    });

    it("throws when the target member does not exist", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-admin", "ADMIN");
      expect(() => mgr.removeMember("h-1", "u-admin", "u-missing")).toThrow(
        HouseholdMemberNotFoundError,
      );
    });

    it("throws when the actor is not a member", () => {
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-admin", "ADMIN");
      mgr.addMember("h-1", "u-guest", "GUEST");
      expect(() => mgr.removeMember("h-1", "u-outsider", "u-guest")).toThrow(
        HouseholdMemberNotFoundError,
      );
    });

    it("throws when the household does not exist", () => {
      const mgr = new HouseholdManager();
      expect(() => mgr.removeMember("h-missing", "u-1", "u-2")).toThrow(
        HouseholdMemberNotFoundError,
      );
    });
  });

  describe("role enum coverage", () => {
    it("supports all five documented household roles", () => {
      expect(HOUSEHOLD_ROLES).toEqual([
        "ADMIN",
        "GUARDIAN",
        "DEPENDENT",
        "GUEST",
        "CAREGIVER",
      ]);
      const mgr = new HouseholdManager();
      mgr.addMember("h-1", "u-1", "ADMIN");
      mgr.addMember("h-1", "u-2", "GUARDIAN");
      mgr.addMember("h-1", "u-3", "DEPENDENT");
      mgr.addMember("h-1", "u-4", "GUEST");
      mgr.addMember("h-1", "u-5", "CAREGIVER");
      const roles = new Set(mgr.listMembers("h-1").map((m) => m.role));
      expect(roles.size).toBe(5);
      expect(roles).toEqual(new Set(HOUSEHOLD_ROLES));
    });
  });
});
