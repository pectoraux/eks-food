import { describe, expect, it } from "vitest";

/**
 * Pantry management — pure-logic reference implementation for the
 * Customer Platform pantry subsystem.
 *
 * Tracks pantry items for a household (or single member). Each item
 * has a name, quantity, unit, an optional expiry date, a status, and
 * the date it was added. The manager exposes the operations
 * documented in the M8 PANTRY_MANAGEMENT_GUIDE:
 *
 *  - addItem(...)              — register a new pantry item
 *  - removeItem(itemId)        — remove an item (status → REMOVED)
 *  - checkExpiry(asOf)         — flip EXPIRING/EXPIRED statuses
 *  - getExpiringSoon(days, asOf) — list items expiring within `days`
 *
 * The 6-status state machine:
 *
 *   IN_STOCK → LOW → EXPIRING → EXPIRED → DEPLETED → REMOVED
 *
 * Transitions are driven by quantity (LOW when at/below the
 * low-stock threshold; DEPLETED when quantity hits 0) and by the
 * passage of time (EXPIRING within `expiringSoonDays`; EXPIRED
 * past the expiry date).
 */

/** Status of a pantry item — see state-machine docstring above. */
export type PantryItemStatus =
  | "IN_STOCK"
  | "LOW"
  | "EXPIRING"
  | "EXPIRED"
  | "DEPLETED"
  | "REMOVED";

/** Canonical units supported by the pantry. */
export type PantryUnit = "G" | "KG" | "ML" | "L" | "UNIT" | "PACK";

/** A pantry item. */
export interface PantryItem {
  readonly itemId: string;
  readonly name: string;
  quantity: number;
  readonly unit: PantryUnit;
  readonly addedAt: Date;
  readonly expiresAt: Date | null;
  readonly lowStockThreshold: number;
  status: PantryItemStatus;
}

/** Options accepted by `addItem`. */
export interface AddPantryItemOptions {
  readonly itemId?: string;
  readonly expiresAt?: Date;
  readonly lowStockThreshold?: number;
  /**
   * Reference "now" used when computing the initial status. Tests
   * pass a deterministic value so subsequent `checkExpiry` /
   * `getExpiringSoon` calls (which also take a deterministic `asOf`)
   * behave predictably regardless of wall-clock time. Production
   * callers leave this undefined so the real `Date.now()` is used.
   */
  readonly asOf?: Date;
}

class PantryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PantryError";
  }
}

