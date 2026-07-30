/**
 * Inventory Service — stock movements, reservations, waste tracking, audits.
 * Every movement is auditable. Full traceability via batch references.
 */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

export type MovementType = "RECEIVE" | "TRANSFER" | "CONSUME" | "ADJUST" | "WASTE" | "SPOILAGE" | "RETURN";

export interface StockMovement {
  readonly id: string;
  readonly inventoryId: string;
  readonly type: MovementType;
  readonly quantity: number;
  readonly unit: string;
  readonly batchId?: string;
  readonly fromLocationId?: string;
  readonly toLocationId?: string;
  readonly reason?: string;
  readonly performedById?: string;
  readonly createdAt: Date;
}

export class InventoryService {
  /** Record a stock movement + update inventory quantity. */
  async recordMovement(input: {
    inventoryId: string;
    type: MovementType;
    quantity: number;
    unit?: string;
    batchId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    reason?: string;
    performedById?: string;
  }): Promise<StockMovement> {
    const inventory = await db.inventory.findUnique({ where: { id: input.inventoryId } });
    if (!inventory) throw new Error(`Inventory not found: ${input.inventoryId}`);

    // Calculate the quantity delta (positive for in, negative for out).
    const isInbound = input.type === "RECEIVE" || input.type === "RETURN";
    const isOutbound = input.type === "CONSUME" || input.type === "WASTE" || input.type === "SPOILAGE";
    const delta = isInbound ? input.quantity : isOutbound ? -input.quantity : 0; // TRANSFER/ADJUST handled separately

    // For outbound, check sufficient stock.
    if (isOutbound && inventory.quantity < input.quantity) {
      throw new Error(`Insufficient stock: have ${inventory.quantity}${input.unit ?? inventory.unit}, need ${input.quantity}`);
    }

    // Record the movement.
    const movement = await db.inventoryMovement.create({
      data: {
        id: uuid(),
        inventoryId: input.inventoryId,
        type: input.type,
        quantity: input.quantity,
        unit: input.unit ?? inventory.unit,
        batchId: input.batchId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        metadata: JSON.stringify({ reason: input.reason }),
        performedById: input.performedById,
      },
    });

    // Update inventory quantity (for non-transfer movements).
    if (delta !== 0) {
      await db.inventory.update({
        where: { id: input.inventoryId },
        data: { quantity: Math.max(0, inventory.quantity + delta) },
      });
    }

    // If this is a waste movement, also create a WasteRecord.
    if (input.type === "WASTE" || input.type === "SPOILAGE") {
      await db.wasteRecord.create({
        data: {
          organizationId: inventory.organizationId,
          inventoryId: input.inventoryId,
          batchId: input.batchId,
          type: input.type === "SPOILAGE" ? "SPOILAGE" : "OVERPRODUCTION",
          quantity: input.quantity,
          unit: input.unit ?? inventory.unit,
          reason: input.reason,
          recordedById: input.performedById ?? "system",
        },
      });
    }

    return {
      id: movement.id,
      inventoryId: movement.inventoryId,
      type: movement.type as MovementType,
      quantity: movement.quantity,
      unit: movement.unit,
      batchId: movement.batchId ?? undefined,
      fromLocationId: movement.fromLocationId ?? undefined,
      toLocationId: movement.toLocationId ?? undefined,
      reason: input.reason,
      performedById: movement.performedById ?? undefined,
      createdAt: movement.createdAt,
    };
  }

  /** Reserve inventory for a booking/order. */
  async reserve(input: {
    inventoryId: string;
    quantity: number;
    reservedById: string;
    reference?: Record<string, unknown>;
    expiresAt: Date;
  }): Promise<{ reservationId: string }> {
    const inventory = await db.inventory.findUnique({ where: { id: input.inventoryId } });
    if (!inventory) throw new Error(`Inventory not found: ${input.inventoryId}`);
    if (inventory.quantity < input.quantity) throw new Error(`Insufficient stock for reservation`);

    const reservation = await db.inventoryReservation.create({
      data: {
        inventoryId: input.inventoryId,
        reservedById: input.reservedById,
        quantity: input.quantity,
        unit: inventory.unit,
        reference: JSON.stringify(input.reference ?? {}),
        status: "CONFIRMED",
        expiresAt: input.expiresAt,
      },
    });
    return { reservationId: reservation.id };
  }

  /** Release a reservation (return stock to available). */
  async releaseReservation(reservationId: string): Promise<void> {
    await db.inventoryReservation.update({ where: { id: reservationId }, data: { status: "RELEASED" } });
  }

  /** Record an inventory audit (count variance). */
  async audit(input: {
    inventoryId: string;
    actualQuantity: number;
    performedById: string;
    findings?: string[];
  }): Promise<{ variance: number }> {
    const inventory = await db.inventory.findUnique({ where: { id: input.inventoryId } });
    if (!inventory) throw new Error(`Inventory not found: ${input.inventoryId}`);
    const variance = input.actualQuantity - inventory.quantity;
    await db.inventoryAudit.create({
      data: {
        inventoryId: input.inventoryId,
        expectedQuantity: inventory.quantity,
        actualQuantity: input.actualQuantity,
        unit: inventory.unit,
        variance,
        findings: JSON.stringify(input.findings ?? []),
        performedById: input.performedById,
      },
    });
    // Adjust the inventory to the actual count.
    await db.inventory.update({ where: { id: input.inventoryId }, data: { quantity: input.actualQuantity } });
    return { variance };
  }

  /** Get movement history for an inventory item. */
  async movementHistory(inventoryId: string, limit = 50): Promise<readonly unknown[]> {
    return db.inventoryMovement.findMany({ where: { inventoryId }, orderBy: { createdAt: "desc" }, take: limit });
  }

  /** Get waste records for an organization. */
  async wasteRecords(organizationId: string, limit = 50): Promise<readonly unknown[]> {
    return db.wasteRecord.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: limit });
  }
}

export { uuid };
