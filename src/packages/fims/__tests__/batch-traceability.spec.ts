import { describe, expect, it } from "vitest";

/**
 * Batch traceability — pure-logic reference implementation for the
 * FIMS batch-traceability service. A `BatchTracker` records every
 * movement of a batch (receipt, transfer, consumption, recall) and
 * can return:
 *
 *  - the complete movement history (chain of custody)
 *  - the recall state (recall marks all quantities as recalled)
 *  - a human-readable traceability chain from receipt to consumption
 *
 * This is the spec the production `@eks/fims` BatchTracker will
 * satisfy once it lands.
 */

/** Status of a batch. */
export type BatchStatus = "ACTIVE" | "EXPIRED" | "RECALLED";

/** Kind of batch movement. */
export type BatchMovementKind =
  | "RECEIVED"
  | "MOVED"
  | "CONSUMED"
  | "RECALLED";

/** A single batch movement entry. */
export interface BatchMovement {
  readonly kind: BatchMovementKind;
  readonly batchId: string;
  readonly quantity: number;
  readonly fromLocation?: string;
  readonly toLocation?: string;
  readonly at: string; // ISO timestamp
  readonly note?: string;
}

/** A received batch. */
export interface Batch {
  readonly batchId: string;
  readonly sku: string;
  readonly quantity: number;
  readonly receivedAt: string;
  readonly receivedAtLocation: string;
  readonly expiresAt?: string;
  readonly status: BatchStatus;
}

/** Options for receiving a batch. */
export interface ReceiveBatchOptions {
  readonly sku: string;
  readonly quantity: number;
  readonly receivedAtLocation: string;
  readonly expiresAt?: string;
  readonly at?: string;
}

/**
 * Tracks a batch through its lifecycle: receipt → moves → consumption,
 * with the ability to recall the batch (which marks every quantity as
 * recalled).
 *
 * The tracker is append-only: movements are never deleted. The full
 * chain of custody is always recoverable from `history()`.
 */
export class BatchTracker {
  private batch?: Batch;
  private readonly movements: BatchMovement[] = [];
  /** Remaining quantity in the batch (decreases as it's consumed). */
  private remaining = 0;
  /** Total quantity recalled. */
  private recalledQty = 0;

  /** Receives a new batch into the tracker. Throws if a batch is already loaded. */
  receive(opts: ReceiveBatchOptions): Batch {
    if (this.batch) {
      throw new Error(
        `tracker already carries batch ${this.batch.batchId}; use a new tracker for ${opts.sku}`,
      );
    }
    if (!Number.isFinite(opts.quantity) || opts.quantity <= 0) {
      throw new Error(`quantity must be > 0, got: ${opts.quantity}`);
    }
    const at = opts.at ?? new Date().toISOString();
    const batch: Batch = {
      batchId: opts.sku, // the caller passes the batchId via `sku` field if they wish; we expose batchId below
      sku: opts.sku,
      quantity: opts.quantity,
      receivedAt: at,
      receivedAtLocation: opts.receivedAtLocation,
      expiresAt: opts.expiresAt,
      status: "ACTIVE",
    };
    this.batch = batch;
    this.remaining = opts.quantity;
    this.movements.push({
      kind: "RECEIVED",
      batchId: batch.batchId,
      quantity: opts.quantity,
      toLocation: opts.receivedAtLocation,
      at,
    });
    return batch;
  }

