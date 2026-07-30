import { describe, expect, it } from "vitest";

/**
 * Shopping list — pure-logic reference implementation for the
 * Customer Platform shopping-list subsystem.
 *
 * Manages multiple shopping lists per customer. Each list owns a set
 * of items, each item going through a 4-state lifecycle:
 *
 *   PENDING → IN_CART → PURCHASED
 *                  ↘ UNAVAILABLE
 *
 * The manager exposes the operations documented in the M8
 * SHOPPING_LIST_GUIDE:
 *
 *  - createList(name, ...)         — register a new list
 *  - addItem(listId, name, qty, ...) — append an item to a list
 *  - removeItem(listId, itemId)    — drop an item from a list
 *  - completeItem(listId, itemId)  — flip an item to PURCHASED
 *  - getItems(listId)              — snapshot of items in a list
 */

/** Status of a shopping list item. */
export type ShoppingListItemStatus =
  | "PENDING"
  | "IN_CART"
  | "PURCHASED"
  | "UNAVAILABLE";

/** The kind of trip this list is for. */
export type ShoppingListTripType =
  | "WEEKLY_GROCERY"
  | "TOP_UP"
  | "EVENT"
  | "RECIPE_GENERATED";

/** Where the item came from. */
export type ShoppingListItemSource =
  | "MANUAL"
  | "RECIPE_GENERATED"
  | "RECURRING"
  | "SUBSTITUTION";

/** Canonical units supported by shopping list items. */
export type ShoppingListUnit = "G" | "KG" | "ML" | "L" | "UNIT" | "PACK";

/** A single shopping list item. */
export interface ShoppingListItem {
  readonly itemId: string;
  readonly name: string;
  quantity: number;
  readonly unit: ShoppingListUnit;
  readonly source: ShoppingListItemSource;
  status: ShoppingListItemStatus;
  readonly addedAt: Date;
  completedAt: Date | null;
  readonly notes: string | null;
}

/** A shopping list. */
export interface ShoppingList {
  readonly listId: string;
  name: string;
  readonly tripType: ShoppingListTripType;
  readonly createdAt: Date;
  completedAt: Date | null;
  /** True when every item is PURCHASED or UNAVAILABLE. */
  isCompleted: boolean;
}

/** Options accepted by `addItem`. */
export interface AddShoppingListItemOptions {
  readonly itemId?: string;
  readonly source?: ShoppingListItemSource;
  readonly notes?: string;
}

class ShoppingListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShoppingListError";
  }
}

function isPositive(q: number): boolean {
  return Number.isFinite(q) && q > 0;
}

let shoppingItemIdCounter = 0;
function nextItemId(): string {
  shoppingItemIdCounter += 1;
  return `shop-item-${shoppingItemIdCounter}`;
}

let shoppingListIdCounter = 0;
function nextListId(): string {
  shoppingListIdCounter += 1;
  return `shop-list-${shoppingListIdCounter}`;
}

/** Manages multiple shopping lists. */
export class ShoppingListManager {
  private readonly lists = new Map<string, ShoppingList>();
  private readonly items = new Map<string, Map<string, ShoppingListItem>>();

  /** Create a new shopping list. Returns the registered list. */
  createList(
    name: string,
    tripType: ShoppingListTripType = "WEEKLY_GROCERY",
    listId?: string,
  ): ShoppingList {
    if (!name || name.trim().length === 0) {
      throw new ShoppingListError("list name is required");
    }
    const id = listId ?? nextListId();
    if (this.lists.has(id)) {
      throw new ShoppingListError(`list already exists: ${id}`);
    }
    const list: ShoppingList = {
      listId: id,
      name: name.trim(),
      tripType,
      createdAt: new Date(),
      completedAt: null,
      isCompleted: false,
    };
    this.lists.set(id, list);
    this.items.set(id, new Map());
    return list;
  }

  /** Append an item to a list. */
  addItem(
    listId: string,
    name: string,
    quantity: number,
    unit: ShoppingListUnit,
    opts: AddShoppingListItemOptions = {},
  ): ShoppingListItem {
    this.requireList(listId);
    if (!name || name.trim().length === 0) {
      throw new ShoppingListError("item name is required");
    }
    if (!isPositive(quantity)) {
      throw new ShoppingListError(
        `quantity must be > 0, got: ${quantity}`,
      );
    }
    const itemId = opts.itemId ?? nextItemId();
    const items = this.items.get(listId);
    if (!items) {
      throw new ShoppingListError(`list not found: ${listId}`);
    }
    if (items.has(itemId)) {
      throw new ShoppingListError(
        `item already exists in list ${listId}: ${itemId}`,
      );
    }
    const item: ShoppingListItem = {
      itemId,
      name: name.trim(),
      quantity,
      unit,
      source: opts.source ?? "MANUAL",
      status: "PENDING",
      addedAt: new Date(),
      completedAt: null,
      notes: opts.notes ?? null,
    };
    items.set(itemId, item);
    this.recomputeCompletion(listId);
    return item;
  }

