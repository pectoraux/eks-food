/**
 * Role registry — global + organization roles.
 * Roles are data (stored in Prisma `Role`); this registry seeds the system
 * roles. Custom org-scoped roles are created at runtime.
 */

export interface RoleDefinition {
  readonly code: string;
  readonly name: string;
  readonly scope: "GLOBAL" | "ORGANIZATION" | "TEAM";
  readonly isSystem: boolean;
  readonly permissions: readonly string[];
  readonly description: string;
}

// Global roles — span all tenants (super admins, support).
export const GLOBAL_ROLES: readonly RoleDefinition[] = [
  {
    code: "SUPER_ADMIN",
    name: "Super Administrator",
    scope: "GLOBAL",
    isSystem: true,
    description: "Full platform access across all tenants.",
    permissions: [
      "user.read", "user.manage", "user.invite",
      "org.read", "org.manage", "org.members.manage", "org.teams.manage",
      "role.read", "role.manage",
      "session.read", "session.revoke",
      "mfa.manage",
      "audit.read",
      "booking.create", "booking.read", "booking.assign", "booking.cancel",
      "cook.read", "cook.manage",
      "payment.initiate", "payment.payout", "payment.read",
      "admin.config", "analytics.read", "inspection.manage", "ai.assistant",
    ],
  },
  {
    code: "SUPPORT",
    name: "Support Agent",
    scope: "GLOBAL",
    isSystem: true,
    description: "Read-only support access across tenants (no config changes).",
    permissions: [
      "user.read", "org.read", "role.read", "session.read", "audit.read",
      "booking.read", "cook.read", "payment.read", "analytics.read", "ai.assistant",
    ],
  },
];

// Organization roles — scoped to a single tenant.
export const ORG_ROLES: readonly RoleDefinition[] = [
  {
    code: "OWNER",
    name: "Organization Owner",
    scope: "ORGANIZATION",
    isSystem: true,
    description: "Full access within the organization, including ownership transfer.",
    permissions: [
      "user.read", "user.manage", "user.invite",
      "org.read", "org.manage", "org.members.manage", "org.teams.manage",
      "role.read", "role.manage",
      "session.read", "session.revoke",
      "audit.read",
      "booking.create", "booking.read", "booking.assign", "booking.cancel",
      "cook.read", "cook.manage",
      "payment.initiate", "payment.payout", "payment.read",
      "admin.config", "analytics.read", "ai.assistant",
    ],
  },
  {
    code: "ADMIN",
    name: "Organization Administrator",
    scope: "ORGANIZATION",
    isSystem: true,
    description: "Manage the organization minus ownership transfer.",
    permissions: [
      "user.read", "user.manage", "user.invite",
      "org.read", "org.members.manage", "org.teams.manage",
      "role.read",
      "session.read", "session.revoke",
      "audit.read",
      "booking.create", "booking.read", "booking.assign", "booking.cancel",
      "cook.read", "cook.manage",
      "payment.initiate", "payment.read",
      "analytics.read", "ai.assistant",
    ],
  },
  {
    code: "MANAGER",
    name: "Manager",
    scope: "ORGANIZATION",
    isSystem: true,
    description: "Operational management — dispatch, assignments, analytics.",
    permissions: [
      "user.read",
      "org.read",
      "role.read",
      "session.read",
      "booking.read", "booking.assign", "booking.cancel",
      "cook.read", "cook.manage",
      "payment.read",
      "analytics.read", "ai.assistant",
    ],
  },
  {
    code: "MEMBER",
    name: "Member",
    scope: "ORGANIZATION",
    isSystem: true,
    description: "Standard organization member (cook, staff).",
    permissions: [
      "org.read",
      "booking.read",
      "cook.read",
      "payment.read",
      "ai.assistant",
    ],
  },
  {
    code: "VIEWER",
    name: "Viewer",
    scope: "ORGANIZATION",
    isSystem: true,
    description: "Read-only access.",
    permissions: ["org.read", "booking.read", "analytics.read"],
  },
];

export class RoleRegistry {
  private readonly all = [...GLOBAL_ROLES, ...ORG_ROLES];
  byCode(code: string): RoleDefinition | undefined {
    return this.all.find((r) => r.code === code);
  }
  byScope(scope: "GLOBAL" | "ORGANIZATION" | "TEAM"): readonly RoleDefinition[] {
    return this.all.filter((r) => r.scope === scope);
  }
  systemRoles(): readonly RoleDefinition[] {
    return this.all.filter((r) => r.isSystem);
  }
}
