/** Request-scoped context (correlation/trace ids) propagated via AsyncLocalStorage. */
import { AsyncLocalStorage } from "node:async_hooks";
import { uuid } from "@eks/common";

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly traceId: string;
  readonly causationId: string | null;
  readonly actorUserId: string | null;
  readonly organizationId: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function requestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function withRequestContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T>;
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T;
export function withRequestContext<T>(ctx: RequestContext, fn: () => T | Promise<T>): T | Promise<T> {
  return storage.run(ctx, fn);
}

/** Create a fresh context for a top-level request, generating ids if absent. */
export function newRequestContext(partial?: Partial<RequestContext>): RequestContext {
  return {
    requestId: partial?.requestId ?? uuid(),
    correlationId: partial?.correlationId ?? partial?.requestId ?? uuid(),
    traceId: partial?.traceId ?? uuid(),
    causationId: partial?.causationId ?? null,
    actorUserId: partial?.actorUserId ?? null,
    organizationId: partial?.organizationId ?? null,
  };
}
