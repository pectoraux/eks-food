import { AppError, ErrorCodes } from "./base";

export class ValidationError extends AppError {
  readonly code = ErrorCodes.VALIDATION_FAILED;
  readonly status = 422;
  constructor(
    message: string,
    readonly fields?: ReadonlyArray<{ path: string; message: string }>
  ) {
    super(message, fields ? { fields } : undefined);
  }
}

export class NotFoundError extends AppError {
  readonly code = ErrorCodes.NOT_FOUND;
  readonly status = 404;
  constructor(resource: string, id?: string) {
    super(`${resource} not found${id ? `: ${id}` : ""}`, { resource, id });
  }
}

export class ConflictError extends AppError {
  readonly code = ErrorCodes.CONFLICT;
  readonly status = 409;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class UnauthorizedError extends AppError {
  readonly code = ErrorCodes.UNAUTHORIZED;
  readonly status = 401;
  constructor(message = "Authentication required") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = ErrorCodes.FORBIDDEN;
  readonly status = 403;
  constructor(message = "Insufficient permissions") {
    super(message);
  }
}

export class ConcurrencyError extends AppError {
  readonly code = ErrorCodes.CONCURRENCY;
  readonly status = 409;
  constructor(message = "Concurrent modification detected") {
    super(message);
  }
}

export class RateLimitError extends AppError {
  readonly code = ErrorCodes.RATE_LIMITED;
  readonly status = 429;
  constructor(message = "Rate limit exceeded", readonly retryAfterMs?: number) {
    super(message, retryAfterMs ? { retryAfterMs } : undefined);
  }
}

export class ExternalServiceError extends AppError {
  readonly code = ErrorCodes.EXTERNAL_SERVICE;
  readonly status = 502;
  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super(`${service}: ${message}`, { service, ...details });
  }
}

export class BusinessRuleError extends AppError {
  readonly code = ErrorCodes.BUSINESS_RULE;
  readonly status = 422;
  constructor(rule: string, message: string) {
    super(message, { rule });
  }
}
