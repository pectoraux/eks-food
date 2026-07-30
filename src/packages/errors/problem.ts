/** RFC 7807 problem+json serialization for HTTP error responses. */
import { AppError } from "./base";

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly instance?: string;
  readonly traceId?: string;
  readonly timestamp?: string;
  readonly details?: Record<string, unknown>;
}

export function toProblemJson(error: unknown, opts?: { instance?: string; traceId?: string }): ProblemDetails {
  if (error instanceof AppError) {
    return {
      type: `https://docs.eks-food/errors/${error.code.toLowerCase()}`,
      title: error.name.replace(/Error$/, ""),
      status: error.status,
      detail: error.message,
      code: error.code,
      instance: opts?.instance,
      traceId: opts?.traceId,
      timestamp: error.timestamp,
      details: error.details,
    };
  }
  // Unknown error — never leak internals.
  return {
    type: "https://docs.eks-food/errors/internal",
    title: "Internal Server Error",
    status: 500,
    detail: "An unexpected error occurred.",
    code: "INTERNAL",
    instance: opts?.instance,
    traceId: opts?.traceId,
    timestamp: new Date().toISOString(),
  };
}
