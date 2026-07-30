/** Pantry Service — household pantry management. */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

export interface PantryItemInput {
  pantryId: string;
  name: string;
  ingredientCode?: string;
  quantity?: number;
  unit?: string;
  expirationDate?: Date;
  preferredBrand?: string;
  addedById: string;
}

export class PantryService {
  async ensurePantry(householdId: string, organizationId: string): Promise<string> {
    const existing = await db.pantry.findUnique({ where: { householdId } });
    if (existing) return existing.id;
    const pantry = await db.pantry.create({ data: { id: uuid(), householdId, organizationId } });
    return pantry.id;
  }

  async addItem(input: PantryItemInput): Promise<{ itemId: string }> {
    const item = await db.pantryItem.create({
      data: {
        id: uuid(),
        pantryId: input.pantryId,
        name: input.name,
        ingredientCode: input.ingredientCode,
        quantity: input.quantity ?? 1,
        unit: input.unit ?? "g",
        expirationDate: input.expirationDate,
        preferredBrand: input.preferredBrand,
        status: "IN_STOCK",
        addedById: input.addedById,
      },
    });
    return { itemId: item.id };
  }

  async removeItem(itemId: string): Promise<void> {
    await db.pantryItem.update({ where: { id: itemId }, data: { status: "REMOVED" } });
  }

  async consume(itemId: string, quantity: number): Promise<void> {
    const item = await db.pantryItem.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("Pantry item not found");
    const newQty = Math.max(0, item.quantity - quantity);
    await db.pantryItem.update({
      where: { id: itemId },
      data: { quantity: newQty, status: newQty === 0 ? "DEPLETED" : newQty < item.quantity * 0.2 ? "LOW" : "IN_STOCK" },
    });
  }

  async checkExpirations(): Promise<readonly { id: string; name: string; expirationDate: Date }[]> {
    const now = new Date();
    const expired = await db.pantryItem.findMany({
      where: { expirationDate: { lt: now }, status: { not: "EXPIRED" } },
      select: { id: true, name: true, expirationDate: true },
    });
    await db.pantryItem.updateMany({
      where: { expirationDate: { lt: now }, status: { not: "EXPIRED" } },
      data: { status: "EXPIRED" },
    });
    return expired as readonly { id: string; name: string; expirationDate: Date }[];
  }

  async getExpiringSoon(pantryId: string, days = 3): Promise<readonly unknown[]> {
    const cutoff = new Date(Date.now() + days * 86400000);
    return db.pantryItem.findMany({
      where: { pantryId, expirationDate: { lt: cutoff, gt: new Date() }, status: "IN_STOCK" },
      orderBy: { expirationDate: "asc" },
    });
  }

  async listItems(pantryId: string): Promise<readonly unknown[]> {
    return db.pantryItem.findMany({ where: { pantryId, status: { not: "REMOVED" } }, orderBy: { name: "asc" } });
  }
}

export { uuid };
