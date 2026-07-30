/**
 * MockPaymentProvider — a reference in-process implementation of the
 * PaymentProvider port. Used for the foundation milestone, tests, and local
 * development. NEVER used in production — the Payswap provider ships in M4.
 *
 * It honours the full idempotency contract so swapping in the real provider
 * is behaviour-equivalent.
 */
import type { PaymentProvider } from "./provider";
import type {
  PaymentIntent, PaymentIntentInput, CheckoutSession, CheckoutSessionInput,
  Transfer, TransferInput, Refund, RefundInput, WebhookEvent,
} from "./types";
import { uuid, shortId, money } from "@eks/common";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  private readonly intents = new Map<string, PaymentIntent>();
  private readonly transfers = new Map<string, Transfer>();
  private readonly idempotencyIndex = new Map<string, string>();

  async createPaymentIntent(input: PaymentIntentInput): Promise<PaymentIntent> {
    const existingId = this.idempotencyIndex.get(input.idempotencyKey);
    if (existingId) return this.intents.get(existingId)!;
    const id = `pi_mock_${shortId()}`;
    const intent: PaymentIntent = {
      payswapId: id, clientSecret: `${id}_secret`, status: "REQUIRES_ACTION", amount: input.amount,
    };
    this.intents.set(id, intent);
    this.idempotencyIndex.set(input.idempotencyKey, id);
    return intent;
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    const intent = await this.createPaymentIntent({
      organizationId: input.organizationId, bookingCode: input.bookingCode,
      amount: input.amount, idempotencyKey: input.idempotencyKey, description: input.description,
    });
    return {
      payswapId: `cs_mock_${shortId()}`,
      url: `/checkout?session=${intent.payswapId}`,
      paymentId: intent.payswapId,
      status: "REQUIRES_ACTION",
    };
  }

  async confirm(paymentId: string, method?: { method: string; provider?: string }): Promise<PaymentIntent> {
    const intent = this.intents.get(paymentId);
    if (!intent) throw new Error(`Payment intent not found: ${paymentId}`);
    const updated: PaymentIntent = { ...intent, status: "SUCCEEDED" };
    this.intents.set(paymentId, updated);
    return updated;
  }

  async retrieve(paymentId: string): Promise<PaymentIntent | null> {
    return this.intents.get(paymentId) ?? null;
  }

  async createTransfer(input: TransferInput): Promise<Transfer> {
    const existingId = this.idempotencyIndex.get(input.idempotencyKey);
    if (existingId) return this.transfers.get(existingId)!;
    const id = `tr_mock_${shortId()}`;
    const transfer: Transfer = { payswapId: id, status: "PAID", amount: input.amount };
    this.transfers.set(id, transfer);
    this.idempotencyIndex.set(input.idempotencyKey, id);
    return transfer;
  }

  async refund(input: RefundInput): Promise<Refund> {
    const intent = this.intents.get(input.paymentId);
    if (!intent) throw new Error(`Payment intent not found: ${input.paymentId}`);
    this.intents.set(input.paymentId, { ...intent, status: "REFUNDED" });
    return { payswapId: `re_mock_${shortId()}`, status: "REFUNDED", amount: intent.amount };
  }

  async handleWebhook(rawBody: string, _signature: string | null): Promise<WebhookEvent> {
    const parsed = JSON.parse(rawBody) as WebhookEvent;
    return parsed;
  }
}
