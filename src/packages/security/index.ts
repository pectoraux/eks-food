/**
 * @eks/security — security foundation (auth deferred to Milestone 2).
 *
 * Provides: encryption utilities (AES-GCM), secure cookie helpers, input
 * sanitization, security headers, rate-limiting integration, audit-trail hook,
 * and a session foundation interface. No authentication logic yet.
 */
export { encrypt, decrypt, deriveKey, type EncryptedPayload } from "./crypto";
export { signCookie, verifyCookie, type CookieOptions } from "./cookies";
export { sanitizeString, sanitizeHtml, containsSqlInjectionPattern } from "./sanitization";
export { securityHeaders, type SecurityHeaders } from "./headers";
export { type Principal, type Permission, PERMISSIONS, hasPermission, authorize } from "./rbac";
