/** The extension manifest schema + validation. */
import { z } from "zod";

export const ManifestSchema = z.object({
  metadata: z.object({
    id: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Must be a reverse-domain id, e.g. com.acme.analytics"),
    name: z.string().min(1).max(100),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "Must be semver, e.g. 1.0.0"),
    description: z.string().max(500),
    publisher: z.string().min(1),
  }),
  capabilities: z.array(z.object({
    name: z.string(),
    config: z.record(z.string(), z.unknown()).optional(),
  })).default([]),
  permissions: z.array(z.object({
    code: z.string().min(1),
    description: z.string().min(1),
  })).default([]),
  requiredAPIs: z.array(z.string()).default([]),
  requiredEvents: z.array(z.string()).default([]),
  configurationSchema: z.record(z.string(), z.unknown()).default({}),
  connectorDependencies: z.array(z.string()).default([]),
  localization: z.object({
    defaultLanguage: z.string(),
    supportedLanguages: z.array(z.string()),
  }).default({ defaultLanguage: "en", supportedLanguages: ["en"] }),
  licensing: z.object({
    type: z.enum(["free", "paid", "subscription", "internal"]),
    licenseUrl: z.string().url().optional(),
  }).default({ type: "free" }),
  compatibility: z.object({
    platformRange: z.string().min(1),
  }),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly manifest?: Manifest;
}

export class ManifestValidator {
  validate(raw: unknown): ManifestValidationResult {
    const result = ManifestSchema.safeParse(raw);
    if (result.success) {
      return { valid: true, errors: [], manifest: result.data };
    }
    return {
      valid: false,
      errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  /** Validate compatibility against the platform version. */
  checkCompatibility(manifest: Manifest, platformVersion: string): { compatible: boolean; reason?: string } {
    // Simple range check: ">=1.0.0 <2.0.0" → parse and check.
    const range = manifest.compatibility.platformRange;
    const rangeMatch = range.match(/^(>=?)(\d+\.\d+\.\d+)\s*(<)?\s*(\d+\.\d+\.\d+)?$/);
    if (!rangeMatch) return { compatible: true };
    const [, op, minStr, ltOp, maxStr] = rangeMatch;
    const min = parseSemver(minStr);
    const current = parseSemver(platformVersion);
    if (op === ">=" && compareSemver(current, min) < 0) return { compatible: false, reason: `Platform ${platformVersion} < required ${minStr}` };
    if (op === ">" && compareSemver(current, min) <= 0) return { compatible: false, reason: `Platform ${platformVersion} <= required ${minStr}` };
    if (ltOp === "<" && maxStr) {
      const max = parseSemver(maxStr);
      if (compareSemver(current, max) >= 0) return { compatible: false, reason: `Platform ${platformVersion} >= max ${maxStr}` };
    }
    return { compatible: true };
  }
}

function parseSemver(s: string): [number, number, number] {
  const [maj, min, patch] = s.split(".").map(Number);
  return [maj ?? 0, min ?? 0, patch ?? 0];
}
function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}
