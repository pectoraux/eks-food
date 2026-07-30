import { describe, expect, it } from "vitest";

/**
 * Inventory tracking — pure-logic reference implementation for the
 * FIMS inventory-tracking service. Tracks the on-hand quantity of an
 * SKU at a location and records four kinds of movements:
 *
 *  - receive(quantity)            — increases on-hand
 *  - consume(quantity)            — decreases on-hand
 *  - transfer(quantity, toLoc)    — decreases on-hand here, increases there
 *  - waste(quantity, reason)      — decreases on-hand, records a reason
 *
 * Inventory cannot go negative — consuming, transferring or wasting
 * more than is on-hand throws. Batches carried by the tracker can be
 * expired, which flips their status to `EXPIRED` and prevents further
 * consumption.
 */

/** Possible batch statuses. */
export type BatchStatus = "ACTIVE" | "EXPIRED" | "RECALLED";

/** Kinds of inventory movements recorded by the ledger. */
export type MovementKind =
  | "RECEIVE"
  | "CONSUME"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "WASTE"
  | "EXPIRE";

/** A single inventory movement. */
export interface InventoryMovement {
  readonly kind: MovementKind;
  readonly quantity: number;
  /** Source location for transfers; same as the SKU's location otherwise. */
  readonly fromLocation?: string;
  /** Destination location for transfers. */
  readonly toLocation?: string;
  readonly reason?: string;
  readonly batchId?: string;
  readonly at: string; // ISO timestamp
}

/** A batch attached to an inventory record. */
export interface InventoryBatch {
  readonly batchId: string;
  readonly quantity: number;
  readonly status: BatchStatus;
  readonly receivedAt: string;
  readonly expiresAt?: string;
}

/** An inventory record: SKU + location + on-hand quantity + movements. */
export interface InventoryRecord {
  readonly sku: string;
  readonly location: string;
  readonly quantity: number;
  readonly batches: readonly InventoryBatch[];
  readonly movements: readonly InventoryMovement[];
}

/** A wastage entry with a reason. */
export interface WastageEntry {
  readonly quantity: number;
  readonly reason: string;
  readonly at: string;
}

/** Options accepted by `receive`. */
export interface ReceiveOptions {
  readonly batchId?: string;
  readonly expiresAt?: string;
}

/**
 * Tracks on-hand quantity, batch status, and the full movement ledger
 * for a single SKU at a single location. Movements are appended (never
 * mutated) so the ledger is an audit-grade history of every receipt,
 * consumption, transfer, wastage and expiration.
 */
export class InventoryTracker {
  private quantity = 0;
  private readonly movements: InventoryMovement[] = [];
  private readonly batches = new Map<string, InventoryBatch>();
  private readonly wastage: WastageEntry[] = [];

  constructor(
    private readonly sku: string,
    private readonly location: string,
  ) {}

  /** Receives `quantity` units into stock (optionally under a batch). */
  receive(quantity: number, opts?: ReceiveOptions): InventoryMovement {
    this.assertPositive(quantity, "receive");
    this.quantity += quantity;
    const at = this.now();
    const batchId = opts?.batchId;
    if (batchId) {
      const existing = this.batches.get(batchId);
      const newQty = (existing?.quantity ?? 0) + quantity;
      const batch: InventoryBatch = {
        batchId,
        quantity: newQty,
        status: existing?.status ?? "ACTIVE",
        receivedAt: existing?.receivedAt ?? at,
        expiresAt: opts?.expiresAt ?? existing?.expiresAt,
      };
      this.batches.set(batchId, batch);
    }
    const movement: InventoryMovement = {
      kind: "RECEIVE",
      quantity,
      toLocation: this.location,
      batchId,
      at,
    };
    this.movements.push(movement);
    return movement;
  }

