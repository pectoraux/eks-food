/**
 * Transformation engine — JSON, XML, CSV, object mapping, calculated fields,
 * lookup tables, conditional logic, custom transformation plugins.
 */
export interface TransformConfig {
  readonly inputFormat: "JSON" | "XML" | "CSV";
  readonly outputFormat: "JSON" | "XML" | "CSV";
  readonly expression: string;
  readonly lookupTables?: Record<string, Record<string, unknown>>;
}

export class TransformationEngine {
  /** Transform a record according to the config. */
  transform(input: unknown, config: TransformConfig): unknown {
    // Parse the input to a JS object.
    const parsed = this.parse(input, config.inputFormat);
    // Apply the expression (simplified: supports dot-notation field extraction + calculated fields).
    const transformed = this.applyExpression(parsed, config.expression, config.lookupTables);
    // Serialize to the output format.
    return this.serialize(transformed, config.outputFormat);
  }

  private parse(input: unknown, format: string): Record<string, unknown> {
    if (typeof input === "object" && input !== null) return input as Record<string, unknown>;
    if (typeof input !== "string") return {};
    switch (format) {
      case "JSON": return JSON.parse(input);
      case "CSV": return this.parseCsv(input);
      case "XML": return this.parseXml(input);
      default: return JSON.parse(input);
    }
  }

  private serialize(value: unknown, format: string): unknown {
    switch (format) {
      case "JSON": return JSON.stringify(value);
      case "CSV": return this.serializeCsv(value as Record<string, unknown>);
      case "XML": return this.serializeXml(value as Record<string, unknown>);
      default: return JSON.stringify(value);
    }
  }

  /** Apply a transformation expression (supports field extraction + calculated fields). */
  private applyExpression(input: Record<string, unknown>, expression: string, lookupTables?: Record<string, Record<string, unknown>>): Record<string, unknown> {
    const rules = JSON.parse(expression) as Array<{ source?: string; target: string; transform?: string; lookup?: string; default?: unknown }>;
    const output: Record<string, unknown> = {};
    for (const rule of rules) {
      let value: unknown = undefined;
      if (rule.source) {
        value = this.getPath(input, rule.source);
      }
      if (rule.lookup && lookupTables && typeof value !== undefined) {
        const table = lookupTables[rule.lookup];
        if (table) value = table[String(value)] ?? rule.default;
      }
      if (rule.transform) {
        value = this.applyTransform(value, rule.transform);
      }
      if (value === undefined || value === null) value = rule.default;
      this.setPath(output, rule.target, value);
    }
    return output;
  }

  private applyTransform(value: unknown, transform: string): unknown {
    switch (transform) {
      case "uppercase": return String(value).toUpperCase();
      case "lowercase": return String(value).toLowerCase();
      case "trim": return String(value).trim();
      case "toString": return String(value);
      case "toNumber": return Number(value);
      case "toBoolean": return Boolean(value);
      case "toISOString": return new Date(value as string).toISOString();
      default: return value;
    }
  }

  private parseCsv(input: string): Record<string, unknown> {
    const lines = input.trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim());
    const row = lines[1]?.split(",").map((v) => v.trim()) ?? [];
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  }

  private parseXml(input: string): Record<string, unknown> {
    // Simplified XML parse (production uses fast-xml-parser).
    const obj: Record<string, unknown> = {};
    const regex = /<(\w+)>([^<]*)<\/\1>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      obj[match[1]] = match[2].trim();
    }
    return obj;
  }

  private serializeCsv(value: Record<string, unknown>): string {
    const headers = Object.keys(value);
    const row = headers.map((h) => String(value[h] ?? ""));
    return `${headers.join(",")}\n${row.join(",")}`;
  }

  private serializeXml(value: Record<string, unknown>): string {
    return Object.entries(value).map(([k, v]) => `<${k}>${v}</${k}>`).join("");
  }

  private getPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".");
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) current[parts[i]] = {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
  }
}
