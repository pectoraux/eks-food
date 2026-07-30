/**
 * Import Service — CSV/JSON/supplier catalog imports with validation + rollback.
 */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

export interface ImportResult {
  readonly importId: string;
  readonly totalRows: number;
  readonly validRows: number;
  readonly invalidRows: number;
  readonly importedRows: number;
  readonly errors: readonly { row: number; error: string }[];
}

export class ImportService {
  /** Start an import (creates the CatalogImport record + validates rows). */
  async start(input: {
    organizationId: string;
    format: string; // CSV | XLSX | JSON | SUPPLIER_CATALOG | BARCODE
    source: string;
    rows: readonly Record<string, unknown>[];
    columnMapping?: Record<string, string>;
    performedById: string;
  }): Promise<ImportResult> {
    const importRecord = await db.catalogImport.create({
      data: {
        id: uuid(),
        organizationId: input.organizationId,
        format: input.format,
        source: input.source,
        status: "VALIDATING",
        totalRows: input.rows.length,
        columnMapping: JSON.stringify(input.columnMapping ?? {}),
        performedById: input.performedById,
        startedAt: new Date(),
      },
    });

    const errors: { row: number; error: string }[] = [];
    let validRows = 0;
    let invalidRows = 0;

    // Validate each row + create import row records.
    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i];
      const validation = this.validateRow(row);
      if (validation.valid) {
        validRows++;
        await db.catalogImportRow.create({
          data: {
            importId: importRecord.id,
            rowIndex: i,
            rawData: JSON.stringify(row),
            mappedData: JSON.stringify(this.mapRow(row, input.columnMapping)),
            status: "VALID",
          },
        });
      } else {
        invalidRows++;
        errors.push({ row: i, error: validation.error ?? "Unknown error" });
        await db.catalogImportRow.create({
          data: {
            importId: importRecord.id,
            rowIndex: i,
            rawData: JSON.stringify(row),
            status: "INVALID",
            errors: JSON.stringify([validation.error]),
          },
        });
      }
    }

    await db.catalogImport.update({
      where: { id: importRecord.id },
      data: { status: "PREVIEW", validRows, invalidRows, errors: JSON.stringify(errors) },
    });

    return {
      importId: importRecord.id,
      totalRows: input.rows.length,
      validRows,
      invalidRows,
      importedRows: 0,
      errors,
    };
  }

  /** Commit an import (create catalog items from valid rows). */
  async commit(importId: string): Promise<{ importedRows: number }> {
    const importRecord = await db.catalogImport.findUnique({ where: { id: importId } });
    if (!importRecord) throw new Error("Import not found");
    if (importRecord.status !== "PREVIEW") throw new Error(`Import is in ${importRecord.status} state, not PREVIEW`);

    await db.catalogImport.update({ where: { id: importId }, data: { status: "IMPORTING" } });

    const validRows = await db.catalogImportRow.findMany({ where: { importId, status: "VALID" } });
    let importedRows = 0;

    for (const row of validRows) {
      const data = JSON.parse(row.mappedData) as Record<string, unknown>;
      try {
        const catalogItem = await db.foodCatalog.create({
          data: {
            code: String(data.code ?? `FC-${uuid().slice(0, 8)}`),
            name: String(data.name ?? "Unnamed"),
            description: data.description ? String(data.description) : null,
            itemType: String(data.itemType ?? "INGREDIENT"),
            barcode: data.barcode ? String(data.barcode) : null,
            sku: data.sku ? String(data.sku) : null,
            organizationId: importRecord.organizationId,
            status: "ACTIVE",
          },
        });
        await db.catalogImportRow.update({ where: { id: row.id }, data: { status: "IMPORTED", catalogId: catalogItem.id } });
        importedRows++;
      } catch (e) {
        await db.catalogImportRow.update({ where: { id: row.id }, data: { status: "SKIPPED", errors: JSON.stringify([e instanceof Error ? e.message : String(e)]) } });
      }
    }

    await db.catalogImport.update({
      where: { id: importId },
      data: { status: "COMPLETED", importedRows, completedAt: new Date() },
    });

    return { importedRows };
  }

  /** Rollback an import (delete all catalog items created by it). */
  async rollback(importId: string): Promise<{ rolledBack: number }> {
    const rows = await db.catalogImportRow.findMany({ where: { importId, status: "IMPORTED" } });
    let rolledBack = 0;
    for (const row of rows) {
      if (row.catalogId) {
        await db.foodCatalog.delete({ where: { id: row.catalogId } }).catch(() => null);
        rolledBack++;
      }
    }
    await db.catalogImport.update({ where: { id: importId }, data: { status: "ROLLED_BACK" } });
    return { rolledBack };
  }

  /** Validate a single row. */
  private validateRow(row: Record<string, unknown>): { valid: boolean; error?: string } {
    if (!row.name && !row.code) return { valid: false, error: "Missing required field: name or code" };
    return { valid: true };
  }

  /** Map row data using the column mapping. */
  private mapRow(row: Record<string, unknown>, mapping?: Record<string, string>): Record<string, unknown> {
    if (!mapping) return row;
    const mapped: Record<string, unknown> = {};
    for (const [target, source] of Object.entries(mapping)) {
      mapped[target] = row[source];
    }
    return mapped;
  }
}

export { uuid };