  /** Consumes `quantity` units from stock. Throws if insufficient. */
  consume(quantity: number, batchId?: string): InventoryMovement {
    this.assertPositive(quantity, "consume");
    // Check the batch BEFORE the on-hand check so callers asking to
    // consume from a specific expired/recalled batch get the more
    // informative batch-status error rather than a generic on-hand
    // error (the on-hand total drops to 0 when a batch expires).
    if (batchId) {
      const batch = this.batches.get(batchId);
      if (!batch) {
        throw new Error(`unknown batch: ${batchId}`);
      }
      if (batch.status !== "ACTIVE") {
        throw new Error(
          `cannot consume from batch ${batchId}: status is ${batch.status}`,
        );
      }
      if (quantity > batch.quantity) {
        throw new Error(
          `cannot consume ${quantity} from batch ${batchId}: only ${batch.quantity} in that batch`,
        );
      }
      this.batches.set(batchId, { ...batch, quantity: batch.quantity - quantity });
    }
    if (quantity > this.quantity) {
      throw new Error(
        `cannot consume ${quantity} of ${this.sku}: only ${this.quantity} on hand`,
      );
    }
    this.quantity -= quantity;
    const at = this.now();
    const movement: InventoryMovement = {
      kind: "CONSUME",
      quantity,
      fromLocation: this.location,
      batchId,
      at,
    };
    this.movements.push(movement);
    return movement;
  }

  /**
   * Transfers `quantity` units from this location to `toLocation`.
   * Decreases on-hand here; the caller is responsible for increasing
   * on-hand at the destination (the destination tracker is not coupled
   * here — this method records the out-movement and returns the
   * movement that the destination tracker should mirror as a
   * `TRANSFER_IN`).
   */
  transfer(quantity: number, toLocation: string, batchId?: string): {
    out: InventoryMovement;
    inMovement: InventoryMovement;
  } {
    this.assertPositive(quantity, "transfer");
    if (toLocation === this.location) {
      throw new Error(
        `cannot transfer to the same location (${this.location})`,
      );
    }
    if (quantity > this.quantity) {
      throw new Error(
        `cannot transfer ${quantity} of ${this.sku}: only ${this.quantity} on hand`,
      );
    }
    if (batchId) {
      const batch = this.batches.get(batchId);
      if (!batch) {
        throw new Error(`unknown batch: ${batchId}`);
      }
      if (batch.status !== "ACTIVE") {
        throw new Error(
          `cannot transfer from batch ${batchId}: status is ${batch.status}`,
        );
      }
      if (quantity > batch.quantity) {
        throw new Error(
          `cannot transfer ${quantity} from batch ${batchId}: only ${batch.quantity} in that batch`,
        );
      }
      this.batches.set(batchId, { ...batch, quantity: batch.quantity - quantity });
    }
    this.quantity -= quantity;
    const at = this.now();
    const out: InventoryMovement = {
      kind: "TRANSFER_OUT",
      quantity,
      fromLocation: this.location,
      toLocation,
      batchId,
      at,
    };
    const inMovement: InventoryMovement = {
      kind: "TRANSFER_IN",
      quantity,
      fromLocation: this.location,
      toLocation,
      batchId,
      at,
    };
    this.movements.push(out);
    return { out, inMovement };
  }

  /** Records `quantity` units as wasted with a `reason`. */
  waste(quantity: number, reason: string, batchId?: string): InventoryMovement {
    this.assertPositive(quantity, "waste");
    if (!reason || reason.trim().length === 0) {
      throw new Error("waste reason is required");
    }
    if (quantity > this.quantity) {
      throw new Error(
        `cannot waste ${quantity} of ${this.sku}: only ${this.quantity} on hand`,
      );
    }
    if (batchId) {
      const batch = this.batches.get(batchId);
      if (!batch) {
        throw new Error(`unknown batch: ${batchId}`);
      }
      this.batches.set(batchId, { ...batch, quantity: batch.quantity - quantity });
    }
    this.quantity -= quantity;
    const at = this.now();
    this.wastage.push({ quantity, reason, at });
    const movement: InventoryMovement = {
      kind: "WASTE",
      quantity,
      fromLocation: this.location,
      reason,
      batchId,
      at,
    };
    this.movements.push(movement);
    return movement;
  }

