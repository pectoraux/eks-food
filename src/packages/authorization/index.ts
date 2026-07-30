/**
 * @eks/authorization — policy-driven authorization engine (RBAC + ABAC).
 *
 * Two layers:
 *  1. RBAC: a principal's roles (global + org + team) grant a set of permissions.
 *  2. ABAC: policies add contextual rules (ownership, hierarchy, scope, time,
 *     feature restrictions) on top of an RBAC grant.
 *
 * Every decision is explainable: `evaluate()` returns the allow/deny decision
 * plus the reason, which is written to the audit log. No hardcoded permission
 * checks — all authorization flows through this engine.
 */
export { AuthorizationEngine, type AuthContext, type AuthDecision, type AuthResource, type PolicyRule } from "./engine";
export { PermissionRegistry, PERMISSIONS } from "./permissions";
export { RoleRegistry, GLOBAL_ROLES, ORG_ROLES } from "./roles";
export { TenantContext, withTenant, currentTenant, type TenantScope } from "./tenant";
