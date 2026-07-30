/**
 * @eks/api — production API foundation for Next.js Route Handlers.
 *
 * Provides: request-context middleware (correlation/trace IDs), standard error
 * handling (RFC 7807), Zod request validation, cursor/offset pagination
 * helpers, idempotency-key support, and rate limiting. OpenAPI generation is
 * scaffolded via Zod schemas (see ./openapi.ts).
 */
export { apiHandler, type ApiContext, type RouteHandler } from "./handler";
export { validateBody, validateQuery, validateParams, type SchemaMap } from "./validation";
export { rateLimit, type RateLimiter } from "./rate-limit";
export { idempotency } from "./idempotency";
export { buildOpenApiSpec, type OpenApiRoute } from "./openapi";
export { requestContextMiddleware } from "./middleware";
export { success, created, noContent, paginated, type ApiResponse } from "./response";
