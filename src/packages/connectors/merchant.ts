/**
 * Merchant Connector — enterprise merchant integrations.
 * Catering systems, corporate meal platforms, workplace ordering, recurring
 * meal contracts. Organization profiles, contracts, recurring orders, invoicing
 * references, purchase approvals. Does NOT process payments — uses the
 * PaymentProvider abstraction for any payment needs.
 */
import { ProviderSelector } from "./selection";
import { FailoverEngine } from "./failover";
import { db } from "@/lib/db";

export interface MerchantOrderInput { connectionId: string; contractId: string; items: readonly { name: string; quantity: number; price: number }[]; deliveryDate: Date; }

const selector = new ProviderSelector();
const failover = new FailoverEngine();

export class MerchantConnector {
  /** Import a merchant contract. */
  async importContract(connectionId: string): Promise<{ contractId: string; terms: Record<string, unknown>; active: boolean; provider: string }> {
    const conn = await db.merchantConnection.findUnique({ where: { id: connectionId } });
    if (!conn || !conn.active) throw new Error("Merchant connection not found or inactive");
    const sel = await selector.select({
      organizationId: conn.organizationId,
      category: "MERCHANT",
      requiredCapability: "contract_import",
      tenantPreference: conn.providerCode,
    });
    if (!sel) throw new Error("No merchant provider available for contract import");
    const providers = [sel.provider, ...sel.alternatives];
    const result = await failover.execute(providers, async (code) => this.doImportContract(code, conn.merchantId));
    await db.merchantConnection.update({ where: { id: connectionId }, data: { contract: JSON.stringify(result.value.terms), lastSyncAt: new Date() } });
    return result.value;
  }

  /** Create a recurring merchant order. */
  async createOrder(input: MerchantOrderInput): Promise<{ orderId: string; status: string; totalAmount: number; currency: string; invoiceRef: string; provider: string }> {
    const conn = await db.merchantConnection.findUnique({ where: { id: input.connectionId } });
    if (!conn) throw new Error("Merchant connection not found");
    const sel = await selector.select({
      organizationId: conn.organizationId,
      category: "MERCHANT",
      requiredCapability: "recurring_orders",
      tenantPreference: conn.providerCode,
    });
    if (!sel) throw new Error("No merchant provider available for recurring orders");
    const providers = [sel.provider, ...sel.alternatives];
    const result = await failover.execute(providers, async (code) => this.doCreateOrder(code, input));
    return result.value;
  }

  /** Get purchase approval status. */
  async getApprovalStatus(connectionId: string, orderId: string): Promise<{ approved: boolean; approver: string; approvedAt: Date | null; provider: string }> {
    const conn = await db.merchantConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new Error("Merchant connection not found");
    const sel = await selector.select({
      organizationId: conn.organizationId,
      category: "MERCHANT",
      requiredCapability: "approvals",
      tenantPreference: conn.providerCode,
    });
    if (!sel) throw new Error("No merchant provider available for approvals");
    const providers = [sel.provider, ...sel.alternatives];
    const result = await failover.execute(providers, async (code) => this.doGetApproval(code, orderId));
    return result.value;
  }

  private async doImportContract(providerCode: string, _merchantId: string): Promise<{ contractId: string; terms: Record<string, unknown>; active: boolean; provider: string }> {
    return {
      contractId: `contract_${Date.now().toString(36)}`,
      terms: { type: "recurring_meal", durationMonths: 12, mealsPerWeek: 5, pricePerMeal: 15 },
      active: true,
      provider: providerCode,
    };
  }

  private async doCreateOrder(providerCode: string, input: MerchantOrderInput): Promise<{ orderId: string; status: string; totalAmount: number; currency: string; invoiceRef: string; provider: string }> {
    const total = input.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return {
      orderId: `mo_${Date.now().toString(36)}`,
      status: "PENDING_APPROVAL",
      totalAmount: total,
      currency: "GHS",
      invoiceRef: `inv_${Date.now().toString(36)}`,
      provider: providerCode,
    };
  }

  private async doGetApproval(_providerCode: string, _orderId: string): Promise<{ approved: boolean; approver: string; approvedAt: Date | null; provider: string }> {
    return { approved: false, approver: "pending", approvedAt: null, provider: _providerCode };
  }
}
