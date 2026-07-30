/**
 * @eks/errors — canonical error hierarchy for Eks-Food.
 *
 * Domain & application layers return `Result<T, E>` with these error types.
 * The interface layer maps them to HTTP responses (RFC 7807 problem+json).
 */
export { AppError, ErrorCodes } from "./base";
export { ValidationError, NotFoundError, ConflictError, UnauthorizedError, ForbiddenError, ConcurrencyError, RateLimitError, ExternalServiceError, BusinessRuleError } from "./types";
export { toProblemJson, type ProblemDetails } from "./problem";