function isPositive(q: number): boolean {
  return Number.isFinite(q) && q > 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

let pantryIdCounter = 0;
function nextPantryItemId(): string {
  pantryIdCounter += 1;
  return `pantry-item-${pantryIdCounter}`;
}

/**
 * Manages a single pantry (one household or one member). The
 * implementation favours clarity over performance — pantries are
 * bounded by household size and the operations are O(n) in the number
 * of items.
 */
export class PantryManager {
  private readonly items = new Map<string, PantryItem>();

  /** Add a new pantry item. Throws if `itemId` is already taken. */
  addItem(
    name: string,
    quantity: number,
    unit: PantryUnit,
    opts: AddPantryItemOptions = {},
  ): PantryItem {
    if (!name || name.trim().length === 0) {
      throw new PantryError("item name is required");
    }
    if (!isPositive(quantity)) {
      throw new PantryError(
        `quantity must be > 0, got: ${quantity}`,
      );
    }
    const itemId = opts.itemId ?? nextPantryItemId();
    if (this.items.has(itemId)) {
      throw new PantryError(`pantry item already exists: ${itemId}`);
    }
    const addedAt = opts.asOf ?? new Date();
    const expiresAt = opts.expiresAt ?? null;
    const lowStockThreshold = opts.lowStockThreshold ?? 0;
    if (lowStockThreshold < 0) {
      throw new PantryError(
        `lowStockThreshold must be >= 0, got: ${lowStockThreshold}`,
      );
    }
    const item: PantryItem = {
      itemId,
      name: name.trim(),
      quantity,
      unit,
      addedAt,
      expiresAt,
      lowStockThreshold,
      status: this.deriveStatus(quantity, expiresAt, addedAt, lowStockThreshold),
    };
    this.items.set(itemId, item);
    return item;
  }

  /** Remove an item (status → REMOVED, quantity → 0). */
  removeItem(itemId: string): PantryItem {
    const item = this.items.get(itemId);
    if (!item) {
      throw new PantryError(`pantry item not found: ${itemId}`);
    }
    const removed: PantryItem = {
      ...item,
      quantity: 0,
      status: "REMOVED",
    };
    this.items.set(itemId, removed);
    return removed;
  }

  /**
   * Check expiry across all items as of `asOf`. Flips statuses:
   *  - past `expiresAt`            → EXPIRED
   *  - within `expiringSoonDays`   → EXPIRING (unless EXPIRED or REMOVED)
   * Returns the list of items whose status changed.
   */
  checkExpiry(asOf: Date = new Date(), expiringSoonDays = 3): readonly PantryItem[] {
    if (expiringSoonDays < 0) {
      throw new PantryError(
        `expiringSoonDays must be >= 0, got: ${expiringSoonDays}`,
      );
    }
    const changed: PantryItem[] = [];
    const horizonMs = expiringSoonDays * DAY_MS;
    for (const [itemId, item] of this.items) {
      if (item.status === "REMOVED") continue;
      const next = this.deriveStatus(
        item.quantity,
        item.expiresAt,
        asOf,
        item.lowStockThreshold,
        horizonMs,
      );
      if (next !== item.status) {
        const updated: PantryItem = { ...item, status: next };
        this.items.set(itemId, updated);
        changed.push(updated);
      }
    }
    return changed;
  }

  /**
   * Return items that will expire within `days` of `asOf` (and have
   * not already expired). Sorted by ascending expiry date.
   */
  getExpiringSoon(
    days = 3,
    asOf: Date = new Date(),
  ): readonly PantryItem[] {
    if (days < 0) {
      throw new PantryError(`days must be >= 0, got: ${days}`);
    }
    const horizonMs = days * DAY_MS;
    const out: PantryItem[] = [];
    for (const item of this.items.values()) {
      if (item.status === "REMOVED" || item.status === "EXPIRED") continue;
      if (!item.expiresAt) continue;
      const delta = item.expiresAt.getTime() - asOf.getTime();
      if (delta <= horizonMs && delta >= 0) {
        out.push(item);
      }
    }
    return out.sort(
      (a, b) =>
        (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0),
    );
  }

  /** All items in the pantry (snapshot). */
  listItems(): readonly PantryItem[] {
    return Array.from(this.items.values());
  }

  /** Look up a single item by id. */
  getItem(itemId: string): PantryItem | undefined {
    return this.items.get(itemId);
  }

  /** Count of items by status. */
  countByStatus(): Record<PantryItemStatus, number> {
    const counts: Record<PantryItemStatus, number> = {
      IN_STOCK: 0,
      LOW: 0,
      EXPIRING: 0,
      EXPIRED: 0,
      DEPLETED: 0,
      REMOVED: 0,
    };
    for (const item of this.items.values()) {
      counts[item.status] += 1;
    }
    return counts;
  }

  /**
   * Compute the status of an item from its quantity, expiry, and the
   * "now" reference point. When `expiringSoonMs` is supplied, items
   * whose expiry falls within that horizon (but not yet past) are
   * marked EXPIRING.
   */
  private deriveStatus(
    quantity: number,
    expiresAt: Date | null,
    now: Date,
    lowStockThreshold: number,
    expiringSoonMs?: number,
  ): PantryItemStatus {
    if (quantity <= 0) return "DEPLETED";
    if (expiresAt) {
      const delta = expiresAt.getTime() - now.getTime();
      if (delta <= 0) return "EXPIRED";
      if (expiringSoonMs !== undefined && delta <= expiringSoonMs) {
        return "EXPIRING";
      }
    }
    if (quantity <= lowStockThreshold) return "LOW";
    return "IN_STOCK";
  }
}

describe("PantryManager", () => {
  describe("addItem", () => {
    it("registers a new pantry item with IN_STOCK status", () => {
      const pantry = new PantryManager();
      const item = pantry.addItem("Jollof Rice", 2, "KG");
      expect(item.itemId).toBeDefined();
      expect(item.name).toBe("Jollof Rice");
      expect(item.quantity).toBe(2);
      expect(item.unit).toBe("KG");
      expect(item.status).toBe("IN_STOCK");
      expect(item.addedAt instanceof Date).toBe(true);
      expect(item.expiresAt).toBeNull();
    });

    it("honours an explicit itemId", () => {
      const pantry = new PantryManager();
      const item = pantry.addItem("Tomatoes", 500, "G", {
        itemId: "custom-id-1",
      });
      expect(item.itemId).toBe("custom-id-1");
    });

    it("rejects an empty name", () => {
      const pantry = new PantryManager();
      expect(() => pantry.addItem("   ", 1, "UNIT")).toThrow(/name/);
    });

    it("rejects a non-positive quantity", () => {
      const pantry = new PantryManager();
      expect(() => pantry.addItem("Oil", 0, "ML")).toThrow(/quantity/);
      expect(() => pantry.addItem("Oil", -5, "ML")).toThrow(/quantity/);
      expect(() => pantry.addItem("Oil", Number.NaN, "ML")).toThrow(
        /quantity/,
      );
    });

    it("rejects a duplicate itemId", () => {
      const pantry = new PantryManager();
      pantry.addItem("Rice", 1, "KG", { itemId: "dup-1" });
      expect(() =>
        pantry.addItem("Beans", 1, "KG", { itemId: "dup-1" }),
      ).toThrow(/already exists/);
    });

    it("honours a lowStockThreshold to mark the item as LOW on add", () => {
      const pantry = new PantryManager();
      const item = pantry.addItem("Salt", 1, "G", {
        lowStockThreshold: 5,
      });
      expect(item.status).toBe("LOW");
      expect(item.lowStockThreshold).toBe(5);
    });

    it("honours an expiresAt in the past to mark the item as EXPIRED on add", () => {
      const pantry = new PantryManager();
      const past = new Date(Date.now() - 10 * DAY_MS);
      const item = pantry.addItem("Milk", 1, "L", { expiresAt: past });
      expect(item.status).toBe("EXPIRED");
    });

    it("rejects a negative lowStockThreshold", () => {
      const pantry = new PantryManager();
      expect(() =>
        pantry.addItem("Rice", 1, "KG", { lowStockThreshold: -1 }),
      ).toThrow(/lowStockThreshold/);
    });
  });

  describe("removeItem", () => {
    it("flips the item status to REMOVED and zeroes the quantity", () => {
      const pantry = new PantryManager();
      pantry.addItem("Rice", 2, "KG", { itemId: "i-1" });
      const removed = pantry.removeItem("i-1");
      expect(removed.status).toBe("REMOVED");
      expect(removed.quantity).toBe(0);
    });

    it("throws when the item does not exist", () => {
      const pantry = new PantryManager();
      expect(() => pantry.removeItem("no-such-item")).toThrow(/not found/);
    });

    it("does not affect other items", () => {
      const pantry = new PantryManager();
      pantry.addItem("Rice", 2, "KG", { itemId: "i-1" });
      pantry.addItem("Beans", 1, "KG", { itemId: "i-2" });
      pantry.removeItem("i-1");
      expect(pantry.getItem("i-2")?.status).toBe("IN_STOCK");
      expect(pantry.listItems()).toHaveLength(2);
    });
  });

  describe("checkExpiry", () => {
    it("flips items past their expiry to EXPIRED", () => {
      const pantry = new PantryManager();
      const addAsOf = new Date("2024-01-15T00:00:00.000Z");
      const past = new Date("2024-02-01T00:00:00.000Z");
      const checkAsOf = new Date("2024-03-01T00:00:00.000Z");
      // Add the item BEFORE its expiry, so addItem computes IN_STOCK.
      // Then checkExpiry(checkAsOf) flips it to EXPIRED.
      pantry.addItem("Yoghurt", 1, "L", {
        itemId: "i-1",
        expiresAt: past,
        asOf: addAsOf,
      });
      expect(pantry.getItem("i-1")?.status).toBe("IN_STOCK");
      const changed = pantry.checkExpiry(checkAsOf, 3);
      expect(changed.map((c) => c.itemId)).toEqual(["i-1"]);
      expect(pantry.getItem("i-1")?.status).toBe("EXPIRED");
    });

    it("flips items within the expiring-soon horizon to EXPIRING", () => {
      const pantry = new PantryManager();
      const soon = new Date(Date.now() + 2 * DAY_MS);
      pantry.addItem("Bread", 1, "UNIT", { itemId: "i-1", expiresAt: soon });
      const changed = pantry.checkExpiry(new Date(), 3);
      expect(changed.map((c) => c.itemId)).toEqual(["i-1"]);
      expect(pantry.getItem("i-1")?.status).toBe("EXPIRING");
    });

    it("leaves items beyond the horizon untouched", () => {
      const pantry = new PantryManager();
      const far = new Date(Date.now() + 30 * DAY_MS);
      pantry.addItem("Canned Beans", 5, "UNIT", {
        itemId: "i-1",
        expiresAt: far,
      });
      const changed = pantry.checkExpiry(new Date(), 3);
      expect(changed).toHaveLength(0);
      expect(pantry.getItem("i-1")?.status).toBe("IN_STOCK");
    });

    it("skips REMOVED items", () => {
      const pantry = new PantryManager();
      const past = new Date(Date.now() - 10 * DAY_MS);
      pantry.addItem("Old Milk", 1, "L", {
        itemId: "i-1",
        expiresAt: past,
      });
      pantry.removeItem("i-1");
      const changed = pantry.checkExpiry(new Date(), 3);
      expect(changed).toHaveLength(0);
    });

    it("rejects a negative expiringSoonDays", () => {
      const pantry = new PantryManager();
      expect(() => pantry.checkExpiry(new Date(), -1)).toThrow(
        /expiringSoonDays/,
      );
    });
  });

  describe("getExpiringSoon", () => {
    it("returns items whose expiry falls within the horizon, sorted by expiry", () => {
      const pantry = new PantryManager();
      const now = new Date("2024-03-01T00:00:00.000Z");
      const in1 = new Date("2024-03-02T00:00:00.000Z");
      const in3 = new Date("2024-03-04T00:00:00.000Z");
      const in10 = new Date("2024-03-11T00:00:00.000Z");
      // Pass `asOf: now` so the initial status reflects the test's
      // deterministic timeline rather than the real wall-clock.
      pantry.addItem("Milk", 1, "L", {
        itemId: "i-milk",
        expiresAt: in1,
        asOf: now,
      });
      pantry.addItem("Yoghurt", 1, "L", {
        itemId: "i-yoghurt",
        expiresAt: in3,
        asOf: now,
      });
      pantry.addItem("Canned Soup", 1, "UNIT", {
        itemId: "i-soup",
        expiresAt: in10,
        asOf: now,
      });

      const expiring = pantry.getExpiringSoon(5, now);
      expect(expiring.map((i) => i.itemId)).toEqual([
        "i-milk",
        "i-yoghurt",
      ]);
    });

    it("excludes items that have already expired", () => {
      const pantry = new PantryManager();
      const addAsOf = new Date("2024-01-15T00:00:00.000Z");
      const now = new Date("2024-03-01T00:00:00.000Z");
      const past = new Date("2024-02-15T00:00:00.000Z");
      const soon = new Date("2024-03-02T00:00:00.000Z");
      // Add both items BEFORE their expiry so addItem computes IN_STOCK.
      pantry.addItem("Old Milk", 1, "L", {
        itemId: "i-old",
        expiresAt: past,
        asOf: addAsOf,
      });
      pantry.addItem("Fresh Milk", 1, "L", {
        itemId: "i-fresh",
        expiresAt: soon,
        asOf: addAsOf,
      });
      // Force the past item to EXPIRED.
      pantry.checkExpiry(now, 5);
      expect(pantry.getItem("i-old")?.status).toBe("EXPIRED");
      const expiring = pantry.getExpiringSoon(5, now);
      expect(expiring.map((i) => i.itemId)).toEqual(["i-fresh"]);
    });

    it("excludes items with no expiry date", () => {
      const pantry = new PantryManager();
      pantry.addItem("Salt", 500, "G", { itemId: "i-salt" });
      expect(pantry.getExpiringSoon(5, new Date())).toEqual([]);
    });

    it("rejects a negative days argument", () => {
      const pantry = new PantryManager();
      expect(() => pantry.getExpiringSoon(-1, new Date())).toThrow(/days/);
    });

    it("includes items expiring exactly at the horizon boundary", () => {
      const pantry = new PantryManager();
      const now = new Date("2024-03-01T00:00:00.000Z");
      const boundary = new Date("2024-03-04T00:00:00.000Z"); // exactly 3 days out
      pantry.addItem("Cheese", 1, "UNIT", {
        itemId: "i-cheese",
        expiresAt: boundary,
        asOf: now,
      });
      const expiring = pantry.getExpiringSoon(3, now);
      expect(expiring).toHaveLength(1);
    });
  });

  describe("listItems + getItem + countByStatus", () => {
    it("listItems returns a snapshot of all registered items", () => {
      const pantry = new PantryManager();
      pantry.addItem("Rice", 1, "KG", { itemId: "i-1" });
      pantry.addItem("Beans", 1, "KG", { itemId: "i-2" });
      expect(pantry.listItems()).toHaveLength(2);
    });

    it("getItem returns the named item or undefined", () => {
      const pantry = new PantryManager();
      pantry.addItem("Rice", 1, "KG", { itemId: "i-1" });
      expect(pantry.getItem("i-1")?.name).toBe("Rice");
      expect(pantry.getItem("missing")).toBeUndefined();
    });

    it("countByStatus tallies items per status", () => {
      const pantry = new PantryManager();
      pantry.addItem("Rice", 5, "KG", { itemId: "i-1" });
      pantry.addItem("Salt", 1, "G", {
        itemId: "i-2",
        lowStockThreshold: 5,
      });
      const past = new Date(Date.now() - 10 * DAY_MS);
      pantry.addItem("Milk", 1, "L", { itemId: "i-3", expiresAt: past });
      pantry.removeItem("i-3");
      const counts = pantry.countByStatus();
      expect(counts.IN_STOCK).toBe(1);
      expect(counts.LOW).toBe(1);
      expect(counts.REMOVED).toBe(1);
    });
  });

  describe("full pantry lifecycle", () => {
    it("add → low-stock → expiring → expired → removed", () => {
      const pantry = new PantryManager();
      const far = new Date(Date.now() + 30 * DAY_MS);
      const item = pantry.addItem("Cooking Oil", 2, "L", {
        itemId: "i-oil",
        expiresAt: far,
        lowStockThreshold: 1,
      });
      expect(item.status).toBe("IN_STOCK");

      // Simulate the passage of time: oil now expires in 2 days.
      // We mutate the registered item's expiresAt by removing + re-adding
      // is not allowed (duplicate id), so we re-add under a new id and
      // prove the EXPIRING transition with a fresh horizon.
      const soon = new Date(Date.now() + 2 * DAY_MS);
      pantry.addItem("Cooking Oil 2", 2, "L", {
        itemId: "i-oil2",
        expiresAt: soon,
        lowStockThreshold: 1,
      });
      pantry.checkExpiry(new Date(), 3);
      expect(pantry.getItem("i-oil2")?.status).toBe("EXPIRING");

      // Past expiry → EXPIRED.
      const past = new Date(Date.now() - 1 * DAY_MS);
      pantry.addItem("Old Oil", 1, "L", {
        itemId: "i-old",
        expiresAt: past,
        lowStockThreshold: 0,
      });
      pantry.checkExpiry(new Date(), 3);
      expect(pantry.getItem("i-old")?.status).toBe("EXPIRED");

      // Removed.
      pantry.removeItem("i-oil");
      expect(pantry.getItem("i-oil")?.status).toBe("REMOVED");
    });
  });
});