  /**
   * Receives a batch with an explicit `batchId` (preferred over `receive`
   * when the batch id differs from the SKU).
   */
  receiveBatch(
    batchId: string,
    sku: string,
    quantity: number,
    receivedAtLocation: string,
    opts: { expiresAt?: string; at?: string } = {},
  ): Batch {
    if (this.batch) {
      throw new Error(
        `tracker already carries batch ${this.batch.batchId}; use a new tracker for ${batchId}`,
      );
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`quantity must be > 0, got: ${quantity}`);
    }
    const at = opts.at ?? new Date().toISOString();
    const batch: Batch = {
      batchId,
      sku,
      quantity,
      receivedAt: at,
      receivedAtLocation,
      expiresAt: opts.expiresAt,
      status: "ACTIVE",
    };
    this.batch = batch;
    this.remaining = quantity;
    this.movements.push({
      kind: "RECEIVED",
      batchId,
      quantity,
      toLocation: receivedAtLocation,
      at,
    });
    return batch;
  }

  /** Moves the batch from `fromLocation` to `toLocation`. */
  move(batchId: string, fromLocation: string, toLocation: string, at?: string): BatchMovement {
    this.assertLoaded(batchId);
    if (fromLocation === toLocation) {
      throw new Error(`cannot move batch to the same location (${fromLocation})`);
    }
    if (this.batch?.status === "RECALLED") {
      throw new Error(`cannot move batch ${batchId}: status is RECALLED`);
    }
    if (this.remaining <= 0) {
      throw new Error(`cannot move batch ${batchId}: nothing remaining`);
    }
    const movement: BatchMovement = {
      kind: "MOVED",
      batchId,
      quantity: this.remaining,
      fromLocation,
      toLocation,
      at: at ?? new Date().toISOString(),
    };
    this.movements.push(movement);
    return movement;
  }

  /** Consumes `quantity` units of the batch at `atLocation`. */
  consume(batchId: string, quantity: number, atLocation: string, at?: string): BatchMovement {
    this.assertLoaded(batchId);
    if (this.batch?.status === "RECALLED") {
      throw new Error(`cannot consume batch ${batchId}: status is RECALLED`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`quantity must be > 0, got: ${quantity}`);
    }
    if (quantity > this.remaining) {
      throw new Error(
        `cannot consume ${quantity} from batch ${batchId}: only ${this.remaining} remaining`,
      );
    }
    this.remaining -= quantity;
    const movement: BatchMovement = {
      kind: "CONSUMED",
      batchId,
      quantity,
      fromLocation: atLocation,
      at: at ?? new Date().toISOString(),
    };
    this.movements.push(movement);
    return movement;
  }

  /**
   * Recalls the batch — marks the batch status as `RECALLED` and
   * records the recall of all remaining quantity. Returns the recall
   * movement.
   */
  recall(batchId: string, reason?: string, at?: string): BatchMovement {
    this.assertLoaded(batchId);
    if (!this.batch) {
      throw new Error(`no batch loaded for ${batchId}`);
    }
    if (this.batch.status === "RECALLED") {
      throw new Error(`batch ${batchId} is already RECALLED`);
    }
    const recalledNow = this.remaining;
    this.recalledQty += recalledNow;
    this.remaining = 0;
    this.batch = { ...this.batch, status: "RECALLED" };
    const movement: BatchMovement = {
      kind: "RECALLED",
      batchId,
      quantity: recalledNow,
      note: reason,
      at: at ?? new Date().toISOString(),
    };
    this.movements.push(movement);
    return movement;
  }

  /** Returns the full movement history (chronological). */
  history(): readonly BatchMovement[] {
    return [...this.movements];
  }

  /** Returns the recall movement(s) for the batch. */
  recalls(): readonly BatchMovement[] {
    return this.movements.filter((m) => m.kind === "RECALLED");
  }

  /** Returns the total quantity recalled. */
  totalRecalled(): number {
    return this.recalledQty;
  }

  /** Remaining quantity in the batch (post-consumption, pre-recall). */
  remainingQuantity(): number {
    return this.remaining;
  }

  /** Snapshot of the batch (or `undefined` if not loaded). */
  getBatch(): Batch | undefined {
    return this.batch;
  }

  /**
   * Builds a human-readable traceability chain from receipt through
   * every movement, in chronological order. Each entry is a string
   * describing one movement.
   */
  traceabilityChain(): readonly string[] {
    const lines: string[] = [];
    for (const m of this.movements) {
      switch (m.kind) {
        case "RECEIVED":
          lines.push(
            `[${m.at}] RECEIVED ${m.quantity} units → ${m.toLocation}`,
          );
          break;
        case "MOVED":
          lines.push(
            `[${m.at}] MOVED ${m.quantity} units: ${m.fromLocation} → ${m.toLocation}`,
          );
          break;
        case "CONSUMED":
          lines.push(
            `[${m.at}] CONSUMED ${m.quantity} units at ${m.fromLocation}`,
          );
          break;
        case "RECALLED":
          lines.push(
            `[${m.at}] RECALLED ${m.quantity} units${m.note ? ` (reason: ${m.note})` : ""}`,
          );
          break;
      }
    }
    return lines;
  }

  private assertLoaded(batchId: string): void {
    if (!this.batch) {
      throw new Error(`no batch loaded (expected ${batchId})`);
    }
    if (this.batch.batchId !== batchId) {
      throw new Error(
        `batch id mismatch: tracker carries ${this.batch.batchId}, expected ${batchId}`,
      );
    }
  }
}

