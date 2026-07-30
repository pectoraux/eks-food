import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  PERMISSIONS,
  authorize,
  hasPermission,
  type Principal,
  type Role,
} from "../rbac";
import { ForbiddenError } from "@eks/errors";

/**
 * Hand-rolled expectation matrix: for every (permission, role) pair,
 * the boolean that `hasPermission` MUST return.
 *
 * This is the second line of defence: it documents the intent of the
 * permission matrix independently of the `PERMISSIONS` constant, so a
 * typo in `PERMISSIONS` (e.g. accidentally granting `admin.config` to
 * `SUPPORT`) shows up as a failing test here even though the
 * `PERMISSIONS`-derived test below would pass.
 */
const EXPECTED: Record<string, Record<Role, boolean>> = {
  "booking.create": {
    CUSTOMER: true, COOK: false, MANAGER: false, INSPECTOR: false, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: true,
  },
  "booking.read": {
    CUSTOMER: true, COOK: true, MANAGER: true, INSPECTOR: false, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: true,
  },
  "booking.assign": {
    CUSTOMER: false, COOK: false, MANAGER: true, INSPECTOR: false, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: true,
  },
  "booking.cancel": {
    CUSTOMER: true, COOK: false, MANAGER: true, INSPECTOR: false, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: true,
  },
  "cook.read": {
    CUSTOMER: true, COOK: true, MANAGER: true, INSPECTOR: true, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: true,
  },
  "cook.manage": {
    CUSTOMER: false, COOK: false, MANAGER: true, INSPECTOR: false, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: false,
  },
  "payment.initiate": {
    CUSTOMER: true, COOK: false, MANAGER: false, INSPECTOR: false, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: false,
  },
  "payment.payout": {
    CUSTOMER: false, COOK: false, MANAGER: true, INSPECTOR: false, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: false,
  },
  "payment.read": {
    CUSTOMER: true, COOK: true, MANAGER: true, INSPECTOR: false, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: true,
  },
  "admin.config": {
    CUSTOMER: false, COOK: false, MANAGER: false, INSPECTOR: false, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: false,
  },
  "analytics.read": {
    CUSTOMER: false, COOK: false, MANAGER: true, INSPECTOR: false, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: true,
  },
  "inspection.manage": {
    CUSTOMER: false, COOK: false, MANAGER: false, INSPECTOR: true, RIDER: false,
    RESTAURANT: false, SUPPLIER: false, ADMIN: true, SUPER_ADMIN: true, SUPPORT: false,
  },
  "ai.assistant": {
    CUSTOMER: true, COOK: true, MANAGER: true, INSPECTOR: true, RIDER: true,
    RESTAURANT: true, SUPPLIER: true, ADMIN: true, SUPER_ADMIN: true, SUPPORT: true,
  },
};

function makePrincipal(role: Role): Principal {
  return {
    userId: `u-${role.toLowerCase()}`,
    organizationId: "org-1",
    name: `User with role ${role}`,
    roles: [role],
  };
}

describe("RBAC matrix — exhaustive permission × role coverage", () => {
  // Sanity: the expectation matrix covers every permission defined in
  // PERMISSIONS (and no extras). If a permission is added or removed
  // in the source, this test will catch the drift.
  it("EXPECTED matrix covers exactly the same permissions as PERMISSIONS", () => {
    const expectedPerms = Object.keys(EXPECTED).sort();
    const actualPerms = Object.keys(PERMISSIONS).sort();
    expect(expectedPerms).toEqual(actualPerms);
  });

  it("ALL_ROLES contains exactly the 10 canonical roles", () => {
    expect(ALL_ROLES).toHaveLength(10);
    expect(new Set(ALL_ROLES).size).toBe(10);
    // Spot-check each role is present.
    for (const r of [
      "CUSTOMER", "COOK", "MANAGER", "INSPECTOR", "RIDER",
      "RESTAURANT", "SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPPORT",
    ] as const) {
      expect(ALL_ROLES).toContain(r);
    }
  });

  describe("every (permission × role) pair matches the expected allow/deny", () => {
    const permissions = Object.keys(PERMISSIONS);
    for (const permission of permissions) {
      describe(`permission "${permission}"`, () => {
        for (const role of ALL_ROLES) {
          const expected = EXPECTED[permission]?.[role];
          it(`${expected ? "GRANTS" : "DENIES"} to ${role}`, () => {
            const principal = makePrincipal(role);
            expect(hasPermission(principal, permission)).toBe(expected);
          });
        }
      });
    }
  });

  it("EXPECTED matrix agrees with the source-of-truth PERMISSIONS registry", () => {
    // For every (perm, role), the hand-rolled expectation must match
    // what the PERMISSIONS registry actually says. This is what
    // catches typos in either side.
    for (const [permission, allowedRoles] of Object.entries(PERMISSIONS)) {
      const allowedSet = new Set(allowedRoles);
      for (const role of ALL_ROLES) {
        const expected = allowedSet.has(role);
        expect(
          EXPECTED[permission]?.[role],
          `EXPECTED[${permission}][${role}] is undefined — drift`,
        ).toBeDefined();
        expect(EXPECTED[permission]?.[role]).toBe(expected);
      }
    }
  });
});

