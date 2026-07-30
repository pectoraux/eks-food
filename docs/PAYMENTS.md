# Eks-Food — Payments (Payswap Integration Contract)

> **Audience:** Engineers touching the payment boundary, the security team, and anyone integrating a new payment provider. Read alongside `ARCHITECTURE.md` §2 (`@eks/payments`), `API_CONVENTIONS.md` (HTTP surface), and `SECURITY.md` (PCI scope).
>
> **Golden rule:** Eks-Food NEVER processes payments directly. Eks-Food NEVER stores card numbers, mobile-money PINs, bank credentials, wallet balances, or raw authentication tokens. All money movement is delegated to a payment provider through a provider-agnostic port. **Payswap is the first provider.** Swapping providers means implementing the port — nothing else changes.

---

## 1. Design Principles

1. **Orchestration only.** Eks-Food orchestrates the *lifecycle* of a payment (intent → confirm → capture → refund → payout). It never touches the *mechanism* (card networks, mobile-money rails, bank transfers).
2. **References, not credentials.** Eks-Food stores provider-generated IDs (`pi_...`, `cs_...`, `tr_...`) and provider customer IDs. Never card numbers, never PINs, never bank account numbers in raw form.
3. **Provider-agnostic port.** The application layer depends on `PaymentProvider` (an interface), not on `PayswapProvider` (a class). The infrastructure layer wires the concrete adapter.
4. **Idempotent everywhere.** Every provider call carries an idempotency key. Retries are safe. The provider deduplicates; Eks-Food stores the dedup marker.
5. **No partial state.** Every provider call either fully succeeds or fully fails (with a deterministic, retryable outcome). Eks-Food never has to guess whether a charge happened.
6. **Webhook-driven.** Eks-Food does not poll the provider for status. The provider pushes state changes via signed webhooks; Eks-Food's `handleWebhook` is the single ingestion point.

---

## 2. The `PaymentProvider` Port

Defined in `@eks/payments/src/application/ports/payment-provider.ts`. This is the **only** payment abstraction the rest of Eks-Food depends on. The Booking, Catalog, and Audit contexts call methods on `PaymentProvider`, never on `PayswapProvider`.

```ts
// @eks/payments/src/application/ports/payment-provider.ts

/**
 * Provider-agnostic payment orchestration port.
 *
 * Eks-Food's application layer depends on this interface, not on any concrete
 * provider. The infrastructure layer supplies the adapter (PayswapProvider,
 * StripeProvider, etc.). Swapping providers = implementing this interface;
 * no application code changes.
 *
 * Implementations MUST be:
 *   - Idempotent on every write method (use the supplied idempotencyKey).
 *   - Side-effect-free on read methods (retrieve).
 *   - Resilient to transient provider failures (retry with exponential backoff).
 *   - Honest about outcomes (return Result; do not throw for business outcomes).
 */
export interface PaymentProvider {
  /** Create a Payment Intent (customer will confirm later). Idempotent. */
  createIntent(input: CreateIntentInput): Promise<Result<PaymentIntent, PaymentError>>;

  /** Create a hosted Checkout Session (customer pays on provider's page). Idempotent. */
  createCheckoutSession(input: CheckoutSessionInput): Promise<Result<CheckoutSession, PaymentError>>;

  /** Confirm a Payment Intent (customer authorises). Idempotent. */
  confirm(payswapId: string, methodSummary?: MethodSummary): Promise<Result<PaymentIntent, PaymentError>>;

  /** Retrieve the current state of a payment. Read-only. */
  retrieve(payswapId: string): Promise<Result<PaymentIntent | null, PaymentError>>;

  /** Transfer funds to a payee (worker payout). Idempotent. */
  transfer(input: TransferInput): Promise<Result<Transfer, PaymentError>>;

  /** Refund a previously captured payment. Idempotent. */
  refund(payswapId: string, idempotencyKey: string): Promise<Result<PaymentIntent, PaymentError>>;

  /** Inbound webhook ingestion. Verifies signature; dispatches events. */
  handleWebhook(event: WebhookEvent): Promise<Result<WebhookAck, PaymentError>>;
}
```

### 2.1 Input / output types

