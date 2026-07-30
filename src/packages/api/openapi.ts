/** OpenAPI spec generator from Zod schemas. Outputs a minimal valid 3.0 doc. */
import type { z } from "zod";

export interface OpenApiRoute {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly tags?: readonly string[];
  readonly request?: { readonly body?: z.ZodType; readonly query?: z.ZodType };
  readonly response?: { readonly 200?: z.ZodType; readonly 201?: z.ZodType };
}

export function buildOpenApiSpec(routes: readonly OpenApiRoute[], opts: { title: string; version: string }): unknown {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const pathItem = paths[r.path] ?? {};
    pathItem[r.method.toLowerCase()] = {
      operationId: r.operationId,
      summary: r.summary,
      tags: r.tags ?? [],
      responses: {
        ...(r.response?.[200] ? { "200": { description: "OK" } } : { "200": { description: "OK" } }),
        ...(r.response?.[201] ? { "201": { description: "Created" } } : {}),
        "400": { description: "Validation failed", content: { "application/problem+json": {} } },
        "401": { description: "Unauthorized" },
        "403": { description: "Forbidden" },
        "429": { description: "Rate limited" },
        "500": { description: "Internal error" },
      },
    };
    paths[r.path] = pathItem;
  }
  return {
    openapi: "3.0.3",
    info: { title: opts.title, version: opts.version },
    paths,
  };
}