  /**
   * Marks `batchId` as expired. The batch's status flips to `EXPIRED`
   * and the on-hand quantity is reduced by the batch's remaining
   * quantity (expired stock is no longer on-hand).
   */
  expireBatch(batchId: string, reason = "batch_expired"): InventoryMovement {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new Error(`unknown batch: ${batchId}`);
    }
    if (batch.status === "EXPIRED") {
      throw new Error(`batch ${batchId} is already EXPIRED`);
    }
    const expiredQty = batch.quantity;
    this.quantity = Math.max(0, this.quantity - expiredQty);
    this.batches.set(batchId, { ...batch, status: "EXPIRED", quantity: 0 });
    const at = this.now();
    const movement: InventoryMovement = {
      kind: "EXPIRE",
      quantity: expiredQty,
      fromLocation: this.location,
      batchId,
      reason,
      at,
    };
    this.movements.push(movement);
    return movement;
  }

  /** Snapshot of the current inventory record. */
  toRecord(): InventoryRecord {
    return {
      sku: this.sku,
      location: this.location,
      quantity: this.quantity,
      batches: Array.from(this.batches.values()),
      movements: [...this.movements],
    };
  }

  /** Current on-hand quantity. */
  getQuantity(): number {
    return this.quantity;
  }

  /** All recorded movements (chronological). */
  getMovements(): readonly InventoryMovement[] {
    return [...this.movements];
  }

  /** All recorded wastage entries. */
  getWastage(): readonly WastageEntry[] {
    return [...this.wastage];
  }

  /** Lookup a batch by id. */
  getBatch(batchId: string): InventoryBatch | undefined {
    return this.batches.get(batchId);
  }

  /** Total quantity wasted. */
  totalWasted(): number {
    return this.wastage.reduce((s, w) => s + w.quantity, 0);
  }

  private assertPositive(q: number, op: string): void {
    if (!Number.isFinite(q)) {
      throw new Error(`${op}: quantity must be finite, got: ${q}`);
    }
    if (q <= 0) {
      throw new Error(`${op}: quantity must be > 0, got: ${q}`);
    }
  }

  private now(): string {
    return new Date().toISOString();
  }
}

