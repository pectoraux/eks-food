/**
 * @eks/observability — structured logging, metrics, tracing & health checks.
 *
 * Every log/metric/span carries a correlationId & traceId so a single request
 * is traceable end-to-end across the API, workers, and external providers.
 */
export { Logger, type LogLevel, type LogFields, createLogger, logger } from "./logger";
export { Metrics, type Counter, type Gauge, type Histogram, metrics, type MetricsSnapshot } from "./metrics";
export { Tracer, type Span, tracer, startSpan, type SpanOptions } from "./tracing";
export { HealthRegistry, type HealthCheck, type HealthStatus, type HealthReport } from "./health";
export { AuditLog, type AuditEvent, audit } from "./audit";
export { requestContext, withRequestContext, type RequestContext } from "./context";