```ts
export interface CreateIntentInput {
  organizationId: string;
  bookingCode?: string;
  customerId?: string;          // internal user id
  payswapCustomerId?: string;   // provider-side customer reference
  amount: number;
  currency?: string;            // ISO 4217, default "GHS"
  idempotencyKey: string;       // provider-side dedup
  description?: string;
}

export interface PaymentIntent {
  payswapId: string;            // provider's Payment Intent ID (e.g. pi_...)
  clientSecret: string;         // for client-side confirmation
  status: PaymentStatus;
  amount: number;
  currency: string;
}

export type PaymentStatus =
  | "REQUIRES_ACTION"          // customer needs to authorise
  | "REQUIRES_CONFIRMATION"    // server-side confirm pending
  | "SUCCEEDED"                // captured
  | "CANCELLED"                 // abandoned
  | "FAILED"                    // provider declined
  | "REFUNDED";                 // refunded in full

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
  payswapId: string;            // session id (e.g. cs_...)
  url: string;                  // provider-hosted checkout URL
  paymentId: string;            // underlying payment intent id
  status: "REQUIRES_ACTION";
}

export interface MethodSummary {
  method: "card" | "mobile_money" | "bank_transfer" | "wallet";
  provider?: string;            // e.g. "mtn", "vodafone", "visa"
  last4?: string;               // last 4 of card OR masked mobile
  brand?: string;               // e.g. "Visa", "MTN MoMo"
  ref?: string;                 // provider transaction ref
}

export interface TransferInput {
  organizationId: string;
  payeeUserId: string;          // internal user id
  payswapRecipientId?: string;  // provider-side recipient reference
  amount: number;
  currency?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface Transfer {
  payswapId: string;            // provider's Transfer ID (e.g. tr_...)
  status: TransferStatus;
  amount: number;
  currency: string;
}

export type TransferStatus =
  | "PENDING"
  | "IN_TRANSIT"
  | "PAID"
  | "FAILED"
  | "CANCELLED";

export interface WebhookEvent {
  type: string;                 // e.g. "payment_intent.succeeded"
  data: { object: { id: string; status?: string } };
}

export interface WebhookAck {
  received: true;
}
```

### 2.2 The `PaymentError` hierarchy

All provider errors return as `Result.err(PaymentError)`. Never thrown from the port.

```ts
export abstract class PaymentError extends DomainError { }

export class PaymentProviderUnavailableError extends PaymentError {
  readonly status = 502;
  readonly code = "payment.provider_unavailable";
}
export class PaymentDeclinedError extends PaymentError {
  readonly status = 402;
  readonly code = "payment.declined";
}
export class PaymentNotFoundError extends PaymentError {
  readonly status = 404;
  readonly code = "payment.not_found";
}
export class PaymentIdempotencyConflictError extends PaymentError {
  readonly status = 409;
  readonly code = "payment.idempotency_conflict";
}
export class PaymentInvalidStateError extends PaymentError {
  readonly status = 409;
  readonly code = "payment.invalid_state";
}
export class PaymentSignatureValidationError extends PaymentError {
  readonly status = 400;
  readonly code = "payment.signature_invalid";
}
```

---

## 3. Payswap — The First Provider

### 3.1 What Payswap is

Payswap is a **Stripe-compatible** payment provider built for emerging markets. It supports:
- Cards (Visa, Mastercard) via hosted checkout.
- Mobile money (MTN, Vodafone/Telecel, AirtelTigo) via hosted checkout.
- Bank transfers.
- Wallet transfers.
- Worker payouts (Transfers) to mobile money or bank accounts.

The API surface mirrors Stripe's:
- `POST /v1/payment_intents` ≈ Payswap `POST /v1/payment_intents`
- `POST /v1/checkout/sessions` ≈ Payswap `POST /v1/checkout/sessions`
- `POST /v1/payment_intents/:id/confirm` ≈ Payswap `POST /v1/payment_intents/:id/confirm`
- `POST /v1/transfers` ≈ Payswap `POST /v1/transfers`
- `POST /v1/refunds` ≈ Payswap `POST /v1/refunds`
- Webhooks signed with `Payswap-Signature: t=<ts>,v1=<hmac-sha256-hex>`

Because of this compatibility, the Stripe provider (M3 target) is a near-drop-in replacement.

### 3.2 The adapter

