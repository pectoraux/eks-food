import type { NextRequest } from "next/server";

/** Wrap a Route Handler with: request-context, error mapping, tracing, logging. */
export type RouteHandler<T = unknown> = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<Response> | Response;

export interface ApiContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly traceId: string;
}

import { requestContext, withRequestContext, newRequestContext } from "@eks/observability/context";
import { logger } from "@eks/observability/logger";
import { startSpan } from "@eks/observability/tracing";
import { toProblemJson } from "@eks/errors";
import { AppError } from "@eks/errors/base";

export function apiHandler<T = unknown>(
  handler: RouteHandler<T>,
  opts?: { operation?: string }
): RouteHandler<T> {
  return async (req, ctx) => {
    const reqCtx = newRequestContext({
      requestId: req.headers.get("x-request-id") ?? undefined,
      correlationId: req.headers.get("x-correlation-id") ?? undefined,
      traceId: req.headers.get("x-trace-id") ?? undefined,
    });

    return withRequestContext(reqCtx, async () => {
      const span = startSpan({ name: opts?.operation ?? req.method, kind: "server" });
      span.setAttribute("http.method", req.method);
      span.setAttribute("http.path", req.nextUrl.pathname);

      try {
        const res = await handler(req, ctx);
        span.setAttribute("http.status", res.status);
        if (!res.headers.has("x-request-id")) {
          res.headers.set("x-request-id", reqCtx.requestId);
          res.headers.set("x-correlation-id", reqCtx.correlationId);
        }
        return res;
      } catch (e) {
        span.recordError(e);
        const problem = toProblemJson(e, { traceId: reqCtx.traceId, instance: req.nextUrl.pathname });
        logger().error("api.request_failed", {
          operation: opts?.operation, status: problem.status, code: problem.code,
          error: e instanceof Error ? e.message : String(e),
        });
        return Response.json(problem, {
          status: problem.status,
          headers: {
            "content-type": "application/problem+json",
            "x-request-id": reqCtx.requestId,
            "x-correlation-id": reqCtx.correlationId,
          },
        });
      } finally {
        span.end();
      }
    });
  };
}
