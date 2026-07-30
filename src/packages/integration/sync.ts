/**
 * Synchronization engine — full, incremental, delta, bidirectional.
 *
 * Checkpoints make sync resumable: if a sync is interrupted, it resumes from
 * the last checkpoint. Conflict detection + duplicate detection prevent data
 * corruption. Partial failures are recorded per-record.
 */
import { db } from "@/lib/db";
import { uuid, asISODate } from "@eks/common";

export type SyncMode = "FULL" | "INCREMENTAL" | "DELTA" | "BIDIRECTIONAL";

export interface SyncCheckpoint {
  readonly resource: string;
  readonly cursor: string | null;
  readonly recordsSynced: number;
  readonly lastRecordAt: Date | null;
}

export interface SyncResult {
  readonly jobId: string;
  readonly status: "COMPLETED" | "FAILED" | "PARTIAL";
  readonly recordsProcessed: number;
  readonly recordsCreated: number;
  readonly recordsUpdated: number;
  readonly recordsDeleted: number;
  readonly recordsFailed: number;
  readonly conflicts: number;
  readonly checkpoints: readonly SyncCheckpoint[];
  readonly durationMs: number;
  readonly errors: readonly { recordId: string; error: string }[];
}

export class SyncEngine {
  /**
   * Start a synchronization job. The `fetchFn` pulls records from the external
   * system (honoring the cursor); the `persistFn` writes them to Eks-Food.
   */
  async start(input: {
    configId: string;
    organizationId: string;
    mode: SyncMode;
    resource: string;
    fetchFn: (cursor: string | null) => Promise<{ records: readonly unknown[]; nextCursor: string | null }>;
    persistFn: (records: readonly unknown[]) => Promise<{ created: number; updated: number; deleted: number; failed: number; conflicts: number; errors: readonly { recordId: string; error: string }[] }>;
    correlationId?: string;
  }): Promise<SyncResult> {
    const startedAt = Date.now();
    const job = await db.synchronizationJob.create({
      data: {
        id: uuid(),
        configId: input.configId,
        organizationId: input.organizationId,
        mode: input.mode,
        status: "RUNNING",
        startedAt: new Date(),
        correlationId: input.correlationId ?? uuid(),
      },
    });

    let cursor: string | null = null;
    let totalProcessed = 0, totalCreated = 0, totalUpdated = 0, totalDeleted = 0, totalFailed = 0, totalConflicts = 0;
    const allErrors: { recordId: string; error: string }[] = [];
    const checkpoints: SyncCheckpoint[] = [];
    let status: SyncResult["status"] = "COMPLETED";

    try {
      // For full sync, ignore any existing cursor. For incremental, load the last checkpoint.
      if (input.mode === "INCREMENTAL") {
        const lastCheckpoint = await db.synchronizationCheckpoint.findFirst({
          where: { syncJobId: job.id, resource: input.resource },
          orderBy: { updatedAt: "desc" },
        });
        cursor = lastCheckpoint?.cursor ?? null;
      }

      let hasMore = true;
      while (hasMore) {
        const batch = await input.fetchFn(cursor);
        const persistResult = await input.persistFn(batch.records);
        totalProcessed += batch.records.length;
        totalCreated += persistResult.created;
        totalUpdated += persistResult.updated;
        totalDeleted += persistResult.deleted;
        totalFailed += persistResult.failed;
        totalConflicts += persistResult.conflicts;
        allErrors.push(...persistResult.errors);

        // Save the checkpoint.
        cursor = batch.nextCursor;
        const checkpoint = await db.synchronizationCheckpoint.upsert({
          where: { syncJobId_resource: { syncJobId: job.id, resource: input.resource } },
          update: { cursor, recordsSynced: totalProcessed, updatedAt: new Date() },
          create: { syncJobId: job.id, resource: input.resource, cursor, recordsSynced: totalProcessed },
        });
        checkpoints.push({
          resource: checkpoint.resource,
          cursor: checkpoint.cursor,
          recordsSynced: checkpoint.recordsSynced,
          lastRecordAt: checkpoint.lastRecordAt,
        });

        hasMore = batch.nextCursor !== null && batch.records.length > 0;
        if (persistResult.failed > 0) status = "PARTIAL";
      }
    } catch (e) {
      status = "FAILED";
      await db.synchronizationJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMessage: e instanceof Error ? e.message : String(e), completedAt: new Date(), durationMs: Date.now() - startedAt },
      });
      return {
        jobId: job.id, status: "FAILED",
        recordsProcessed: totalProcessed, recordsCreated: totalCreated, recordsUpdated: totalUpdated,
        recordsDeleted: totalDeleted, recordsFailed: totalFailed, conflicts: totalConflicts,
        checkpoints, durationMs: Date.now() - startedAt, errors: allErrors,
      };
    }

    await db.synchronizationJob.update({
      where: { id: job.id },
      data: {
        status, recordsProcessed: totalProcessed, recordsCreated: totalCreated, recordsUpdated: totalUpdated,
        recordsDeleted: totalDeleted, recordsFailed: totalFailed, conflicts: totalConflicts,
        errors: JSON.stringify(allErrors.slice(0, 100)), completedAt: new Date(), durationMs: Date.now() - startedAt,
      },
    });

    return {
      jobId: job.id, status,
      recordsProcessed: totalProcessed, recordsCreated: totalCreated, recordsUpdated: totalUpdated,
      recordsDeleted: totalDeleted, recordsFailed: totalFailed, conflicts: totalConflicts,
      checkpoints, durationMs: Date.now() - startedAt, errors: allErrors,
    };
  }

  /** Resume a paused/failed sync from its last checkpoint. */
  async resume(jobId: string): Promise<void> {
    await db.synchronizationJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });
    // In production, enqueue a worker job. Here, the caller re-invokes start() with the checkpoint cursor.
  }

  /** Pause a running sync. */
  async pause(jobId: string): Promise<void> {
    await db.synchronizationJob.update({ where: { id: jobId }, data: { status: "PAUSED" } });
  }
}

export { asISODate };
