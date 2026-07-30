import { NextRequest } from "next/server";

/**
 * Lightweight HTTP helper for integration-testing Next.js Route Handlers
 * without spinning up a real server.
 *
 * Instead of `fetch()`-ing a live URL, tests import the route handler
 * directly and invoke its `GET` / `POST` / `PUT` / `PATCH` / `DELETE`
 * export with a constructed `NextRequest`. `apiCall` then normalises the
 * `Response` into a plain `{ status, body, headers }` object.
 *
 * @example
 *   import { describe, it, expect } from "vitest";
 *   import { apiCall } from "@eks/testing/http";
 *   import { GET } from "@/app/api/cooks/route";
 *
 *   describe("GET /api/cooks", () => {
 *     it("returns 200 and a cook list", async () => {
 *       const res = await apiCall(GET, "http://localhost/api/cooks");
 *       expect(res.status).toBe(200);
 *       expect(Array.isArray(res.body)).toBe(true);
 *     });
 *   });
 *
 *   describe("POST /api/bookings", () => {
 *     it("creates a booking", async () => {
 *       const res = await apiCall(POST, "http://localhost/api/bookings", {
 *         method: "POST",
 *         body: { cookId: TEST_COOK_ID, scheduledAt: "2024-01-20T18:00:00Z" },
 *       });
 *       expect(res.status).toBe(201);
 *     });
 *   });
 */

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export interface ApiCallOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  searchParams?: Record<string, string | readonly string[]>;
}

/** Construct a NextRequest suitable for handing to a route-handler export. */
export function buildNextRequest(
  url: string,
  options: ApiCallOptions = {},
): NextRequest {
  const { method = "GET", body, headers = {}, searchParams } = options;
  const u = new URL(url);
  if (searchParams) {
    for (const [key, raw] of Object.entries(searchParams)) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) u.searchParams.append(key, value);
    }
  }
  const mergedHeaders: Record<string, string> = {
    "content-type": "application/json",
    ...headers,
  };
  const hasBody = body !== undefined && method !== "GET";
  if (hasBody) {
    const bodyStr =
      typeof body === "string" ? body : JSON.stringify(body);
    return new NextRequest(u, {
      method,
      headers: mergedHeaders,
      body: bodyStr,
    });
  }
  return new NextRequest(u, { method, headers: mergedHeaders });
}

/** A route handler export: takes a NextRequest, returns a Response. */
export type RouteHandler = (
  req: NextRequest,
  ctx?: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response> | Response;

/**
 * Invoke a route-handler export directly with a constructed NextRequest and
 * normalise the resulting Response into `{ status, body, headers }`.
 *
 * The response body is parsed as JSON when `content-type` includes
 * `application/json`; otherwise it's returned as a string.
 */
export async function apiCall(
  handler: RouteHandler,
  url: string,
  options: ApiCallOptions = {},
): Promise<ApiResponse> {
  const req = buildNextRequest(url, options);
  const res = await handler(req);
  const headers = res.headers;
  const text = await res.text();
  const contentType = headers.get("content-type") ?? "";

  let parsedBody: unknown;
  if (text.length === 0) {
    parsedBody = null;
  } else if (contentType.includes("application/json")) {
    parsedBody = JSON.parse(text);
  } else {
    parsedBody = text;
  }

  return { status: res.status, body: parsedBody, headers };
}
