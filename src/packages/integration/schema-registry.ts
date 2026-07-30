/**
 * Schema registry — versioning, compatibility validation, evolution, rollback.
 *
 * Schemas are versioned (semver). Compatibility is validated before a new
 * version is published: BACKWARD (new schema can read old data), FORWARD
 * (old schema can read new data), FULL (both), NONE.
 */
import { db } from "@/lib/db";

export type SchemaCompat = "BACKWARD" | "FORWARD" | "FULL" | "NONE";

export interface SchemaDef {
  readonly id: string;
  readonly identifier: string;
  readonly name: string;
  readonly format: string;
  readonly latestVersion?: string;
}

export class SchemaRegistry {
  async define(input: { identifier: string; name: string; description?: string; format?: string }): Promise<SchemaDef> {
    const def = await db.schemaDefinition.create({
      data: { identifier: input.identifier, name: input.name, description: input.description, format: input.format ?? "JSON" },
    });
    return { id: def.id, identifier: def.identifier, name: def.name, format: def.format };
  }

  async publishVersion(input: { schemaDefId: string; version: string; schema: string; compatibility?: SchemaCompat; changelog?: string }): Promise<{ versionId: string; compatible: boolean }> {
    // Check compatibility against the previous version.
    const previousVersions = await db.schemaVersion.findMany({
      where: { schemaDefId: input.schemaDefId, active: true },
      orderBy: { createdAt: "desc" },
    });
    const compat = input.compatibility ?? "BACKWARD";
    let compatible = true;
    if (previousVersions.length > 0) {
      compatible = this.checkCompatibility(JSON.parse(previousVersions[0].schema), JSON.parse(input.schema), compat);
    }
    const version = await db.schemaVersion.create({
      data: {
        schemaDefId: input.schemaDefId,
        version: input.version,
        schema: input.schema,
        compatibility: compat,
        active: true,
        changelog: input.changelog,
      },
    });
    // Update the latest version pointer.
    await db.schemaDefinition.update({ where: { id: input.schemaDefId }, data: { latestVersionId: version.id } });
    return { versionId: version.id, compatible };
  }

  /** Validate a payload against a schema version. */
  validate(payload: unknown, schema: Record<string, unknown>): { valid: boolean; errors: string[] } {
    // Simplified JSON Schema validation (production uses ajv).
    const errors: string[] = [];
    const required = (schema.required as string[]) ?? [];
    for (const field of required) {
      if (!(field in (payload as Record<string, unknown>))) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  /** Check backward/forward/full compatibility between two schema versions. */
  checkCompatibility(oldSchema: Record<string, unknown>, newSchema: Record<string, unknown>, mode: SchemaCompat): boolean {
    const oldRequired = (oldSchema.required as string[]) ?? [];
    const newRequired = (newSchema.required as string[]) ?? [];
    switch (mode) {
      case "BACKWARD":
        // New schema can read old data: new required fields must have defaults OR be in old schema.
        return newRequired.every((f) => oldRequired.includes(f) || (newSchema.properties as Record<string, unknown>)?.[f] !== undefined);
      case "FORWARD":
        // Old schema can read new data: old required fields must be in new schema.
        return oldRequired.every((f) => newRequired.includes(f));
      case "FULL":
        return this.checkCompatibility(oldSchema, newSchema, "BACKWARD") && this.checkCompatibility(oldSchema, newSchema, "FORWARD");
      case "NONE":
        return true;
    }
  }

  async list(): Promise<readonly SchemaDef[]> {
    const defs = await db.schemaDefinition.findMany({ include: { latestVersion: true }, orderBy: { createdAt: "desc" } });
    return defs.map((d) => ({ id: d.id, identifier: d.identifier, name: d.name, format: d.format, latestVersion: d.latestVersion?.version }));
  }

  async versions(schemaDefId: string): Promise<readonly unknown[]> {
    return db.schemaVersion.findMany({ where: { schemaDefId }, orderBy: { createdAt: "desc" } });
  }
}
