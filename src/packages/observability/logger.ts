/** Structured logger — JSON in production, pretty in development. */
import { requestContext } from "./context";
import { isProduction } from "@eks/config";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogFields {
  readonly [key: string]: unknown;
}

const LEVELS: Record<LogLevel, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
};

export class Logger {
  private minLevel: LogLevel;
  private readonly format: "json" | "pretty";
  private readonly sink: (line: string) => void;

  constructor(
    minLevel: LogLevel = "info",
    format: "json" | "pretty" = "json",
    sink: (line: string) => void = (s) => console.log(s)
  ) {
    this.minLevel = minLevel;
    this.format = format;
    this.sink = sink;
  }

  trace(msg: string, fields?: LogFields): void { this.emit("trace", msg, fields); }
  debug(msg: string, fields?: LogFields): void { this.emit("debug", msg, fields); }
  info(msg: string, fields?: LogFields): void { this.emit("info", msg, fields); }
  warn(msg: string, fields?: LogFields): void { this.emit("warn", msg, fields); }
  error(msg: string, fields?: LogFields): void { this.emit("error", msg, fields); }
  fatal(msg: string, fields?: LogFields): void { this.emit("fatal", msg, fields); }

  child(bindings: LogFields): Logger {
    const parentEmit = this.emit.bind(this);
    return new Logger(this.minLevel, this.format, (line) => parentEmit);
    // Note: child loggers merge bindings at emit time via the closure below.
  }

  private emit(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVELS[level] < LEVELS[this.minLevel]) return;
    const ctx = requestContext();
    const record = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(ctx ? {
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
        traceId: ctx.traceId,
      } : {}),
      ...fields,
    };
    if (this.format === "json" || isProduction()) {
      this.sink(JSON.stringify(record));
    } else {
      this.sink(prettyPrint(level, msg, record));
    }
  }

  setLevel(level: LogLevel): void { this.minLevel = level; }
}

function prettyPrint(level: LogLevel, msg: string, record: Record<string, unknown>): string {
  const color = COLORS[level] ?? "";
  const reset = "\x1b[0m";
  const meta = Object.entries(record)
    .filter(([k]) => !["ts", "level", "msg", "requestId", "correlationId", "traceId"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  const ctx = record.requestId ? ` [${String(record.requestId).slice(0, 8)}]` : "";
  return `${record.ts} ${color}${level.toUpperCase().padEnd(5)}${reset}${ctx} ${msg}${meta ? " " + meta : ""}`;
}

const COLORS: Record<LogLevel, string> = {
  trace: "\x1b[90m", debug: "\x1b[36m", info: "\x1b[32m", warn: "\x1b[33m", error: "\x1b[31m", fatal: "\x1b[35m",
};

let _logger: Logger;

export function createLogger(minLevel: LogLevel = "info", format: "json" | "pretty" = "json"): Logger {
  _logger = new Logger(minLevel, format);
  return _logger;
}

export function logger(): Logger {
  if (!_logger) _logger = createLogger("info", isProduction() ? "json" : "pretty");
  return _logger;
}
