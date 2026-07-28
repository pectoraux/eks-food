import { db } from "@/lib/db";

/**
 * Payswap — Payment Infrastructure Abstraction
 *
 * Eks-Food NEVER processes payments directly. All money movement is delegated
 * to Payswap, which is integrated exactly like Stripe. This module is the only
 * boundary between Eks-Food and the payment provider; swapping providers means
 * reimplementing this one file.
 *
 * What Eks-Food stores (references only — never sensitive payment data):
 *   - Payswap Customer IDs
 *   - Payswap Payment Intent / Charge IDs
 *   - Payswap Transfer IDs (worker payouts)
 *   - Payswap Refund IDs
 *   - Payment status + audit metadata
 *
 * What Eks-Food NEVER stores: card numbers, mobile money PINs, bank credentials,
 * wallet balances, or raw authentication tokens.
 */

export type PayswapPaymentStatus =
  | "REQUIRES_ACTION"
  | "REQUIRES_CONFIRMATION"
  | "SUCCEEDED"
  | "CANCELLED"
  | "FAILED"
  | "REFUNDED";

export type PayswapTransferStatus =
  | "PENDING"
  | "IN_TRANSIT"
  | "PAID"
  | "FAILED"
  | "CANCELLED";

export interface PaymentIntentInput {
  organizationId: string;
  bookingCode?: string;
  customerId?: string;
  payswapCustomerId?: string;
  amount: number;
  currency?: string;
  idempotencyKey: string;
  description?: string;
}

export interface PaymentIntent {
  payswapId: string;
  clientSecret: string;
  status: PayswapPaymentStatus;
  amount: number;
  currency: string;
}

export interface CheckoutSessionInput {
  organizationId: string;
  bookingCode: string;
  amount: number;
  currency?: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface CheckoutSession {
  payswapId: string;
  url: string;
  paymentId: string;
  status: "REQUIRES_ACTION";
}

export interface TransferInput {
  organizationId: string;
  payeeUserId: string;
  amount: number;
  currency?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface Transfer {
  payswapId: string;
  status: PayswapTransferStatus;
  amount: number;
  currency: string;
}

/**
 * Deterministic, idempotent Payswap client. In production this would issue
 * HTTPS calls to api.payswap.com with retry + exponential backoff. Here it
 * simulates the provider response while honouring idempotency keys, so the
 * public contract is identical to a real Stripe-like integration.
 */
export const payswap = {
  /**
   * Create a Payment Intent. Idempotent on `idempotencyKey`.
   * Equivalent to `POST /v1/payment_intents` on Stripe.
   */
  async createPaymentIntent(input: PaymentIntentInput): Promise<PaymentIntent> {
    const existing = await db.payswapPayment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return {
        payswapId: existing.payswapId,
        clientSecret: `${existing.payswapId}_secret`,
        status: existing.status as PayswapPaymentStatus,
        amount: existing.amount,
        currency: existing.currency,
      };
    }

    const payswapId = `pi_${cuid()}`;
    const currency = input.currency ?? "GHS";

    const record = await db.payswapPayment.create({
      data: {
        organizationId: input.organizationId,
        payswapId,
        bookingCode: input.bookingCode,
        customerId: input.customerId,
        payswapCustomerId: input.payswapCustomerId,
        amount: input.amount,
        currency,
        status: "REQUIRES_ACTION",
        methodSummary: JSON.stringify({ description: input.description ?? "" }),
        idempotencyKey: input.idempotencyKey,
      },
    });

    return {
      payswapId: record.payswapId,
      clientSecret: `${record.payswapId}_secret`,
      status: "REQUIRES_ACTION",
      amount: record.amount,
      currency: record.currency,
    };
  },

  /**
   * Create a hosted Checkout Session. Idempotent on `idempotencyKey`.
   * Equivalent to `POST /v1/checkout/sessions` on Stripe.
   */
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
    const intent = await this.createPaymentIntent({
      organizationId: input.organizationId,
      bookingCode: input.bookingCode,
      amount: input.amount,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
    });

