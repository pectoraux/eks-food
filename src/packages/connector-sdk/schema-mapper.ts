/** Schema mapping — transform external records to the Eks-Food schema. */
export interface SchemaMappingRule {
  readonly source: string; // dot-notation path in the source record
  readonly target: string; // dot-notation path in the target record
  readonly transform?: (value: unknown) => unknown;
  readonly required?: boolean;
}

/** Apply a set of mapping rules to a source record. */
export function mapSchema(source: Record<string, unknown>, rules: readonly SchemaMappingRule[]): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  for (const rule of rules) {
    const value = getPath(source, rule.source);
    if (value === undefined || value === null) {
      if (rule.required) throw new Error(`Required field missing: ${rule.source}`);
      continue;
    }
    const transformed = rule.transform ? rule.transform(value) : value;
    setPath(target, rule.target, transformed);
  }
  return target;
}

/** Read a dot-notation path from an object. */
export function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a dot-notation path on an object (creating intermediate objects). */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