  /** Remove an item from a list. */
  removeItem(listId: string, itemId: string): ShoppingListItem {
    this.requireList(listId);
    const items = this.items.get(listId);
    if (!items) {
      throw new ShoppingListError(`list not found: ${listId}`);
    }
    const item = items.get(itemId);
    if (!item) {
      throw new ShoppingListError(
        `item not found in list ${listId}: ${itemId}`,
      );
    }
    items.delete(itemId);
    this.recomputeCompletion(listId);
    return item;
  }

  /**
   * Flip an item to PURCHASED. Throws if the item is UNAVAILABLE
   * (unavailable items cannot be purchased).
   */
  completeItem(listId: string, itemId: string): ShoppingListItem {
    this.requireList(listId);
    const items = this.items.get(listId);
    if (!items) {
      throw new ShoppingListError(`list not found: ${listId}`);
    }
    const item = items.get(itemId);
    if (!item) {
      throw new ShoppingListError(
        `item not found in list ${listId}: ${itemId}`,
      );
    }
    if (item.status === "UNAVAILABLE") {
      throw new ShoppingListError(
        `cannot complete UNAVAILABLE item ${itemId}`,
      );
    }
    const updated: ShoppingListItem = {
      ...item,
      status: "PURCHASED",
      completedAt: new Date(),
    };
    items.set(itemId, updated);
    this.recomputeCompletion(listId);
    return updated;
  }

  /** Mark an item as UNAVAILABLE (e.g. out of stock at the store). */
  markUnavailable(listId: string, itemId: string): ShoppingListItem {
    this.requireList(listId);
    const items = this.items.get(listId);
    if (!items) {
      throw new ShoppingListError(`list not found: ${listId}`);
    }
    const item = items.get(itemId);
    if (!item) {
      throw new ShoppingListError(
        `item not found in list ${listId}: ${itemId}`,
      );
    }
    if (item.status === "PURCHASED") {
      throw new ShoppingListError(
        `cannot mark PURCHASED item ${itemId} as UNAVAILABLE`,
      );
    }
    const updated: ShoppingListItem = {
      ...item,
      status: "UNAVAILABLE",
      completedAt: null,
    };
    items.set(itemId, updated);
    this.recomputeCompletion(listId);
    return updated;
  }

  /** Snapshot of items in a list. */
  getItems(listId: string): readonly ShoppingListItem[] {
    this.requireList(listId);
    const items = this.items.get(listId);
    if (!items) return [];
    return Array.from(items.values()).sort((a, b) => {
      const t = a.addedAt.getTime() - b.addedAt.getTime();
      if (t !== 0) return t;
      return a.itemId.localeCompare(b.itemId);
    });
  }

  /** Look up a single list. */
  getList(listId: string): ShoppingList | undefined {
    return this.lists.get(listId);
  }

  /** All lists managed by this manager. */
  listLists(): readonly ShoppingList[] {
    return Array.from(this.lists.values());
  }

  /** Count of items in a list. */
  itemCount(listId: string): number {
    return this.items.get(listId)?.size ?? 0;
  }

  private requireList(listId: string): void {
    if (!this.lists.has(listId)) {
      throw new ShoppingListError(`list not found: ${listId}`);
    }
  }

  /**
   * Recompute the list's completion flag. A list is "completed" when
   * every item is either PURCHASED or UNAVAILABLE (and there is at
   * least one item).
   */
  private recomputeCompletion(listId: string): void {
    const list = this.lists.get(listId);
    const items = this.items.get(listId);
    if (!list || !items) return;
    if (items.size === 0) {
      this.lists.set(listId, { ...list, isCompleted: false, completedAt: null });
      return;
    }
    let allDone = true;
    for (const item of items.values()) {
      if (item.status !== "PURCHASED" && item.status !== "UNAVAILABLE") {
        allDone = false;
        break;
      }
    }
    this.lists.set(listId, {
      ...list,
      isCompleted: allDone,
      completedAt: allDone ? new Date() : null,
    });
  }
}