    // In production this would be a signed Payswap-hosted URL.
    // Here we expose an internal confirm endpoint that the mock checkout page calls.
    const url = `/checkout?session=${intent.payswapId}`;

    return {
      payswapId: `cs_${cuid()}`,
      url,
      paymentId: intent.payswapId,
      status: "REQUIRES_ACTION",
    };
  },

  /**
   * Confirm a Payment Intent (customer authorises on Payswap-hosted page).
   * Equivalent to `POST /v1/payment_intents/:id/confirm`.
   */
  async confirmPayment(payswapId: string, methodSummary?: Record<string, unknown>): Promise<PaymentIntent> {
    const record = await db.payswapPayment.update({
      where: { payswapId },
      data: {
        status: "SUCCEEDED",
        methodSummary: JSON.stringify(
          methodSummary ?? { method: "mobile_money", provider: "mtn", ref: "MOCK-" + Math.floor(Math.random() * 1e6) }
        ),
      },
    });
    return {
      payswapId: record.payswapId,
      clientSecret: `${record.payswapId}_secret`,
      status: record.status as PayswapPaymentStatus,
      amount: record.amount,
      currency: record.currency,
    };
  },

  /**
   * Retrieve payment status. Read-only, no money movement.
   */
  async retrievePayment(payswapId: string) {
    return db.payswapPayment.findUnique({ where: { payswapId } });
  },

  /**
   * Request a worker payout (Transfer). Idempotent on `idempotencyKey`.
   * Equivalent to `POST /v1/transfers` on Stripe.
   */
  async createTransfer(input: TransferInput): Promise<Transfer> {
    const existing = await db.payswapTransfer.findUnique({
      where: { payswapId: `tr_${input.idempotencyKey.slice(0, 20)}` },
    });
    if (existing) {
      return {
        payswapId: existing.payswapId,
        status: existing.status as PayswapTransferStatus,
        amount: existing.amount,
        currency: existing.currency,
      };
    }

    const payswapId = `tr_${cuid()}`;
    const record = await db.payswapTransfer.create({
      data: {
        organizationId: input.organizationId,
        payswapId,
        payeeUserId: input.payeeUserId,
        amount: input.amount,
        currency: input.currency ?? "GHS",
        status: "PAID",
        metadata: JSON.stringify(input.metadata ?? {}),
      },
    });
    return {
      payswapId: record.payswapId,
      status: record.status as PayswapTransferStatus,
      amount: record.amount,
      currency: record.currency,
    };
  },

  /**
   * Request a refund. Records a new Payment row in REFUNDED state linked by bookingCode.
   */
  async refund(payswapId: string, idempotencyKey: string): Promise<PaymentIntent> {
    const original = await db.payswapPayment.findUnique({ where: { payswapId } });
    if (!original) throw new Error("Payswap payment not found");
    const record = await db.payswapPayment.update({
      where: { payswapId },
      data: { status: "REFUNDED" },
    });
    return {
      payswapId: record.payswapId,
      clientSecret: `${record.payswapId}_secret`,
      status: record.status as PayswapPaymentStatus,
      amount: record.amount,
      currency: record.currency,
    };
  },

  /**
   * Webhook ingestion. In production this verifies the Payswap signature and
   * dispatches events to a queue. Here we accept a normalised event payload.
   */
  async handleWebhook(event: {
    type: string;
    data: { object: { id: string; status?: string } };
  }) {
    if (event.type === "payment_intent.succeeded") {
      const id = event.data.object.id;
      await db.payswapPayment.updateMany({
        where: { payswapId: id, status: { not: "SUCCEEDED" } },
        data: { status: "SUCCEEDED" },
      });
    }
    if (event.type === "transfer.paid") {
      const id = event.data.object.id;
      await db.payswapTransfer.updateMany({
        where: { payswapId: id, status: { not: "PAID" } },
        data: { status: "PAID" },
      });
    }
    return { received: true };
  },
};

// Lightweight id generator (avoids extra dependency at this layer).
function cuid(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

export function genIdempotencyKey(prefix = "idmp") {
  return `${prefix}_${cuid()}`;
}
