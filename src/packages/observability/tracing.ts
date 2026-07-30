/** Lightweight distributed tracing — spans with timing & context propagation. */
import { requestContext } from "./context";
import { logger } from "./logger";
import { uuid } from "@eks/common";

export interface SpanOptions {
  readonly name: string;
  readonly parentSpanId?: string | null;
  readonly attributes?: Record<string, unknown>;
  readonly kind?: "internal" | "client" | "server";
}

export interface Span {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly startedAt: number;
  setAttribute(key: string, value: unknown): void;
  recordError(error: unknown): void;
  end(): SpanResult;
}

export interface SpanResult {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly durationMs: number;
  readonly attributes: Record<string, unknown>;
  readonly error?: { message: string; name: string };
  readonly status: "ok" | "error";
}

export class Tracer {
  private readonly activeSpans = new Map<string, SpanImpl>();

  startSpan(options: SpanOptions): Span {
    const ctx = requestContext();
    const spanId = uuid();
    const traceId = ctx?.traceId ?? uuid();
    const impl = new SpanImpl(
      spanId,
      traceId,
      options.parentSpanId ?? null,
      options.name,
      options.attributes ?? {},
      options.kind ?? "internal"
    );
    this.activeSpans.set(spanId, impl);
    return impl;
  }
}

class SpanImpl implements Span {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly startedAt: number;
  private readonly attributes: Record<string, unknown>;
  private ended = false;
  private errorInfo?: { message: string; name: string };

  constructor(
    spanId: string, traceId: string, parentSpanId: string | null,
    name: string, attributes: Record<string, unknown>, _kind: string
  ) {
    this.spanId = spanId;
    this.traceId = traceId;
    this.parentSpanId = parentSpanId;
    this.name = name;
    this.startedAt = performance.now();
    this.attributes = { ...attributes };
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
  }

  recordError(error: unknown): void {
    this.errorInfo = {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Error",
    };
  }

  end(): SpanResult {
    if (this.ended) throw new Error(`Span ${this.name} already ended`);
    this.ended = true;
    const durationMs = Math.round((performance.now() - this.startedAt) * 100) / 100;
    const result: SpanResult = {
      spanId: this.spanId,
      traceId: this.traceId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      durationMs,
      attributes: { ...this.attributes },
      status: this.errorInfo ? "error" : "ok",
      ...(this.errorInfo ? { error: this.errorInfo } : {}),
    };
    logger().debug("span.end", { span: result });
    return result;
  }
}

let _tracer: Tracer;
export function tracer(): Tracer {
  if (!_tracer) _tracer = new Tracer();
  return _tracer;
}

export function startSpan(options: SpanOptions): Span {
  return tracer().startSpan(options);
}

/** Convenience: wrap an async fn in a span, recording errors automatically. */
export async function traced<T>(name: string, fn: (span: Span) => Promise<T>, attributes?: Record<string, unknown>): Promise<T> {
  const span = startSpan({ name, attributes });
  try {
    const result = await fn(span);
    return result;
  } catch (e) {
    span.recordError(e);
    throw e;
  } finally {
    span.end();
  }
}
