/**
 * Tenant context — strict multi-tenant isolation via AsyncLocalStorage.
 *
 * Every tenant-scoped request runs inside a `withTenant(orgId, ...)` block.
 * Repository layers read `currentTenant()` to filter every query by
 * organizationId. A missing tenant context returns null, so a query without a
 * tenant scope returns empty — never another tenant's data.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantScope {
  readonly organizationId: string;
  readonly userId: string | null;
  readonly roleCodes: readonly string[];
}

const storage = new AsyncLocalStorage<TenantScope>();

export function currentTenant(): TenantScope | undefined {
  return storage.getStore();
}

export function withTenant<T>(scope: TenantScope, fn: () => Promise<T>): Promise<T>;
export function withTenant<T>(scope: TenantScope, fn: () => T): T;
export function withTenant<T>(scope: TenantScope, fn: () => T | Promise<T>): T | Promise<T> {
  return storage.run(scope, fn);
}

/** Assert a tenant scope is set (for tenant-scoped handlers). */
export function requireTenant(): TenantScope {
  const scope = storage.getStore();
  if (!scope) throw new Error("Tenant scope required but not set — wrap the handler in withTenant()");
  return scope;
}

export class TenantContext {
  static current(): TenantScope | undefined { return currentTenant(); }
  static require(): TenantScope { return requireTenant(); }
  static run<T>(scope: TenantScope, fn: () => Promise<T> | T): Promise<T> | T { return withTenant(scope, fn); }
}