describe("InventoryTracker", () => {
  describe("receive", () => {
    it("increases the on-hand quantity", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      expect(t.getQuantity()).toBe(0);
      t.receive(100);
      expect(t.getQuantity()).toBe(100);
      t.receive(50);
      expect(t.getQuantity()).toBe(150);
    });

    it("records a RECEIVE movement", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      const moves = t.getMovements();
      expect(moves).toHaveLength(1);
      expect(moves[0]?.kind).toBe("RECEIVE");
      expect(moves[0]?.quantity).toBe(100);
      expect(moves[0]?.toLocation).toBe("WH-A");
    });

    it("registers a batch when batchId is supplied", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100, { batchId: "B-1", expiresAt: "2025-12-31" });
      const batch = t.getBatch("B-1");
      expect(batch).toBeDefined();
      expect(batch?.batchId).toBe("B-1");
      expect(batch?.quantity).toBe(100);
      expect(batch?.status).toBe("ACTIVE");
      expect(batch?.expiresAt).toBe("2025-12-31");
    });

    it("throws on non-positive quantities", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      expect(() => t.receive(0)).toThrowError(/must be > 0/i);
      expect(() => t.receive(-5)).toThrowError(/must be > 0/i);
    });
  });

  describe("consume", () => {
    it("decreases the on-hand quantity", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      t.consume(30);
      expect(t.getQuantity()).toBe(70);
    });

    it("records a CONSUME movement", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      t.consume(30);
      const moves = t.getMovements();
      expect(moves).toHaveLength(2);
      expect(moves[1]?.kind).toBe("CONSUME");
      expect(moves[1]?.quantity).toBe(30);
    });

    it("throws when consuming more than available", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(10);
      expect(() => t.consume(50)).toThrowError(/cannot consume 50/i);
    });

    it("throws when consuming from an unknown batch", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      expect(() => t.consume(10, "no-such-batch")).toThrowError(/unknown batch/i);
    });

    it("throws when consuming from an expired batch", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100, { batchId: "B-1" });
      t.expireBatch("B-1");
      expect(() => t.consume(10, "B-1")).toThrowError(/status is EXPIRED/i);
    });

    it("throws when consuming more than the batch holds", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(20, { batchId: "B-1" });
      t.receive(80); // batchless
      expect(() => t.consume(50, "B-1")).toThrowError(
        /only 20 in that batch/i,
      );
    });

    it("throws on non-positive quantities", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      expect(() => t.consume(0)).toThrowError(/must be > 0/i);
      expect(() => t.consume(-5)).toThrowError(/must be > 0/i);
    });
  });

  describe("transfer", () => {
    it("decreases on-hand at the source and returns an in-movement for the destination", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      const { out, inMovement } = t.transfer(40, "WH-B");
      expect(t.getQuantity()).toBe(60);
      expect(out.kind).toBe("TRANSFER_OUT");
      expect(out.fromLocation).toBe("WH-A");
      expect(out.toLocation).toBe("WH-B");
      expect(out.quantity).toBe(40);
      expect(inMovement.kind).toBe("TRANSFER_IN");
      expect(inMovement.quantity).toBe(40);
      expect(inMovement.fromLocation).toBe("WH-A");
      expect(inMovement.toLocation).toBe("WH-B");
    });

    it("actually moves stock when the destination tracker applies the in-movement", () => {
      const src = new InventoryTracker("SKU-1", "WH-A");
      const dst = new InventoryTracker("SKU-1", "WH-B");
      src.receive(100);
      const { inMovement } = src.transfer(40, "WH-B");
      // The destination tracker mirrors the in-movement as a RECEIVE.
      dst.receive(inMovement.quantity);
      expect(src.getQuantity()).toBe(60);
      expect(dst.getQuantity()).toBe(40);
    });

    it("throws when transferring to the same location", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      expect(() => t.transfer(10, "WH-A")).toThrowError(/same location/i);
    });

    it("throws when transferring more than available", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(10);
      expect(() => t.transfer(50, "WH-B")).toThrowError(/cannot transfer 50/i);
    });

    it("decrements the source batch quantity when transferring from a batch", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100, { batchId: "B-1" });
      t.transfer(40, "WH-B", "B-1");
      expect(t.getBatch("B-1")?.quantity).toBe(60);
    });
  });

  describe("waste", () => {
    it("decreases on-hand and records the reason", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      t.waste(15, "spoilage");
      expect(t.getQuantity()).toBe(85);
      const wastage = t.getWastage();
      expect(wastage).toHaveLength(1);
      expect(wastage[0]?.quantity).toBe(15);
      expect(wastage[0]?.reason).toBe("spoilage");
    });

    it("records a WASTE movement with the reason", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      t.waste(15, "spoilage");
      const moves = t.getMovements();
      expect(moves[1]?.kind).toBe("WASTE");
      expect(moves[1]?.reason).toBe("spoilage");
    });

    it("throws when wasting more than available", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(10);
      expect(() => t.waste(50, "spoilage")).toThrowError(/cannot waste 50/i);
    });

    it("throws when the reason is empty", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      expect(() => t.waste(10, "")).toThrowError(/reason is required/i);
      expect(() => t.waste(10, "   ")).toThrowError(/reason is required/i);
    });

    it("accumulates totalWasted across multiple waste events", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100);
      t.waste(15, "spoilage");
      t.waste(10, "damage");
      expect(t.totalWasted()).toBe(25);
    });
  });

  describe("expireBatch", () => {
    it("sets the batch status to EXPIRED", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100, { batchId: "B-1" });
      t.expireBatch("B-1");
      expect(t.getBatch("B-1")?.status).toBe("EXPIRED");
    });

    it("reduces on-hand by the batch's remaining quantity", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100, { batchId: "B-1" });
      expect(t.getQuantity()).toBe(100);
      t.expireBatch("B-1");
      expect(t.getQuantity()).toBe(0);
    });

    it("records an EXPIRE movement", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(50, { batchId: "B-1" });
      t.expireBatch("B-1");
      const moves = t.getMovements();
      expect(moves[1]?.kind).toBe("EXPIRE");
      expect(moves[1]?.quantity).toBe(50);
      expect(moves[1]?.batchId).toBe("B-1");
    });

    it("prevents further consumption from the expired batch", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100, { batchId: "B-1" });
      t.expireBatch("B-1");
      expect(() => t.consume(10, "B-1")).toThrowError(/status is EXPIRED/i);
    });

    it("throws when expiring an unknown batch", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      expect(() => t.expireBatch("nope")).toThrowError(/unknown batch/i);
    });

    it("throws when expiring a batch that is already EXPIRED", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100, { batchId: "B-1" });
      t.expireBatch("B-1");
      expect(() => t.expireBatch("B-1")).toThrowError(/already EXPIRED/i);
    });

    it("only expires the named batch (other batches remain ACTIVE)", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100, { batchId: "B-1" });
      t.receive(50, { batchId: "B-2" });
      t.expireBatch("B-1");
      expect(t.getBatch("B-1")?.status).toBe("EXPIRED");
      expect(t.getBatch("B-2")?.status).toBe("ACTIVE");
      expect(t.getQuantity()).toBe(50); // only B-2 remains
    });
  });

  describe("toRecord (snapshot)", () => {
    it("returns an immutable snapshot of the inventory record", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(100, { batchId: "B-1" });
      t.consume(20);
      t.waste(5, "spoilage");
      const record = t.toRecord();
      expect(record.sku).toBe("SKU-1");
      expect(record.location).toBe("WH-A");
      expect(record.quantity).toBe(75);
      expect(record.batches).toHaveLength(1);
      expect(record.movements).toHaveLength(3);
      // Snapshot is independent of subsequent mutations.
      t.receive(10);
      expect(record.quantity).toBe(75); // unchanged
      expect(record.movements).toHaveLength(3); // unchanged
    });
  });

  describe("full lifecycle", () => {
    it("records a complete receipt → consume → transfer → waste → expire chain", () => {
      const t = new InventoryTracker("SKU-1", "WH-A");
      t.receive(200, { batchId: "B-1" });
      t.consume(50, "B-1");
      const { out } = t.transfer(30, "WH-B", "B-1");
      t.waste(20, "damaged", "B-1");
      t.expireBatch("B-1");

      const moves = t.getMovements();
      expect(moves.map((m) => m.kind)).toEqual([
        "RECEIVE",
        "CONSUME",
        "TRANSFER_OUT",
        "WASTE",
        "EXPIRE",
      ]);
      // Batch B-1: 200 - 50 - 30 - 20 = 100, then expired (set to 0)
      expect(t.getBatch("B-1")?.status).toBe("EXPIRED");
      expect(t.getBatch("B-1")?.quantity).toBe(0);
      // On-hand: 200 - 50 - 30 - 20 - 100 (expired remainder) = 0
      expect(t.getQuantity()).toBe(0);
      // The transfer out-movement is recorded.
      expect(out.quantity).toBe(30);
      // Total wasted only counts the explicit waste event (not the expire).
      expect(t.totalWasted()).toBe(20);
    });
  });
});
