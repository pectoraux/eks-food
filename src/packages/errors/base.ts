/**
 * Base application error. Every Eks-Food error carries a stable `code` for
 * programmatic handling and an HTTP `status` for interface-layer mapping.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly timestamp: string;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

/** Stable error code registry — use these constants, never string literals. */
export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONCURRENCY: "CONCURRENCY",
  RATE_LIMITED: "RATE_LIMITED",
  EXTERNAL_SERVICE: "EXTERNAL_SERVICE",
  BUSINESS_RULE: "BUSINESS_RULE",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