`PayswapProvider` is the concrete adapter implementing `PaymentProvider`. It lives in `@eks/payments/src/infrastructure/payswap-provider.ts` (M1 home: `src/lib/payswap.ts`).

Responsibilities:
1. Translate `PaymentProvider` inputs → Payswap HTTP requests.
2. Translate Payswap HTTP responses → `PaymentProvider` outputs (or `PaymentError`).
3. Retry transient failures with exponential backoff (cap 60s, max 5 attempts).
4. Verify webhook signatures in `handleWebhook`.
5. Maintain an internal record (the `PayswapPayment` and `PayswapTransfer` Prisma models) of every provider call, for audit and reconciliation.

### 3.3 What the adapter stores

Eks-Food stores **references only**, in two tables:

```prisma
model PayswapPayment {
  id                String   @id @default(cuid())
  organizationId    String
  payswapId         String   @unique   // pi_... — provider's Payment Intent ID
  bookingCode       String?
  customerId        String?             // internal user id
  payswapCustomerId String?             // provider-side customer reference
  amount            Float
  currency          String   @default("GHS")
  status            String              // matches PaymentStatus union
  methodSummary     String   @default("{}")  // JSON: {method, last4, brand} — refs only
  idempotencyKey    String   @unique    // provider dedup
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  // ...
}

model PayswapTransfer {
  id                String   @id @default(cuid())
  organizationId    String
  payswapId         String   @unique   // tr_... — provider's Transfer ID
  payeeUserId       String
  amount            Float
  currency          String   @default("GHS")
  status            String              // matches TransferStatus union
  metadata          String   @default("{}")
  // ...
}
```

### 3.4 What the adapter NEVER stores

| ❌ Never stored | Why |
|---|---|
| Card number (PAN) | PCI-DSS scope. Payswap holds it. |
| Card CVV | Same. |
| Mobile money PIN | Never enters Eks-Food at all — the customer enters it on Payswap's hosted page. |
| Bank account number (raw) | Stored as a provider recipient reference (`payswapRecipientId`), never the raw account number. |
| Wallet balance | We don't query it; not our concern. |
| Provider API key (in DB) | Lives in `EKS_PAYSWAP_API_KEY` env var, never in the DB. |
| Provider session token | Eks-Food uses stateless API-key auth; no session tokens. |

### 3.5 The `methodSummary` field

After a successful payment, the adapter stores a `methodSummary` JSON object that contains **references only**:

```jsonc
{
  "method": "mobile_money",
  "provider": "mtn",
  "last4": "0234",        // last 4 of the customer's mobile number
  "brand": "MTN MoMo",
  "ref": "MOCK-123456"    // provider transaction reference
}
```

For cards:

```jsonc
{
  "method": "card",
  "provider": "visa",
  "last4": "4242",        // last 4 of the PAN
  "brand": "Visa",
  "ref": "ch_..."         // provider charge id
}
```

Last-4 is the maximum granularity. **No full card numbers, no full mobile numbers, no PINs.** This keeps Eks-Food firmly in PCI-DSS SAQ-A scope.

---

## 4. Milestone 1 — No Live API Calls

**Critical constraint:** In Milestone 1, the Payswap adapter does **NOT** issue any HTTPS calls to `api.payswap.com`. The adapter's methods simulate the provider response locally while honouring the public contract (idempotency, status transitions, webhook ingestion).

This is documented in `src/lib/payswap.ts`:

> *Deterministic, idempotent Payswap client. In production this would issue HTTPS calls to api.payswap.com with retry + exponential backoff. Here it simulates the provider response while honouring idempotency keys, so the public contract is identical to a real Stripe-like integration.*

### 4.1 What M1 does instead

- `createIntent` — generates a `pi_<cuid>` locally, persists a `PayswapPayment` row with `status="REQUIRES_ACTION"`, returns a deterministic `clientSecret = "${payswapId}_secret"`.
- `createCheckoutSession` — generates a `cs_<cuid>`, returns `url = "/checkout?session=${payswapId}"` (an internal mock checkout page), reuses the underlying payment intent.
- `confirm` — flips the `PayswapPayment` row to `status="SUCCEEDED"`, writes a synthetic `methodSummary`.
- `retrieve` — reads the local `PayswapPayment` row.
- `transfer` — generates a `tr_<cuid>` locally, persists a `PayswapTransfer` row with `status="PAID"`.
- `refund` — flips the row to `status="REFUNDED"`.
- `handleWebhook` — accepts a normalised event payload, applies the state transition locally.

