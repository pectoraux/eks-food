/**
 * Permission registry — the single source of truth for permission codes.
 * Mirrors @eks/security PERMISSIONS but adds metadata (resource, description).
 */
export interface PermissionEntry {
  readonly code: string;
  readonly name: string;
  readonly resource: string;
  readonly description: string;
}

export const PERMISSIONS: readonly PermissionEntry[] = [
  // Identity & access
  { code: "user.read", name: "Read users", resource: "identity", description: "View user profiles within the tenant" },
  { code: "user.manage", name: "Manage users", resource: "identity", description: "Create, update, suspend, delete users" },
  { code: "user.invite", name: "Invite users", resource: "identity", description: "Send organization invitations" },
  // Organizations
  { code: "org.read", name: "Read organization", resource: "organization", description: "View organization details" },
  { code: "org.manage", name: "Manage organization", resource: "organization", description: "Update organization settings, branding, configuration" },
  { code: "org.members.manage", name: "Manage memberships", resource: "organization", description: "Add, remove, change roles of members" },
  { code: "org.teams.manage", name: "Manage teams", resource: "organization", description: "Create, update, delete teams" },
  // Roles & permissions
  { code: "role.read", name: "Read roles", resource: "rbac", description: "View roles and permissions" },
  { code: "role.manage", name: "Manage roles", resource: "rbac", description: "Create, update, delete custom roles" },
  // Sessions
  { code: "session.read", name: "Read sessions", resource: "session", description: "View active sessions (self or all-tenant)" },
  { code: "session.revoke", name: "Revoke sessions", resource: "session", description: "Revoke user sessions" },
  // MFA
  { code: "mfa.manage", name: "Manage MFA", resource: "security", description: "Enroll, disable MFA factors" },
  // Audit
  { code: "audit.read", name: "Read audit logs", resource: "audit", description: "View audit log entries" },
  // Booking (future milestones — defined here so RBAC is complete)
  { code: "booking.create", name: "Create bookings", resource: "booking", description: "Create new bookings" },
  { code: "booking.read", name: "Read bookings", resource: "booking", description: "View bookings" },
  { code: "booking.assign", name: "Assign bookings", resource: "booking", description: "Assign cooks to bookings" },
  { code: "booking.cancel", name: "Cancel bookings", resource: "booking", description: "Cancel bookings" },
  // Cook
  { code: "cook.read", name: "Read cooks", resource: "cook", description: "View cook profiles" },
  { code: "cook.manage", name: "Manage cooks", resource: "cook", description: "Approve, suspend, manage cooks" },
  // Payments
  { code: "payment.initiate", name: "Initiate payments", resource: "payment", description: "Create payment intents" },
  { code: "payment.payout", name: "Request payouts", resource: "payment", description: "Request worker payouts" },
  { code: "payment.read", name: "Read payments", resource: "payment", description: "View payment records" },
  // Admin
  { code: "admin.config", name: "Admin configuration", resource: "admin", description: "Manage platform configuration, feature flags" },
  // Analytics
  { code: "analytics.read", name: "Read analytics", resource: "analytics", description: "View analytics dashboards" },
  // Inspections
  { code: "inspection.manage", name: "Manage inspections", resource: "safety", description: "Schedule, complete inspections" },
  // AI
  { code: "ai.assistant", name: "Use AI assistant", resource: "ai", description: "Access the AI assistant" },
] as const;

export class PermissionRegistry {
  private readonly map = new Map(PERMISSIONS.map((p) => [p.code, p]));
  all(): readonly PermissionEntry[] { return PERMISSIONS; }
  get(code: string): PermissionEntry | undefined { return this.map.get(code); }
  has(code: string): boolean { return this.map.has(code); }
  byResource(resource: string): readonly PermissionEntry[] { return PERMISSIONS.filter((p) => p.resource === resource); }
}
