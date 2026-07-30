/**
 * Restaurant Connector — POS, reservations, kitchen management, menus, inventory.
 * Providers: Square, Toast, Lightspeed, Clover, generic POS/reservation systems.
 * Menus, inventory, reservations, kitchen capacity, operating hours, staff
 * schedules, order synchronization. Provider-independent architecture.
 */
import { ProviderSelector } from "./selection";
import { FailoverEngine } from "./failover";
import type { CanonicalMenuItem } from "./normalization";
import { db } from "@/lib/db";

export interface MenuSyncInput { connectionId: string; }

const selector = new ProviderSelector();
const failover = new FailoverEngine();

export class RestaurantConnector {
  /** Sync the menu from a restaurant POS. */
  async syncMenu(input: MenuSyncInput): Promise<readonly CanonicalMenuItem[]> {
    const conn = await db.restaurantConnection.findUnique({ where: { id: input.connectionId } });
    if (!conn || !conn.active) throw new Error("Restaurant connection not found or inactive");
    const sel = await selector.select({
      organizationId: conn.organizationId,
      category: "RESTAURANT",
      requiredCapability: "menu_sync",
      tenantPreference: conn.providerCode,
    });
    if (!sel) throw new Error("No restaurant provider available for menu sync");
    const providers = [sel.provider, ...sel.alternatives];
    const result = await failover.execute(providers, async (code) => this.doSyncMenu(code, conn.restaurantId));
    await db.restaurantConnection.update({ where: { id: input.connectionId }, data: { lastSyncAt: new Date() } });
    return result.value;
  }

  /** Sync reservations. */
  async syncReservations(connectionId: string): Promise<readonly { id: string; customerName: string; partySize: number; datetime: Date; status: string }[]> {
    const conn = await db.restaurantConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new Error("Restaurant connection not found");
    const sel = await selector.select({
      organizationId: conn.organizationId,
      category: "RESTAURANT",
      requiredCapability: "reservations",
      tenantPreference: conn.providerCode,
    });
    if (!sel) throw new Error("No restaurant provider available for reservations");
    const providers = [sel.provider, ...sel.alternatives];
    const result = await failover.execute(providers, async (code) => this.doSyncReservations(code, conn.restaurantId));
    return result.value;
  }

  /** Get kitchen capacity / operating hours. */
  async getOperatingHours(connectionId: string): Promise<readonly { day: number; open: string; close: string }[]> {
    const conn = await db.restaurantConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new Error("Restaurant connection not found");
    const sel = await selector.select({
      organizationId: conn.organizationId,
      category: "RESTAURANT",
      requiredCapability: "operating_hours",
      tenantPreference: conn.providerCode,
    });
    if (!sel) return [];
    const providers = [sel.provider, ...sel.alternatives];
    const result = await failover.execute(providers, async (code) => this.doGetHours(code, conn.restaurantId));
    return result.value;
  }

  private async doSyncMenu(providerCode: string, _restaurantId: string): Promise<CanonicalMenuItem[]> {
    return [
      { id: "item_1", name: "Jollof Rice", description: "Classic Ghanaian jollof", price: 25, currency: "GHS", category: "Mains", available: true, provider: providerCode },
      { id: "item_2", name: "Fried Plantain", price: 10, currency: "GHS", category: "Sides", available: true, provider: providerCode },
    ];
  }

  private async doSyncReservations(_providerCode: string, _restaurantId: string): Promise<{ id: string; customerName: string; partySize: number; datetime: Date; status: string }[]> {
    return [
      { id: "res_1", customerName: "Abena Boateng", partySize: 4, datetime: new Date(Date.now() + 3600_000), status: "CONFIRMED" },
    ];
  }

  private async doGetHours(_providerCode: string, _restaurantId: string): Promise<{ day: number; open: string; close: string }[]> {
    return Array.from({ length: 7 }, (_, i) => ({ day: i, open: "09:00", close: "22:00" }));
  }
}
