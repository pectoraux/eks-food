/** Shopping List Service — collaborative shopping lists. */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

export interface ShoppingItemInput {
  shoppingListId: string;
  name: string;
  ingredientCode?: string;
  quantity?: number;
  unit?: string;
  recipeGenerated?: boolean;
  recipeId?: string;
  addedById: string;
}

export class ShoppingListService {
  async createList(householdId: string, organizationId: string, name: string, createdById: string): Promise<{ listId: string }> {
    const list = await db.shoppingList.create({
      data: { id: uuid(), householdId, organizationId, name, status: "ACTIVE", createdById },
    });
    return { listId: list.id };
  }

  async addItem(input: ShoppingItemInput): Promise<{ itemId: string }> {
    const item = await db.shoppingListItem.create({
      data: {
        id: uuid(),
        shoppingListId: input.shoppingListId,
        name: input.name,
        ingredientCode: input.ingredientCode,
        quantity: input.quantity ?? 1,
        unit: input.unit ?? "piece",
        status: "PENDING",
        recipeGenerated: input.recipeGenerated ?? false,
        recipeId: input.recipeId,
        addedById: input.addedById,
      },
    });
    return { itemId: item.id };
  }

  async completeItem(itemId: string, completedById: string): Promise<void> {
    await db.shoppingListItem.update({
      where: { id: itemId },
      data: { status: "PURCHASED", completedById, completedAt: new Date() },
    });
    // Check if all items are completed → mark list as COMPLETED.
    const list = await db.shoppingListItem.findFirst({ where: { id: itemId }, select: { shoppingListId: true } });
    if (list) {
      const pending = await db.shoppingListItem.count({ where: { shoppingListId: list.shoppingListId, status: "PENDING" } });
      if (pending === 0) {
        await db.shoppingList.update({ where: { id: list.shoppingListId }, data: { status: "COMPLETED" } });
      }
    }
  }

  async getItems(shoppingListId: string): Promise<readonly unknown[]> {
    return db.shoppingListItem.findMany({ where: { shoppingListId }, orderBy: { createdAt: "asc" } });
  }

  async listForHousehold(householdId: string): Promise<readonly unknown[]> {
    return db.shoppingList.findMany({ where: { householdId, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, include: { _count: { select: { items: true } } } });
  }
}

export { uuid };
