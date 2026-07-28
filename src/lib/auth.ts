/**
 * Authorization context for Eks-Food.
 *
 * Role-based access control + permission-based authorization. In production this
 * resolves the authenticated principal from the request (NextAuth session /
 * signed JWT). In this reference deployment it derives a deterministic demo
 * principal from headers so the full RBAC surface is exercisable end-to-end.
 */

export type Role =
  | "CUSTOMER"
  | "COOK"
  | "MANAGER"
  | "INSPECTOR"
  | "RIDER"
  | "RESTAURANT"
  | "SUPPLIER"
  | "ADMIN"
  | "SUPER_ADMIN"
  | "SUPPORT";

export const ALL_ROLES: Role[] = [
  "CUSTOMER",
  "COOK",
  "MANAGER",
  "INSPECTOR",
  "RIDER",
  "RESTAURANT",
  "SUPPLIER",
  "ADMIN",
  "SUPER_ADMIN",
  "SUPPORT",
];

export interface Principal {
  userId: string;
  organizationId: string;
  name: string;
  roles: Role[];
}

/**
 * Permission matrix. Each permission maps to the roles allowed to exercise it.
 * This is the single source of truth for authorization — extend here, never
 * inline checks in route handlers.
 */
export const PERMISSIONS: Record<string, Role[]> = {
  "booking.create": ["CUSTOMER", "ADMIN", "SUPER_ADMIN", "SUPPORT"],
  "booking.read": ["CUSTOMER", "COOK", "MANAGER", "ADMIN", "SUPER_ADMIN", "SUPPORT"],
  "booking.assign": ["MANAGER", "ADMIN", "SUPER_ADMIN", "SUPPORT"],
  "booking.cancel": ["CUSTOMER", "MANAGER", "ADMIN", "SUPER_ADMIN", "SUPPORT"],
  "cook.read": ["CUSTOMER", "COOK", "MANAGER", "INSPECTOR", "ADMIN", "SUPER_ADMIN", "SUPPORT"],
  "cook.manage": ["MANAGER", "ADMIN", "SUPER_ADMIN"],
  "payment.initiate": ["CUSTOMER", "ADMIN", "SUPER_ADMIN"],
  "payment.payout": ["MANAGER", "ADMIN", "SUPER_ADMIN"],
  "payment.read": ["CUSTOMER", "COOK", "MANAGER", "ADMIN", "SUPER_ADMIN", "SUPPORT"],
  "admin.config": ["ADMIN", "SUPER_ADMIN"],
  "analytics.read": ["MANAGER", "ADMIN", "SUPER_ADMIN", "SUPPORT"],
  "inspection.manage": ["INSPECTOR", "ADMIN", "SUPER_ADMIN"],
  "ai.assistant": ALL_ROLES,
};

export function hasPermission(principal: Principal, permission: string): boolean {
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return principal.roles.some((r) => allowed.includes(r));
}

export function authorize(principal: Principal, permission: string): void {
  if (!hasPermission(principal, permission)) {
    throw new AuthorizationError(
      `Forbidden: missing permission "${permission}" for roles [${principal.roles.join(", ")}]`
    );
  }
}

export class AuthorizationError extends Error {
  status = 403;
}

/**
 * Resolve the principal from a request. Demo-mode: the caller may pass
 * `x-eks-user` and `x-eks-roles` headers to impersonate any principal so the
 * entire RBAC surface is testable without a full auth deployment. A default
 * SUPER_ADMIN principal is returned when no header is supplied.
 */
export function resolvePrincipal(headers: Headers): Principal {
  const userId = headers.get("x-eks-user") ?? "demo-user";
  const organizationId = headers.get("x-eks-org") ?? "eks-default";
  const name = headers.get("x-eks-name") ?? "Demo Operator";
  const rolesHeader = headers.get("x-eks-roles");
  const roles: Role[] = rolesHeader
    ? (rolesHeader.split(",").map((r) => r.trim().toUpperCase()) as Role[])
    : ["SUPER_ADMIN"];

  return { userId, organizationId, name, roles };
}

/**
 * Returns a value safe for AuditLog.actorUserId FK, or null for demo principals
 * whose userId is not a persisted record. Demo principals use "demo-user".
 */
export function safeActorId(principal: Principal): string | null {
  if (!principal.userId) return null;
  // Seeded cuid ids start with "cm" and are 24+ chars. Demo/impersonated ids
  // that aren't persisted should not be written to the FK column.
  if (principal.userId.startsWith("cm") && principal.userId.length >= 20) {
    return principal.userId;
  }
  return null;
}