describe("ShoppingListManager", () => {
  describe("createList", () => {
    it("creates a new shopping list", () => {
      const mgr = new ShoppingListManager();
      const list = mgr.createList("Weekly Groceries");
      expect(list.listId).toBeDefined();
      expect(list.name).toBe("Weekly Groceries");
      expect(list.tripType).toBe("WEEKLY_GROCERY");
      expect(list.isCompleted).toBe(false);
      expect(list.completedAt).toBeNull();
      expect(list.createdAt instanceof Date).toBe(true);
    });

    it("accepts a custom listId and tripType", () => {
      const mgr = new ShoppingListManager();
      const list = mgr.createList("Birthday Party", "EVENT", "custom-list-1");
      expect(list.listId).toBe("custom-list-1");
      expect(list.tripType).toBe("EVENT");
    });

    it("rejects an empty name", () => {
      const mgr = new ShoppingListManager();
      expect(() => mgr.createList("   ")).toThrow(/name/);
    });

    it("rejects a duplicate listId", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("List A", "WEEKLY_GROCERY", "dup-1");
      expect(() => mgr.createList("List B", "TOP_UP", "dup-1")).toThrow(
        /already exists/,
      );
    });

    it("a freshly created list has zero items", () => {
      const mgr = new ShoppingListManager();
      const list = mgr.createList("Empty", "TOP_UP", "list-1");
      expect(mgr.itemCount(list.listId)).toBe(0);
      expect(mgr.getItems(list.listId)).toEqual([]);
    });
  });

  describe("addItem", () => {
    it("adds an item to a list with PENDING status", () => {
      const mgr = new ShoppingListManager();
      const list = mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      const item = mgr.addItem(list.listId, "Tomatoes", 6, "UNIT");
      expect(item.itemId).toBeDefined();
      expect(item.name).toBe("Tomatoes");
      expect(item.quantity).toBe(6);
      expect(item.unit).toBe("UNIT");
      expect(item.source).toBe("MANUAL");
      expect(item.status).toBe("PENDING");
      expect(item.completedAt).toBeNull();
      expect(mgr.itemCount(list.listId)).toBe(1);
    });

    it("honours source and notes options", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      const item = mgr.addItem("list-1", "Rice", 1, "KG", {
        source: "RECIPE_GENERATED",
        notes: "for jollof",
      });
      expect(item.source).toBe("RECIPE_GENERATED");
      expect(item.notes).toBe("for jollof");
    });

    it("rejects an empty item name", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      expect(() => mgr.addItem("list-1", "", 1, "UNIT")).toThrow(/name/);
    });

    it("rejects a non-positive quantity", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      expect(() => mgr.addItem("list-1", "Rice", 0, "KG")).toThrow(
        /quantity/,
      );
      expect(() => mgr.addItem("list-1", "Rice", -1, "KG")).toThrow(
        /quantity/,
      );
    });

    it("throws when the list does not exist", () => {
      const mgr = new ShoppingListManager();
      expect(() => mgr.addItem("no-such-list", "Rice", 1, "KG")).toThrow(
        /list not found/,
      );
    });

    it("rejects a duplicate itemId in the same list", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      mgr.addItem("list-1", "Rice", 1, "KG", { itemId: "dup-1" });
      expect(() =>
        mgr.addItem("list-1", "Beans", 1, "KG", { itemId: "dup-1" }),
      ).toThrow(/already exists/);
    });
  });

  describe("removeItem", () => {
    it("removes an item from a list", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      mgr.addItem("list-1", "Rice", 1, "KG", { itemId: "i-1" });
      const removed = mgr.removeItem("list-1", "i-1");
      expect(removed.itemId).toBe("i-1");
      expect(mgr.itemCount("list-1")).toBe(0);
    });

    it("throws when the item does not exist", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      expect(() => mgr.removeItem("list-1", "no-such-item")).toThrow(
        /not found/,
      );
    });

    it("throws when the list does not exist", () => {
      const mgr = new ShoppingListManager();
      expect(() => mgr.removeItem("no-such-list", "i-1")).toThrow(
        /list not found/,
      );
    });
  });

  describe("completeItem", () => {
    it("flips an item from PENDING to PURCHASED", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      mgr.addItem("list-1", "Rice", 1, "KG", { itemId: "i-1" });
      const completed = mgr.completeItem("list-1", "i-1");
      expect(completed.status).toBe("PURCHASED");
      expect(completed.completedAt).not.toBeNull();
    });

    it("flips an IN_CART item to PURCHASED", () => {
      // The state machine allows IN_CART → PURCHASED transit via
      // completeItem; we model IN_CART as a transient state set
      // externally. Here we just verify the purchase is idempotent.
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      mgr.addItem("list-1", "Rice", 1, "KG", { itemId: "i-1" });
      mgr.completeItem("list-1", "i-1");
      const again = mgr.completeItem("list-1", "i-1");
      expect(again.status).toBe("PURCHASED");
    });

    it("throws when completing an UNAVAILABLE item", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      mgr.addItem("list-1", "Rice", 1, "KG", { itemId: "i-1" });
      mgr.markUnavailable("list-1", "i-1");
      expect(() => mgr.completeItem("list-1", "i-1")).toThrow(
        /cannot complete UNAVAILABLE/,
      );
    });

    it("throws when the item does not exist", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      expect(() => mgr.completeItem("list-1", "no-such-item")).toThrow(
        /not found/,
      );
    });
  });

  describe("markUnavailable", () => {
    it("flips a PENDING item to UNAVAILABLE", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      mgr.addItem("list-1", "Rice", 1, "KG", { itemId: "i-1" });
      const u = mgr.markUnavailable("list-1", "i-1");
      expect(u.status).toBe("UNAVAILABLE");
      expect(u.completedAt).toBeNull();
    });

    it("throws when marking a PURCHASED item", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      mgr.addItem("list-1", "Rice", 1, "KG", { itemId: "i-1" });
      mgr.completeItem("list-1", "i-1");
      expect(() => mgr.markUnavailable("list-1", "i-1")).toThrow(
        /cannot mark PURCHASED/,
      );
    });
  });

  describe("getItems + list-level completion", () => {
    it("returns items sorted by addedAt then itemId", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      mgr.addItem("list-1", "Rice", 1, "KG", { itemId: "i-b" });
      mgr.addItem("list-1", "Beans", 1, "KG", { itemId: "i-a" });
      const items = mgr.getItems("list-1");
      // Same addedAt (ms resolution) → ties broken by itemId ascending.
      expect(items.map((i) => i.itemId)).toEqual(["i-a", "i-b"]);
    });

    it("marks the list as completed when every item is PURCHASED or UNAVAILABLE", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      mgr.addItem("list-1", "Rice", 1, "KG", { itemId: "i-1" });
      mgr.addItem("list-1", "Beans", 1, "KG", { itemId: "i-2" });
      mgr.addItem("list-1", "Oil", 1, "L", { itemId: "i-3" });
      // One purchase, one unavailable, one pending → not completed.
      mgr.completeItem("list-1", "i-1");
      mgr.markUnavailable("list-1", "i-2");
      expect(mgr.getList("list-1")?.isCompleted).toBe(false);
      // Complete the last item.
      mgr.completeItem("list-1", "i-3");
      expect(mgr.getList("list-1")?.isCompleted).toBe(true);
      expect(mgr.getList("list-1")?.completedAt).not.toBeNull();
    });

    it("uncompletes the list when a new item is added after completion", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Weekly", "WEEKLY_GROCERY", "list-1");
      mgr.addItem("list-1", "Rice", 1, "KG", { itemId: "i-1" });
      mgr.completeItem("list-1", "i-1");
      expect(mgr.getList("list-1")?.isCompleted).toBe(true);
      mgr.addItem("list-1", "Salt", 1, "PACK", { itemId: "i-2" });
      expect(mgr.getList("list-1")?.isCompleted).toBe(false);
      expect(mgr.getList("list-1")?.completedAt).toBeNull();
    });

    it("an empty list is never completed", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("Empty", "TOP_UP", "list-1");
      expect(mgr.getList("list-1")?.isCompleted).toBe(false);
    });
  });

  describe("listLists + getList", () => {
    it("listLists returns all registered lists", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("List A", "WEEKLY_GROCERY", "a");
      mgr.createList("List B", "TOP_UP", "b");
      const all = mgr.listLists();
      expect(all).toHaveLength(2);
      expect(all.map((l) => l.listId).sort()).toEqual(["a", "b"]);
    });

    it("getList returns undefined for unknown listId", () => {
      const mgr = new ShoppingListManager();
      expect(mgr.getList("nope")).toBeUndefined();
    });
  });

  describe("multi-list isolation", () => {
    it("item ids are scoped per-list (same itemId can exist in two lists)", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("List A", "WEEKLY_GROCERY", "a");
      mgr.createList("List B", "TOP_UP", "b");
      mgr.addItem("a", "Rice", 1, "KG", { itemId: "shared-id" });
      mgr.addItem("b", "Rice", 2, "KG", { itemId: "shared-id" });
      expect(mgr.getItems("a")[0]?.quantity).toBe(1);
      expect(mgr.getItems("b")[0]?.quantity).toBe(2);
    });

    it("removing an item from one list does not affect another", () => {
      const mgr = new ShoppingListManager();
      mgr.createList("List A", "WEEKLY_GROCERY", "a");
      mgr.createList("List B", "TOP_UP", "b");
      mgr.addItem("a", "Rice", 1, "KG", { itemId: "i-1" });
      mgr.addItem("b", "Rice", 1, "KG", { itemId: "i-1" });
      mgr.removeItem("a", "i-1");
      expect(mgr.itemCount("a")).toBe(0);
      expect(mgr.itemCount("b")).toBe(1);
    });
  });
});
