/**
 * The provider-agnostic PaymentProvider port. Business logic depends on this
 * interface, never on a concrete provider. Payswap is the first implementation
 * (Stripe-compatible API); swap to Stripe by implementing this interface.
 *
 * Milestone 1: orchestration interface ONLY. No HTTP calls.
 */
import type {
  PaymentIntent, PaymentIntentInput, CheckoutSession, CheckoutSessionInput,
  Transfer, TransferInput, Refund, RefundInput, PaymentStatus,
  WebhookEvent,
} from "./types";

export interface PaymentProvider {
  readonly name: string;

  /** Create a payment intent (no charge yet). Idempotent on idempotencyKey. */
  createPaymentIntent(input: PaymentIntentInput): Promise<PaymentIntent>;

  /** Create a hosted checkout session. Customer authorises on the provider's domain. */
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;

  /** Confirm/authorise a payment intent. Called after customer action. */
  confirm(paymentId: string, method?: { method: string; provider?: string }): Promise<PaymentIntent>;

  /** Read-only status retrieval. */
  retrieve(paymentId: string): Promise<PaymentIntent | null>;

  /** Request a worker payout (transfer). Idempotent on idempotencyKey. */
  createTransfer(input: TransferInput): Promise<Transfer>;

  /** Request a refund. */
  refund(input: RefundInput): Promise<Refund>;

  /** Verify & ingest a webhook from the provider. Returns the normalised event. */
  handleWebhook(rawBody: string, signature: string | null): Promise<WebhookEvent>;
}
