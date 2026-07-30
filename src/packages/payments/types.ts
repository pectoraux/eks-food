import type { Money, UUID, ISODateString } from "@eks/common";

export type PaymentStatus =
  | "REQUIRES_ACTION" | "REQUIRES_CONFIRMATION" | "SUCCEEDED"
  | "CANCELLED" | "FAILED" | "REFUNDED";

export type TransferStatus = "PENDING" | "IN_TRANSIT" | "PAID" | "FAILED" | "CANCELLED";

export interface PaymentMethodSummary {
  readonly method: "mobile_money" | "card" | "bank_transfer";
  readonly provider?: string;
  readonly ref?: string;
}

export interface PaymentIntentInput {
  readonly organizationId: string;
  readonly bookingCode?: string;
  readonly customerId?: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly description?: string;
}

export interface PaymentIntent {
  readonly payswapId: string; // provider payment-intent id
  readonly clientSecret: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
}

export interface CheckoutSessionInput {
  readonly organizationId: string;
  readonly bookingCode: string;
  readonly amount: Money;
  readonly description: string;
  readonly customerEmail: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly idempotencyKey: string;
}

export interface CheckoutSession {
  readonly payswapId: string;
  readonly url: string;
  readonly paymentId: string;
  readonly status: "REQUIRES_ACTION";
}

export interface TransferInput {
  readonly organizationId: string;
  readonly payeeUserId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly metadata?: Record<string, unknown>;
}

export interface Transfer {
  readonly payswapId: string;
  readonly status: TransferStatus;
  readonly amount: Money;
}

export interface RefundInput {
  readonly paymentId: string;
  readonly idempotencyKey: string;
  readonly reason?: string;
}

export interface Refund {
  readonly payswapId: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
}

export interface WebhookEvent {
  readonly id: string;
  readonly type: string;
  readonly createdAt: ISODateString;
  readonly data: { readonly object: { readonly id: string; readonly status?: string } };
  readonly signature?: string;
}

export type { UUID };
