/**
 * RBAC foundation. Authentication (issuing principals) is Milestone 2; this
 * module defines the principal shape & permission matrix used everywhere.
 */
export type Role =
  | "CUSTOMER" | "COOK" | "MANAGER" | "INSPECTOR" | "RIDER"
  | "RESTAURANT" | "SUPPLIER" | "ADMIN" | "SUPER_ADMIN" | "SUPPORT";

export const ALL_ROLES: readonly Role[] = [
  "CUSTOMER", "COOK", "MANAGER", "INSPECTOR", "RIDER",
  "RESTAURANT", "SUPPLIER", "ADMIN", "SUPER_ADMIN", "SUPPORT",
];

export type Permission = string;

export interface Principal {
  readonly userId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly roles: readonly Role[];
}

/** Permission → allowed roles. The single source of truth for authorization. */
export const PERMISSIONS: Record<Permission, readonly Role[]> = {
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
  "ai.assistant": [...ALL_ROLES],
};

export function hasPermission(principal: Principal, permission: Permission): boolean {
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return principal.roles.some((r) => allowed.includes(r));
}

import { ForbiddenError } from "@eks/errors";

export function authorize(principal: Principal, permission: Permission): void {
  if (!hasPermission(principal, permission)) {
    throw new ForbiddenError(`Missing permission "${permission}"`);
  }
}