### 4.2 Why this is OK

- The public contract (the `PaymentProvider` interface) is **identical** to production. Code that consumes the port today works unchanged when M2 swaps in real HTTP calls.
- Idempotency is exercised end-to-end: re-calling `createIntent` with the same `idempotencyKey` returns the existing intent.
- Status transitions are exercised: `REQUIRES_ACTION → SUCCEEDED → REFUNDED`.
- The booking → match → checkout → confirm → payout golden path works in the browser (verified by Agent Browser — see worklog Task ID 1-3).

### 4.3 What M2 changes

M2 replaces the simulation bodies with real HTTPS calls:

```ts
// M2: real implementation
async createIntent(input: CreateIntentInput): Promise<Result<PaymentIntent, PaymentError>> {
  try {
    const response = await this.http.post("/v1/payment_intents", {
      amount: Math.round(input.amount * 100),     // minor units
      currency: input.currency ?? "GHS",
      description: input.description,
      customer: input.payswapCustomerId,
      metadata: { bookingCode: input.bookingCode, organizationId: input.organizationId },
    }, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Idempotency-Key": input.idempotencyKey,
      },
      retry: { attempts: 5, backoff: "exponential", maxDelayMs: 60_000 },
    });
    return ok(mapToIntent(response.data));
  } catch (error) {
    return err(mapToPaymentError(error));
  }
}
```

The rest of the system — Booking context, Audit context, the route handlers, the React checkout dialog — is unchanged.

---

## 5. The Swap-Provider Path

Eks-Food is designed so that swapping Payswap for another provider (Stripe, Paystack, Flutterwave) is a **bounded, mechanical change**. Here's the path.

### 5.1 Step 1 — Implement the port

Create `@eks/payments/src/infrastructure/stripe-provider.ts`:

```ts
export class StripeProvider implements PaymentProvider {
  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: string,
    private readonly webhookSecret: string,
  ) {}

  async createIntent(input: CreateIntentInput): Promise<Result<PaymentIntent, PaymentError>> { ... }
  async createCheckoutSession(input: CheckoutSessionInput): Promise<Result<CheckoutSession, PaymentError>> { ... }
  async confirm(payswapId: string, methodSummary?: MethodSummary): Promise<Result<PaymentIntent, PaymentError>> { ... }
  async retrieve(payswapId: string): Promise<Result<PaymentIntent | null, PaymentError>> { ... }
  async transfer(input: TransferInput): Promise<Result<Transfer, PaymentError>> { ... }
  async refund(payswapId: string, idempotencyKey: string): Promise<Result<PaymentIntent, PaymentError>> { ... }
  async handleWebhook(event: WebhookEvent): Promise<Result<WebhookAck, PaymentError>> { ... }
}
```

The Stripe adapter is small (~300 lines) because Stripe's API is close to Payswap's. The work is mostly field-name mapping.

### 5.2 Step 2 — Add a feature flag

Add `FeatureFlag` `payments.provider` with values `payswap` (default) | `stripe`. The composition root reads the flag and wires the corresponding adapter:

```ts
// @eks/payments/src/composition.ts
export function buildPaymentProvider(flags: FeatureFlagService): PaymentProvider {
  const provider = flags.get("payments.provider") ?? "payswap";
  switch (provider) {
    case "payswap":
      return new PayswapProvider(http, env.EKS_PAYSWAP_API_KEY, env.EKS_PAYSWAP_WEBHOOK_SECRET);
    case "stripe":
      return new StripeProvider(http, env.EKS_STRIPE_API_KEY, env.EKS_STRIPE_WEBHOOK_SECRET);
    default:
      throw new Error(`Unknown payment provider: ${provider}`);
  }
}
```

### 5.3 Step 3 — Dual-write during transition

For a tenant-by-tenant migration, run **both** providers in parallel for a window:
- New payments go to the provider indicated by the tenant's flag.
- Webhooks from both providers are ingested (two webhook endpoints).
- The `PayswapPayment` table gains a `provider` column (`"payswap"` | `"stripe"`) to disambiguate.
- Reconciliation job compares both providers' records daily; any drift pages the on-call.

