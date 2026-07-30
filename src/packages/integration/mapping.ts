/**
 * Data mapping engine — field mapping, transformations, validation, enrichment.
 * Maps external records to the Eks-Food schema using a set of mapping rules.
 */
import { mapSchema } from "@eks/connector-sdk";

export interface MappingRule {
  readonly source: string;
  readonly target: string;
  readonly transform?: (value: unknown) => unknown;
  readonly required?: boolean;
}

export class MappingEngine {
  /** Apply mapping rules to a source record. */
  map(source: Record<string, unknown>, rules: readonly MappingRule[]): Record<string, unknown> {
    return mapSchema(source, rules);
  }

  /** Validate that a mapped record has all required fields. */
  validate(mapped: Record<string, unknown>, requiredFields: readonly string[]): { valid: boolean; missing: readonly string[] } {
    const missing = requiredFields.filter((f) => this.getPath(mapped, f) === undefined || this.getPath(mapped, f) === null);
    return { valid: missing.length === 0, missing };
  }

  /** Enrich a mapped record with additional data. */
  enrich(mapped: Record<string, unknown>, enrichment: Record<string, unknown>): Record<string, unknown> {
    const result = { ...mapped };
    for (const [key, value] of Object.entries(enrichment)) {
      this.setPath(result, key, value);
    }
    return result;
  }

  /** Normalize a field value. */
  normalize(value: unknown, type: "string" | "email" | "phone" | "date" | "number"): unknown {
    if (value === null || value === undefined) return value;
    switch (type) {
      case "string": return String(value).trim();
      case "email": return String(value).trim().toLowerCase();
      case "phone": return String(value).replace(/[^\d+]/g, "");
      case "number": return Number(value);
      case "date": return new Date(value as string).toISOString();
    }
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