describe("authorize() — throws ForbiddenError on denial", () => {
  it("throws ForbiddenError (not a generic Error) when permission is missing", () => {
    const customer = makePrincipal("CUSTOMER");
    try {
      authorize(customer, "admin.config");
      throw new Error("authorize should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).status).toBe(403);
    }
  });

  it("the thrown error message contains the denied permission name", () => {
    const customer = makePrincipal("CUSTOMER");
    expect(() => authorize(customer, "booking.assign")).toThrow(ForbiddenError);
    try {
      authorize(customer, "booking.assign");
    } catch (e) {
      expect((e as Error).message).toContain("booking.assign");
    }
  });

  it("does not throw when the principal has the permission", () => {
    const admin = makePrincipal("ADMIN");
    expect(() => authorize(admin, "admin.config")).not.toThrow();
    expect(() => authorize(admin, "booking.create")).not.toThrow();
  });

  it("denies an unknown permission (defensive default)", () => {
    const superAdmin = makePrincipal("SUPER_ADMIN");
    expect(hasPermission(superAdmin, "nonexistent.thing")).toBe(false);
    expect(() => authorize(superAdmin, "nonexistent.thing")).toThrow(ForbiddenError);
  });
});

describe("multi-role principals — union semantics", () => {
  it("a principal with multiple roles is granted if ANY role is allowed", () => {
    // CUSTOMER is denied booking.assign, MANAGER is granted. A
    // principal holding both roles MUST be granted (union semantics).
    const multi: Principal = {
      userId: "u-multi",
      organizationId: "org-1",
      name: "Multi-role user",
      roles: ["CUSTOMER", "MANAGER"],
    };
    expect(hasPermission(multi, "booking.assign")).toBe(true);
    expect(() => authorize(multi, "booking.assign")).not.toThrow();
  });

  it("a principal with two denied roles is still denied", () => {
    const cookAndRider: Principal = {
      userId: "u-cr",
      organizationId: "org-1",
      name: "Cook + Rider",
      roles: ["COOK", "RIDER"],
    };
    // Neither COOK nor RIDER can manage cooks.
    expect(hasPermission(cookAndRider, "cook.manage")).toBe(false);
    expect(() => authorize(cookAndRider, "cook.manage")).toThrow(ForbiddenError);
  });

  it("a principal with SUPER_ADMIN plus any other role is granted every permission SUPER_ADMIN holds", () => {
    // SUPER_ADMIN is in every permission's allow-list (spot-checked
    // here for a few representative permissions).
    const saPlusRider: Principal = {
      userId: "u-sar",
      organizationId: "org-1",
      name: "SA + Rider",
      roles: ["RIDER", "SUPER_ADMIN"],
    };
    expect(hasPermission(saPlusRider, "admin.config")).toBe(true);
    expect(hasPermission(saPlusRider, "payment.payout")).toBe(true);
    expect(hasPermission(saPlusRider, "inspection.manage")).toBe(true);
    expect(hasPermission(saPlusRider, "cook.manage")).toBe(true);
  });

  it("an empty-roles principal is denied every permission", () => {
    const noRoles: Principal = {
      userId: "u-anon",
      organizationId: "org-1",
      name: "No roles",
      roles: [],
    };
    for (const permission of Object.keys(PERMISSIONS)) {
      expect(hasPermission(noRoles, permission)).toBe(false);
    }
  });

  it("RIDER alone can only access ai.assistant (the universal permission)", () => {
    const rider = makePrincipal("RIDER");
    const allowed: string[] = [];
    const denied: string[] = [];
    for (const permission of Object.keys(PERMISSIONS)) {
      if (hasPermission(rider, permission)) allowed.push(permission);
      else denied.push(permission);
    }
    expect(allowed).toEqual(["ai.assistant"]);
    expect(denied.length).toBeGreaterThan(0);
  });

  it("RESTAURANT alone can only access ai.assistant", () => {
    const restaurant = makePrincipal("RESTAURANT");
    const allowed: string[] = [];
    for (const permission of Object.keys(PERMISSIONS)) {
      if (hasPermission(restaurant, permission)) allowed.push(permission);
    }
    expect(allowed).toEqual(["ai.assistant"]);
  });

  it("SUPPLIER alone can only access ai.assistant", () => {
    const supplier = makePrincipal("SUPPLIER");
    const allowed: string[] = [];
    for (const permission of Object.keys(PERMISSIONS)) {
      if (hasPermission(supplier, permission)) allowed.push(permission);
    }
    expect(allowed).toEqual(["ai.assistant"]);
  });
});

describe("PERMISSIONS registry — structural invariants", () => {
  it("every permission maps to a non-empty array of roles", () => {
    for (const [permission, roles] of Object.entries(PERMISSIONS)) {
      expect(Array.isArray(roles)).toBe(true);
      expect(roles.length, `${permission} has no allowed roles`).toBeGreaterThan(0);
      // Every allowed role must be one of the 10 canonical roles.
      for (const r of roles) {
        expect(ALL_ROLES).toContain(r);
      }
    }
  });

  it("no permission contains a duplicate role in its allow-list", () => {
    for (const [permission, roles] of Object.entries(PERMISSIONS)) {
      const set = new Set(roles);
      expect(set.size, `${permission} has duplicate roles`).toBe(roles.length);
    }
  });

  it("SUPER_ADMIN is granted every permission (superuser invariant)", () => {
    for (const permission of Object.keys(PERMISSIONS)) {
      const allowed = PERMISSIONS[permission];
      expect(allowed, `${permission} missing SUPER_ADMIN`).toContain("SUPER_ADMIN");
    }
  });
});
