/** Extension logger — auto-tagged with extensionId + organizationId. */
import { logger as platformLogger } from "@eks/observability/logger";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export class ExtensionLogger {
  constructor(
    private readonly extensionId: string,
    private readonly organizationId: string,
    private readonly sink: (level: LogLevel, msg: string, fields?: Record<string, unknown>) => void = defaultSink
  ) {}

  trace(msg: string, fields?: Record<string, unknown>): void { this.emit("trace", msg, fields); }
  debug(msg: string, fields?: Record<string, unknown>): void { this.emit("debug", msg, fields); }
  info(msg: string, fields?: Record<string, unknown>): void { this.emit("info", msg, fields); }
  warn(msg: string, fields?: Record<string, unknown>): void { this.emit("warn", msg, fields); }
  error(msg: string, fields?: Record<string, unknown>): void { this.emit("error", msg, fields); }

  private emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    this.sink(level, msg, { extensionId: this.extensionId, organizationId: this.organizationId, ...fields });
  }
}

function defaultSink(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const log = platformLogger();
  switch (level) {
    case "trace": log.trace(msg, fields); break;
    case "debug": log.debug(msg, fields); break;
    case "info": log.info(msg, fields); break;
    case "warn": log.warn(msg, fields); break;
    case "error": log.error(msg, fields); break;
  }
}
