export interface SecurityHeaders {
  readonly "x-content-type-options": "nosniff";
  readonly "x-frame-options": "DENY" | "SAMEORIGIN";
  readonly "referrer-policy": string;
  readonly "strict-transport-security": string;
  readonly "permissions-policy": string;
  readonly "content-security-policy"?: string;
}

export const securityHeaders: SecurityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

export function applySecurityHeaders(headers: Headers): void {
  for (const [k, v] of Object.entries(securityHeaders)) {
    headers.set(k, v);
  }
}