### 5.4 Step 4 — Cut over

Once a tenant's volume on the new provider is stable for 2 weeks:
1. Flip the tenant's flag to the new provider.
2. Cancel any pending intents on the old provider.
3. Drain the old provider's webhook queue.
4. After 30 days of zero activity on the old provider for that tenant, decommission the old provider's credentials.

### 5.5 What does NOT change

- The `PaymentProvider` interface.
- The Booking, Catalog, Audit, AI contexts' code — they consume the port.
- The route handlers — they call the application use cases.
- The Prisma schema (the `PayswapPayment` and `PayswapTransfer` tables remain; only a `provider` column is added).
- The audit trail format.

> The swap-provider path is the test of whether the abstraction is correct. If swapping providers requires touching code outside `@eks/payments`, the abstraction leaked. Fix the leak before proceeding.

---

## 6. The Payment Lifecycle

### 6.1 Customer booking → payment

```
1. Customer POSTs /api/v1/bookings
2. Booking context creates Booking (status: PENDING_MATCH)
3. Booking context calls paymentProvider.createIntent({
     organizationId, bookingCode, customerId, amount, currency,
     idempotencyKey: genIdempotencyKey("pi")
   })
4. PaymentProvider returns PaymentIntent (status: REQUIRES_ACTION)
5. Booking context saves intent.payswapId on the Booking row
6. Booking context emits Booking.Created event
7. (async) Matching consumer → Booking.Assigned
8. Customer receives booking code + checkout URL

9. Customer POSTs /api/v1/payswap/checkout
10. Payment context calls paymentProvider.createCheckoutSession({
      organizationId, bookingCode, amount, currency, description,
      customerEmail, successUrl, cancelUrl,
      idempotencyKey: genIdempotencyKey("cs")
    })
11. PaymentProvider returns CheckoutSession (url: provider-hosted)
12. Customer is redirected to the hosted checkout page

13. Customer authorises on the provider's page
14. Provider calls POST /api/v1/payswap/webhook (signed)
    OR Customer returns to successUrl and frontend POSTs /api/v1/payswap/confirm
15. Payment context calls paymentProvider.confirm(payswapId, methodSummary)
16. PaymentProvider returns PaymentIntent (status: SUCCEEDED)
17. Payment context emits Payment.Succeeded event
18. Booking consumer reads Payment.Succeeded → Booking.Confirmed
19. Notification consumer reads Booking.Confirmed → SMS/email to customer + cook
```

### 6.2 Cook payout (Transfer)

```
1. Booking transitions to COMPLETED (cook marks job done)
2. Booking context emits Booking.Completed event
3. Payout consumer reads Booking.Completed
4. Payout consumer calls paymentProvider.transfer({
     organizationId, payeeUserId: cook.userId,
     payswapRecipientId: cook.payswapRecipientId,
     amount: cookShare, currency,
     idempotencyKey: `payout_${booking.code}`,  // deterministic
     metadata: { bookingCode, cookId }
   })
5. PaymentProvider returns Transfer (status: PAID or PENDING)
6. Payout consumer emits Transfer.Paid event
7. Audit consumer records the payout
8. Notification consumer SMSes the cook: "₵128 paid via Payswap"
```

### 6.3 Refund

```
1. Customer cancels within refund window (60 min for full refund)
2. Booking context calls booking.cancel() → Booking.Cancelled
3. Refund consumer reads Booking.Cancelled
4. Refund consumer calls paymentProvider.refund(
     payswapId: booking.payswapPaymentId,
     idempotencyKey: `refund_${booking.code}`
   )
5. PaymentProvider returns PaymentIntent (status: REFUNDED)
6. Refund consumer emits Payment.Refunded
7. Notification consumer SMSes the customer: "Refund of ₵X processed"
```

---

## 7. Idempotency Contract

### 7.1 The rule

Every write method on `PaymentProvider` accepts an `idempotencyKey`. Calling the same method with the same key + same input MUST return the same result, with no duplicate side effect on the provider.

### 7.2 Key generation

