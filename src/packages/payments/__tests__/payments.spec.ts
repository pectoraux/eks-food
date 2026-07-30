import { describe, it, expect } from "vitest";
import { MockPaymentProvider } from "../mock-provider";
import { money } from "@eks/common";

describe("MockPaymentProvider", () => {
  const provider = new MockPaymentProvider();
  const amount = money(80, "GHS");

  it("creates a payment intent in REQUIRES_ACTION", async () => {
    const intent = await provider.createPaymentIntent({
      organizationId: "org-1", amount, idempotencyKey: "idmp-1",
    });
    expect(intent.status).toBe("REQUIRES_ACTION");
    expect(intent.amount).toEqual(amount);
    expect(intent.clientSecret).toContain("_secret");
  });

  it("is idempotent on idempotencyKey", async () => {
    const a = await provider.createPaymentIntent({ organizationId: "org-1", amount, idempotencyKey: "idmp-2" });
    const b = await provider.createPaymentIntent({ organizationId: "org-1", amount, idempotencyKey: "idmp-2" });
    expect(a.payswapId).toBe(b.payswapId);
  });

  it("confirms a payment intent → SUCCEEDED", async () => {
    const intent = await provider.createPaymentIntent({ organizationId: "org-1", amount, idempotencyKey: "idmp-3" });
    const confirmed = await provider.confirm(intent.payswapId, { method: "mobile_money", provider: "mtn" });
    expect(confirmed.status).toBe("SUCCEEDED");
  });

  it("retrieves an existing intent", async () => {
    const intent = await provider.createPaymentIntent({ organizationId: "org-1", amount, idempotencyKey: "idmp-4" });
    const found = await provider.retrieve(intent.payswapId);
    expect(found?.payswapId).toBe(intent.payswapId);
    expect(await provider.retrieve("nonexistent")).toBeNull();
  });

  it("creates a transfer (payout) → PAID", async () => {
    const t = await provider.createTransfer({
      organizationId: "org-1", payeeUserId: "cook-1", amount, idempotencyKey: "idmp-tr-1",
    });
    expect(t.status).toBe("PAID");
  });

  it("refunds a payment → REFUNDED", async () => {
    const intent = await provider.createPaymentIntent({ organizationId: "org-1", amount, idempotencyKey: "idmp-5" });
    const refund = await provider.refund({ paymentId: intent.payswapId, idempotencyKey: "idmp-re-1" });
    expect(refund.status).toBe("REFUNDED");
  });

  it("throws on unknown payment id", async () => {
    await expect(provider.confirm("pi_unknown")).rejects.toThrow(/not found/);
  });
});
