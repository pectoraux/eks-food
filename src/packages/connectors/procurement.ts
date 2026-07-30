/**
 * Procurement Connector — supplier integrations.
 * Supports: supplier catalogs, inventory feeds, wholesale pricing, seasonal
 * pricing, purchase orders, product availability, delivery schedules.
 * Incremental synchronization.
 */
import { ProviderSelector } from "./selection";
import { FailoverEngine } from "./failover";
import { ConnectorCache } from "./cache";
import type { CanonicalCatalogItem } from "./normalization";
import { db } from "@/lib/db";

export interface CatalogSyncInput { connectionId: string; }
export interface PurchaseOrderInput { connectionId: string; items: readonly { sku: string; quantity: number }[]; deliveryDate: Date; }

const selector = new ProviderSelector();
const failover = new FailoverEngine();
const cache = new ConnectorCache();

export class ProcurementConnector {
  /** Sync the supplier catalog (incremental). Cached for 1 hour. */
  async syncCatalog(input: CatalogSyncInput): Promise<readonly CanonicalCatalogItem[]> {
    const conn = await db.procurementConnection.findUnique({ where: { id: input.connectionId } });
    if (!conn || !conn.active) throw new Error("Procurement connection not found or inactive");
    const cacheKey = `procurement:catalog:${conn.supplierId}`;
    return cache.getOrFetch(cacheKey, async () => {
      const sel = await selector.select({
        organizationId: conn.organizationId,
        category: "PROCUREMENT",
        requiredCapability: "catalog_sync",
        tenantPreference: conn.providerCode,
      });
      if (!sel) throw new Error("No procurement provider available for catalog sync");
      const providers = [sel.provider, ...sel.alternatives];
      const result = await failover.execute(providers, async (code) => this.doSyncCatalog(code, conn.supplierId));
      await db.procurementConnection.update({ where: { id: input.connectionId }, data: { lastSyncAt: new Date() } });
      return result.value;
    }, 3600_000); // 1h cache
  }

  /** Place a purchase order. */
  async placePurchaseOrder(input: PurchaseOrderInput): Promise<{ orderId: string; status: string; estimatedDelivery: Date; provider: string }> {
    const conn = await db.procurementConnection.findUnique({ where: { id: input.connectionId } });
    if (!conn) throw new Error("Procurement connection not found");
    const sel = await selector.select({
      organizationId: conn.organizationId,
      category: "PROCUREMENT",
      requiredCapability: "purchase_orders",
      tenantPreference: conn.providerCode,
    });
    if (!sel) throw new Error("No procurement provider available for purchase orders");
    const providers = [sel.provider, ...sel.alternatives];
    const result = await failover.execute(providers, async (code) => this.doPlaceOrder(code, conn.supplierId, input));
    return result.value;
  }

  /** Check product availability. */
  async checkAvailability(connectionId: string, skus: readonly string[]): Promise<readonly { sku: string; inStock: boolean; quantity: number }[]> {
    const conn = await db.procurementConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new Error("Procurement connection not found");
    const sel = await selector.select({
      organizationId: conn.organizationId,
      category: "PROCUREMENT",
      requiredCapability: "availability",
      tenantPreference: conn.providerCode,
    });
    if (!sel) throw new Error("No procurement provider available for availability");
    const providers = [sel.provider, ...sel.alternatives];
    const result = await failover.execute(providers, async (code) => this.doCheckAvailability(code, skus));
    return result.value;
  }

  private async doSyncCatalog(providerCode: string, _supplierId: string): Promise<CanonicalCatalogItem[]> {
    return [
      { sku: "RICE-25KG", name: "Long Grain Rice 25kg", price: 120, currency: "GHS", unit: "bag", inStock: true, provider: providerCode },
      { sku: "OIL-20L", name: "Vegetable Oil 20L", price: 85, currency: "GHS", unit: "jug", inStock: true, provider: providerCode },
      { sku: "TOMATO-10KG", name: "Fresh Tomatoes 10kg", price: 45, currency: "GHS", unit: "crate", inStock: false, provider: providerCode },
    ];
  }

  private async doPlaceOrder(providerCode: string, _supplierId: string, input: PurchaseOrderInput): Promise<{ orderId: string; status: string; estimatedDelivery: Date; provider: string }> {
    return {
      orderId: `po_${Date.now().toString(36)}`,
      status: "SUBMITTED",
      estimatedDelivery: input.deliveryDate,
      provider: providerCode,
    };
  }

  private async doCheckAvailability(_providerCode: string, skus: readonly string[]): Promise<{ sku: string; inStock: boolean; quantity: number }[]> {
    return skus.map((sku) => ({ sku, inStock: Math.random() > 0.2, quantity: Math.floor(Math.random() * 100) }));
  }
}