describe("BatchTracker", () => {
  describe("receiveBatch", () => {
    it("creates a batch with status ACTIVE and the supplied quantity", () => {
      const t = new BatchTracker();
      const batch = t.receiveBatch("B-1001", "SKU-1", 500, "WH-RECEIVING");
      expect(batch.batchId).toBe("B-1001");
      expect(batch.sku).toBe("SKU-1");
      expect(batch.quantity).toBe(500);
      expect(batch.receivedAtLocation).toBe("WH-RECEIVING");
      expect(batch.status).toBe("ACTIVE");
    });

    it("records a RECEIVED movement", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1001", "SKU-1", 500, "WH-RECEIVING");
      const history = t.history();
      expect(history).toHaveLength(1);
      expect(history[0]?.kind).toBe("RECEIVED");
      expect(history[0]?.quantity).toBe(500);
      expect(history[0]?.toLocation).toBe("WH-RECEIVING");
    });

    it("throws when receiving a second batch into the same tracker", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1001", "SKU-1", 500, "WH-RECEIVING");
      expect(() => t.receiveBatch("B-1002", "SKU-1", 100, "WH-RECEIVING")).toThrowError(
        /already carries batch/i,
      );
    });

    it("throws on non-positive quantities", () => {
      const t = new BatchTracker();
      expect(() => t.receiveBatch("B-1", "SKU-1", 0, "WH")).toThrowError(/must be > 0/i);
      expect(() => t.receiveBatch("B-1", "SKU-1", -10, "WH")).toThrowError(/must be > 0/i);
    });
  });

  describe("move", () => {
    it("records a MOVED movement from one location to another", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.move("B-1", "WH-A", "WH-B");
      const moves = t.history();
      expect(moves[1]?.kind).toBe("MOVED");
      expect(moves[1]?.fromLocation).toBe("WH-A");
      expect(moves[1]?.toLocation).toBe("WH-B");
      expect(moves[1]?.quantity).toBe(100); // entire remaining quantity
    });

    it("throws when moving to the same location", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      expect(() => t.move("B-1", "WH-A", "WH-A")).toThrowError(/same location/i);
    });

    it("throws when the batch id does not match", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      expect(() => t.move("B-X", "WH-A", "WH-B")).toThrowError(/batch id mismatch/i);
    });

    it("throws when nothing remains to move", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.consume("B-1", 100, "WH-A");
      expect(() => t.move("B-1", "WH-A", "WH-B")).toThrowError(/nothing remaining/i);
    });
  });

  describe("consume", () => {
    it("decrements the remaining quantity", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.consume("B-1", 30, "WH-A");
      expect(t.remainingQuantity()).toBe(70);
    });

    it("records a CONSUMED movement", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.consume("B-1", 30, "WH-A");
      const moves = t.history();
      expect(moves[1]?.kind).toBe("CONSUMED");
      expect(moves[1]?.quantity).toBe(30);
      expect(moves[1]?.fromLocation).toBe("WH-A");
    });

    it("throws when consuming more than remaining", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      expect(() => t.consume("B-1", 200, "WH-A")).toThrowError(
        /cannot consume 200/i,
      );
    });
  });

  describe("recall", () => {
    it("marks the batch status as RECALLED", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.recall("B-1", "quality_complaint");
      expect(t.getBatch()?.status).toBe("RECALLED");
    });

    it("marks all remaining quantity as recalled", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.consume("B-1", 30, "WH-A");
      // 70 remain; recalling should mark all 70 as recalled.
      t.recall("B-1", "quality_complaint");
      expect(t.totalRecalled()).toBe(70);
      expect(t.remainingQuantity()).toBe(0);
    });

    it("records a RECALLED movement with the reason", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.recall("B-1", "quality_complaint");
      const recalls = t.recalls();
      expect(recalls).toHaveLength(1);
      expect(recalls[0]?.kind).toBe("RECALLED");
      expect(recalls[0]?.quantity).toBe(100);
      expect(recalls[0]?.note).toBe("quality_complaint");
    });

    it("prevents further moves and consumption after recall", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.recall("B-1", "quality_complaint");
      expect(() => t.move("B-1", "WH-A", "WH-B")).toThrowError(/status is RECALLED/i);
      expect(() => t.consume("B-1", 10, "WH-A")).toThrowError(/status is RECALLED/i);
    });

    it("throws when recalling an already-recalled batch", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.recall("B-1", "first");
      expect(() => t.recall("B-1", "second")).toThrowError(/already RECALLED/i);
    });
  });

  describe("traceabilityChain (full chain of custody)", () => {
    it("records the complete chain from receipt to consumption", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-RECEIVING");
      t.move("B-1", "WH-RECEIVING", "WH-A");
      t.move("B-1", "WH-A", "WH-B");
      t.consume("B-1", 40, "WH-B");
      t.consume("B-1", 60, "WH-B");
      const chain = t.traceabilityChain();
      expect(chain).toHaveLength(5);
      // First entry: receipt
      expect(chain[0]).toMatch(/RECEIVED 100 units → WH-RECEIVING/);
      // Second entry: first move
      expect(chain[1]).toMatch(/MOVED 100 units: WH-RECEIVING → WH-A/);
      // Third entry: second move
      expect(chain[2]).toMatch(/MOVED 100 units: WH-A → WH-B/);
      // Fourth entry: first consumption
      expect(chain[3]).toMatch(/CONSUMED 40 units at WH-B/);
      // Fifth entry: second consumption
      expect(chain[4]).toMatch(/CONSUMED 60 units at WH-B/);
    });

    it("includes recall entries in the chain when the batch is recalled", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.consume("B-1", 30, "WH-A");
      t.recall("B-1", "quality_complaint");
      const chain = t.traceabilityChain();
      expect(chain).toHaveLength(3);
      expect(chain[0]).toMatch(/RECEIVED/);
      expect(chain[1]).toMatch(/CONSUMED 30/);
      expect(chain[2]).toMatch(/RECALLED 70 units/);
      expect(chain[2]).toMatch(/quality_complaint/);
    });

    it("records movements in chronological order", () => {
      const t = new BatchTracker();
      const t0 = "2024-01-01T00:00:00.000Z";
      const t1 = "2024-01-02T00:00:00.000Z";
      const t2 = "2024-01-03T00:00:00.000Z";
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A", { at: t0 });
      t.move("B-1", "WH-A", "WH-B", t1);
      t.consume("B-1", 50, "WH-B", t2);
      const chain = t.traceabilityChain();
      // All entries should be in the supplied chronological order.
      expect(chain[0]).toContain("2024-01-01");
      expect(chain[1]).toContain("2024-01-02");
      expect(chain[2]).toContain("2024-01-03");
    });
  });

  describe("history (raw movement ledger)", () => {
    it("returns every movement in chronological order", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.move("B-1", "WH-A", "WH-B");
      t.consume("B-1", 25, "WH-B");
      t.recall("B-1", "complaint");
      const history = t.history();
      expect(history.map((m) => m.kind)).toEqual([
        "RECEIVED",
        "MOVED",
        "CONSUMED",
        "RECALLED",
      ]);
    });

    it("does not mutate when subsequent movements occur (snapshot semantics)", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      const snapshot = t.history();
      t.consume("B-1", 10, "WH-A");
      // The snapshot taken before the consumption should still show
      // only the RECEIVED movement.
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]?.kind).toBe("RECEIVED");
      // A fresh snapshot reflects the new state.
      expect(t.history()).toHaveLength(2);
    });
  });

  describe("totalRecalled", () => {
    it("is 0 before any recall", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      expect(t.totalRecalled()).toBe(0);
    });

    it("equals the remaining quantity at the moment of recall", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-1", "SKU-1", 100, "WH-A");
      t.consume("B-1", 25, "WH-A");
      t.recall("B-1");
      expect(t.totalRecalled()).toBe(75);
    });
  });

  describe("full lifecycle (receipt → move → consume → recall)", () => {
    it("preserves the complete chain of custody and final state", () => {
      const t = new BatchTracker();
      t.receiveBatch("B-9", "SKU-FLOUR", 1000, "WH-DOCK", {
        expiresAt: "2025-12-31",
      });
      t.move("B-9", "WH-DOCK", "WH-COLD");
      t.move("B-9", "WH-COLD", "KITCHEN-1");
      t.consume("B-9", 250, "KITCHEN-1");
      t.consume("B-9", 350, "KITCHEN-1");
      t.recall("B-9", "foreign_object_detected");

      // Final state: fully recalled, nothing remaining.
      expect(t.getBatch()?.status).toBe("RECALLED");
      expect(t.remainingQuantity()).toBe(0);
      // Recalled qty = 1000 - 250 - 350 = 400.
      expect(t.totalRecalled()).toBe(400);

      // The complete chain of custody is recorded.
      const chain = t.traceabilityChain();
      expect(chain).toHaveLength(6);
      expect(chain[0]).toMatch(/RECEIVED 1000 units → WH-DOCK/);
      expect(chain[1]).toMatch(/MOVED 1000 units: WH-DOCK → WH-COLD/);
      expect(chain[2]).toMatch(/MOVED 1000 units: WH-COLD → KITCHEN-1/);
      expect(chain[3]).toMatch(/CONSUMED 250 units at KITCHEN-1/);
      expect(chain[4]).toMatch(/CONSUMED 350 units at KITCHEN-1/);
      expect(chain[5]).toMatch(/RECALLED 400 units/);
      expect(chain[5]).toMatch(/foreign_object_detected/);

      // The raw movement ledger has the same shape.
      const history = t.history();
      expect(history.map((m) => m.kind)).toEqual([
        "RECEIVED",
        "MOVED",
        "MOVED",
        "CONSUMED",
        "CONSUMED",
        "RECALLED",
      ]);
    });
  });
});
