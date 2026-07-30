/**
 * @eks/payments — provider-agnostic payment orchestration port.
 *
 * Eks-Food NEVER processes payments directly. All money movement is delegated
 * to a provider that implements this `PaymentProvider` interface. The first
 * provider is Payswap (Stripe-compatible); the architecture allows swapping to
 * Stripe or another compatible provider without changing business logic.
 *
 * Milestone 1 constraint: NO direct API calls. This package defines ONLY the
 * orchestration interface, the type contracts, and the event shapes. Concrete
 * HTTP integrations ship in Milestone 4 (Payments).
 *
 * Eks-Food stores ONLY references — never card numbers, mobile-money PINs,
 * bank credentials, or wallet balances.
 */
export type { PaymentProvider } from "./provider";
export type {
  PaymentIntent, PaymentIntentInput, CheckoutSession, CheckoutSessionInput,
  Transfer, TransferInput, Refund, RefundInput, PaymentStatus, TransferStatus,
  WebhookEvent, PaymentMethodSummary,
} from "./types";
export { PAYMENT_EVENTS } from "./events";
export { MockPaymentProvider } from "./mock-provider";