```ts
import { genIdempotencyKey } from "@eks/payments";

// For payment intents tied to a booking:
const key = `pi_${booking.code}`;          // deterministic per booking
// or:
const key = genIdempotencyKey("pi");        // unique per call (retries reuse it)
```

For **payouts** and **refunds**, the key MUST be deterministic on the booking code, so a retry of the same payout doesn't double-pay the cook:
```ts
const payoutKey = `payout_${booking.code}`;
const refundKey = `refund_${booking.code}`;
```

For **payment intents** created at booking time, the key MAY be unique per call (the booking code itself deduplicates — one booking = one intent).

### 7.3 Replay semantics

If the provider is called twice with the same idempotency key:
- Same input → provider returns the original result.
- Different input → provider returns `409 conflict`; adapter maps to `PaymentIdempotencyConflictError`.

Eks-Food's local `PayswapPayment.idempotencyKey` UNIQUE constraint is the second line of defence — even if the provider's idempotency layer failed, Eks-Food would not create a duplicate row.

---

## 8. Webhooks

### 8.1 Inbound endpoint

`POST /api/v1/payswap/webhook` is the single ingestion point. The handler:

1. Reads the **raw** request body (the signature is over raw bytes, not parsed JSON).
2. Extracts the `Payswap-Signature` header: `t=<timestamp>,v1=<hex-hmac>`.
3. Computes `HMAC-SHA256(rawBody, EKS_PAYSWAP_WEBHOOK_SECRET)` in constant time.
4. Rejects with `400 payment.signature_invalid` if the signature doesn't match.
5. Rejects with `400 payment.signature_stale` if the timestamp is older than `EKS_WEBHOOK_MAX_AGE_SECONDS` (default 300).
6. Parses the body as a `WebhookEvent`.
7. Calls `paymentProvider.handleWebhook(event)` — which is idempotent on `event.data.object.id`.
8. Returns `200 { received: true }` within 5 seconds. Heavy work goes to the event bus.

### 8.2 Event types handled

| Provider event type | Eks-Food action | Eks-Food event emitted |
|---|---|---|
| `payment_intent.succeeded` | Update `PayswapPayment.status = SUCCEEDED` | `Payment.Succeeded` |
| `payment_intent.payment_failed` | Update `PayswapPayment.status = FAILED` | `Payment.Failed` |
| `payment_intent.cancelled` | Update `PayswapPayment.status = CANCELLED` | (none — booking already cancelled) |
| `charge.refunded` | Update `PayswapPayment.status = REFUNDED` | `Payment.Refunded` |
| `transfer.paid` | Update `PayswapTransfer.status = PAID` | `Transfer.Paid` |
| `transfer.failed` | Update `PayswapTransfer.status = FAILED` | (alert; manual review) |

### 8.3 Webhook idempotency

The provider retries webhooks that don't get a `2xx` response. `handleWebhook` is idempotent:
- The `updateMany` queries include a `where: { status: { not: "SUCCEEDED" } }` guard, so a duplicate webhook for an already-processed payment is a no-op.
- The `Payment.Succeeded` event emission goes through the outbox, which deduplicates on `(aggregateId, eventType, occurredAt)`.

### 8.4 Webhook signature verification (M2)

In M1, the webhook endpoint accepts unsigned events (for the mock checkout flow). In M2, the `Payswap-Signature` header is **mandatory** and verified. The M1 handler already has the verification code path stubbed; M2 enables it.

### 8.5 Outbound webhooks (M3)

For tenant-configured partner integrations, Eks-Food publishes outbound webhooks. Same envelope as inbound:
- HMAC-SHA256 signed.
- Headers: `X-EKS-Event-Id`, `X-EKS-Event-Type`, `X-EKS-Timestamp`, `X-EKS-Signature`.
- Retry with exponential backoff for 24h, then DLQ.

---

## 9. Reconciliation

### 9.1 Daily reconciliation job

A nightly job (`scripts/reconcile-payments.ts`) compares Eks-Food's `PayswapPayment` and `PayswapTransfer` rows against the provider's API for the previous 24h:

- For every payment in `SUCCEEDED` state, fetch the provider's record. If statuses diverge, alert.
- For every transfer in `PAID` state, fetch the provider's record. If statuses diverge, alert.
- For every provider record not in Eks-Food's DB (orphan), alert — this means a webhook was missed.
- For every Eks-Food record not in the provider's API (phantom), alert — this means a record was created locally but never reached the provider (should be impossible with M2's real HTTP).

