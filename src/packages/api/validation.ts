import { z } from "zod";
import { ValidationError } from "@eks/errors";

export interface SchemaMap {
  readonly body?: z.ZodType;
  readonly query?: z.ZodType;
  readonly params?: z.ZodType;
}

export function validateBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError("Request body validation failed", toFields(result.error));
  }
  return result.data;
}

export function validateQuery<T>(schema: z.ZodType<T>, searchParams: URLSearchParams | Record<string, string | string[] | undefined>): T {
  const obj = searchParams instanceof URLSearchParams
    ? Object.fromEntries(searchParams.entries())
    : Object.fromEntries(Object.entries(searchParams).filter(([, v]) => v !== undefined));
  const result = schema.safeParse(obj);
  if (!result.success) {
    throw new ValidationError("Query string validation failed", toFields(result.error));
  }
  return result.data;
}

export function validateParams<T>(schema: z.ZodType<T>, params: Record<string, string>): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ValidationError("Path params validation failed", toFields(result.error));
  }
  return result.data;
}

function toFields(error: z.ZodError): ReadonlyArray<{ path: string; message: string }> {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}
