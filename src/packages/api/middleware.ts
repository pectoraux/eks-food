import type { NextRequest } from "next/server";

/** Middleware that injects request context & security headers into every response. */
export function requestContextMiddleware(req: NextRequest): Headers {
  const headers = new Headers();
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const correlationId = req.headers.get("x-correlation-id") ?? requestId;
  headers.set("x-request-id", requestId);
  headers.set("x-correlation-id", correlationId);
  // Security headers (OWASP).
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-xss-protection", "0"); // modern browsers; CSP is the control
  headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  return headers;
}