### 9.2 Reconciliation report

The job produces a report at `s3://eks-food-reports/reconciliation/<yyyy-mm-dd>.json`:

```jsonc
{
  "date": "2025-07-29",
  "tenantId": "cm9k8j2...",
  "payments": { "checked": 142, "matched": 140, "diverged": 1, "orphans": 1 },
  "transfers": { "checked": 87, "matched": 87, "diverged": 0, "orphans": 0 },
  "alerts": [
    { "type": "diverged", "payswapId": "pi_...", "eksStatus": "SUCCEEDED", "providerStatus": "FAILED" },
    { "type": "orphan", "payswapId": "pi_...", "foundIn": "provider", "missingFrom": "eks" }
  ]
}
```

Any non-empty `alerts` array pages the on-call.

### 9.3 Manual reconciliation

On-demand reconciliation via `scripts/reconcile-payments.ts --tenant <id> --from <ts> --to <ts>`. Useful during incident response.

---

## 10. Money Movement — Where It Lives

| Operation | Initiator | Mechanism | Eks-Food stores |
|---|---|---|---|
| Customer pays for booking | Customer (via checkout) | Payswap hosted checkout → charge to card/MoMo | `PayswapPayment` (status: SUCCEEDED), `methodSummary` (refs only) |
| Cook payout for completed job | Eks-Food (via outbox consumer) | Payswap Transfer API → funds to cook's MoMo/bank | `PayswapTransfer` (status: PAID), `metadata` (booking code, cook id) |
| Refund to customer | Eks-Food (via cancellation flow) | Payswap Refund API → funds back to original method | `PayswapPayment` (status: REFUNDED) |
| Platform fee | Implicit | Payswap takes its fee at charge time; Eks-Food receives net settlement | Not separately tracked; visible in provider dashboard |
| Cross-currency | Never | All amounts are in the booking's currency; no FX | n/a |

### 10.1 The money flow diagram

```
   Customer                Eks-Food              Payswap               Cook
      │                       │                     │                    │
      │ 1. Book + checkout    │                     │                    │
      ├──────────────────────►│                     │                    │
      │                       │ 2. createIntent     │                    │
      │                       ├────────────────────►│                    │
      │                       │ 3. REQUIRES_ACTION  │                    │
      │                       │◄────────────────────┤                    │
      │ 4. Redirect to hosted │                     │                    │
      │   checkout            │                     │                    │
      ├─────────────────────────────────────────────►│                    │
      │ 5. Enter card/MoMo    │                     │                    │
      │   (on Payswap page)   │                     │                    │
      │ 6. Authorise          │                     │                    │
      ├─────────────────────────────────────────────►│                    │
      │                       │ 7. Webhook:         │                    │
      │                       │   payment_intent    │                    │
      │                       │   .succeeded        │                    │
      │                       │◄────────────────────┤                    │
      │                       │ 8. Confirm locally  │                    │
      │                       │   emit              │                    │
      │                       │   Payment.Succeeded │                    │
      │                       │                     │                    │
      │                       │ 9. Booking          │                    │
      │                       │   completed; payout │                    │
      │                       │   consumer runs     │                    │
      │                       │   transfer()        │                    │
      │                       ├────────────────────►│                    │
      │                       │                     │ 10. Transfer to    │
      │                       │                     │     cook's MoMo    │
      │                       │                     ├───────────────────►│
      │                       │ 11. Webhook:        │                    │
      │                       │   transfer.paid     │                    │
      │                       │◄────────────────────┤                    │
      │                       │ 12. SMS cook:       │                    │
      │                       │   "₵128 paid"       │                    │
```

Eks-Food's hands never touch the money. Payswap holds the funds between charge and transfer. Eks-Food only records what happened.

---

## 11. Failure Modes & How We Handle Them

| Failure | Detection | Mitigation |
|---|---|---|
| Provider 5xx | Adapter retries 5× with exponential backoff; on final failure returns `PaymentProviderUnavailableError` | Route handler returns `502`; outbox retries the consumer |
| Provider timeout (>30s) | Adapter times out; returns `PaymentProviderUnavailableError` | Same as 5xx |
| Webhook signature invalid | `handleWebhook` rejects with `PaymentSignatureValidationError` | Log; alert if rate spikes (could be misconfigured secret OR an attack) |
| Webhook missed (lost in transit) | Daily reconciliation finds orphan record in provider | Manual trigger of the missed event via admin API; backfill |
| Duplicate webhook | `handleWebhook` is idempotent on `event.data.object.id` | No-op |
| Idempotency key conflict | Provider returns 409; adapter maps to `PaymentIdempotencyConflictError` | Investigate; usually a client retrying with a different payload |
| Double-charge attempt | Idempotency key dedup at provider + UNIQUE constraint at DB | Second call returns the original result; no double-charge |
| Payout to wrong cook | `transfer.metadata.cookId` is audited; reconciliation catches divergences | Refund the wrong payee; pay the right payee; post-mortem |
| Refund for already-refunded payment | `refund()` checks current status; returns `PaymentInvalidStateError` if already REFUNDED | No double-refund |
| Provider goes bankrupt | Daily reconciliation; provider status page | Activate swap-provider path (§5); new provider wired within hours |

---

## 12. Testing the Payment Boundary

### 12.1 Unit tests (mock the port)

Booking context tests mock `PaymentProvider`:

```ts
const payments: PaymentProvider = {
  createIntent: vi.fn().mockResolvedValue(ok({
    payswapId: "pi_test_1",
    clientSecret: "pi_test_1_secret",
    status: "REQUIRES_ACTION",
    amount: 180,
    currency: "GHS",
  })),
  // ... other methods stubbed
};
```

These tests verify the booking → payment orchestration logic, not the provider.

### 12.2 Contract tests (real adapter, recorded fixtures)

`tests/contract/payswap-webhook.spec.ts` runs the adapter against recorded webhook fixtures (in `tests/fixtures/payswap-webhooks/`). Verifies that:
- Signature verification accepts valid signatures.
- Signature verification rejects tampered signatures.
- Each event type transitions the local state correctly.
- Duplicate webhooks are idempotent.

### 12.3 Integration tests (mock HTTP with msw)

The adapter's HTTP layer is tested with msw. Recorded Payswap responses are replayed; the adapter's mapping logic is verified.

### 12.4 Sandbox tests (real provider sandbox, M2)

In M2, a nightly job runs against the Payswap sandbox:
- Create intent, confirm, refund, transfer.
- Reconciliation job runs against the sandbox.
- Any divergence is a Sev-2.

### 12.5 What we never test

- **Real money movement in CI.** Never. The sandbox uses test cards and test MoMo numbers; production money is never moved by automation.
- **Real customer PII in test fixtures.** Use obviously fake data (`test@eks.test`, `+233000000000`).

---

## 13. PCI-DSS Scope

Eks-Food is **PCI-DSS SAQ-A** scoped:

- Card data **never** enters Eks-Food's systems. The customer enters card details on Payswap's hosted checkout page, which is on Payswap's PCI-DSS Level 1 certified infrastructure.
- Eks-Food receives only the `payswapId` (a token) and the `methodSummary` (last-4 + brand, which is permitted under SAQ-A).
- Eks-Food's servers, logs, and databases are therefore out of PCI scope.

If a future feature (M4+) were to accept card data directly (e.g. for a saved-card UX), the scope would jump to SAQ-D, requiring full PCI-DSS compliance. **We do not plan this.** The hosted-checkout model is the architectural decision (ADR-0004) that keeps us in SAQ-A.

---

## 14. References

- `src/lib/payswap.ts` — M1 Payswap adapter (the file this doc describes).
- `prisma/schema.prisma` — `PayswapPayment`, `PayswapTransfer` models.
- `src/app/api/payswap/` — checkout, confirm, payouts, webhook route handlers.
- `docs/API_CONVENTIONS.md` §14 — webhook HTTP contract.
- `docs/EVENT_CONVENTIONS.md` — `Payment.Succeeded`, `Payment.Refunded`, `Transfer.Paid` events.
- `docs/SECURITY.md` §2 (A02, A08) — cryptographic controls and integrity.
- `docs/OPERATIONS_RUNBOOK.md` §7 — Payswap provider outage runbook.
