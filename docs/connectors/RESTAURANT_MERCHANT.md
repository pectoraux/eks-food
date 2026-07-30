# Eks-Food Connector Ecosystem — Restaurant & Merchant Integration Guide

> **Audience:** Platform engineers building restaurant and merchant features, ops engineers monitoring POS + catering connectors, integration partners adding a new POS or merchant provider. Read alongside `PROVIDER_DEVELOPMENT.md`, `PROVIDER_SELECTION.md`, `CONNECTOR_OPERATIONS.md`, and `PROCUREMENT_GUIDE.md`.
>
> **Status:** Milestone 5. This document covers the **restaurants** and **merchant** categories of the `@eks/connectors` package (`src/packages/connectors/restaurants/` and `src/packages/connectors/merchant/`). Both are document-light, high-touch categories built on the same adapter pattern. Neither processes payments — the M1 `PaymentProvider` abstraction (Payswap, see `docs/PAYMENTS.md`) handles all payment flows.

---

## 1. Two Categories, Shared Foundations

The restaurants and merchant categories are sibling sub-packages:

- **restaurants** — Point-of-Sale (POS), reservations, kitchen management, menus, inventory, operating hours, staff schedules, order sync. Used for restaurant-side Eks-Food partners.
- **merchant** — catering, corporate meals, contracts, recurring orders, invoicing, purchase approvals. Used for the B2B/merchant-side Eks-Food partners (caterers, corporate-meal providers, food-service contractors).

They share:

- The `tenant-pinned` selection strategy (a restaurant's POS is provider-specific; a merchant's contract system is provider-specific).
- The `quality-first` strategy for inventory (data integrity is critical).
- A common canonical schema lineage (both build on `CanonicalOrder`, `CanonicalMenuItem`, `CanonicalInvoice`).
- A common pattern: most calls are sync-driven (periodic catalog/order sync) with webhook fast-paths for order events.

Neither category processes payments. Order totals are computed by the connector; the actual payment is initiated by the business surface via the M1 `PaymentProvider` (Payswap or Stripe), see `docs/PAYMENTS.md`. The merchant connector surfaces invoice state (`received`, `matched`, `paid`) by listening to the M1 `EventOutbox` for payment-confirmation events — it never calls a payment API itself.

---

## 2. The Restaurants Category

### 2.1 The providers

| Provider | Code | Type | Region | Auth |
|---|---|---|---|---|
| Square POS | `square` | Cloud POS | Global | OAuth2 authorization-code |
| Toast POS | `toast` | Restaurant POS | US, CA | API key |
| Lightspeed POS | `lightspeed` | Restaurant + Retail POS | Global | OAuth2 client-credentials |
| Clover POS | `clover` | Restaurant POS | US, CA | OAuth2 authorization-code |
| Resy/ResDiary/OpenTable | `reservations-generic` | Reservations | Global | API key / OAuth2 |
| Custom POS (generic REST) | `pos-generic` | Custom | Any | API key / OAuth2 |

The platform is provider-pluggable; new POS adapters ship as adapter files under `src/packages/connectors/restaurants/adapters/`.

### 2.2 The Prisma model

```prisma
model RestaurantConnection {
  id              String   @id @default(cuid())
  organizationId  String
  providerConfigId String  // → ProviderConfiguration.id
  providerCode    String   // "square", "toast", "lightspeed", "clover", "reservations-generic", "pos-generic"
  // The restaurant's location ID at the POS (multi-location restaurants have multiple connections)
  locationId      String?
  locationName    String?
  // Sync state
  lastMenuSyncAt  DateTime?
  menuSyncToken   String?
  lastOrderSyncAt DateTime?
  orderSyncToken  String?
  lastInventorySyncAt DateTime?
  inventorySyncToken String?
  // Webhook registration
  webhookEndpointId String? // → WebhookEndpoint.id (M4)
  // Status
  status          String   @default("ACTIVE") // ACTIVE | PAUSED | ERROR
  lastError       String?
  connectedAt     DateTime @default(now())
  updatedAt       DateTime @updatedAt

  provider        ProviderConfiguration @relation(fields: [providerConfigId], references: [id])

  @@unique([organizationId, providerCode, locationId])
}
```

### 2.3 The canonical schema

```typescript
export const CanonicalMenuItem = z.object({
  schemaVersion: z.literal("1.5.0"),
  id: z.string(),                              // provider's item ID
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  priceUsdCents: z.number().int().positive(),
  currency: z.string().default("USD"),
  imageUrl: z.string().optional(),
  isAvailable: z.boolean().default(true),
  modifiers: z.array(z.object({
    name: z.string(),
    required: z.boolean().default(false),
    options: z.array(z.object({
      name: z.string(),
      priceDeltaUsdCents: z.number().int().default(0),
    })),
  })).default([]),
  dietaryTags: z.array(z.enum(["vegetarian", "vegan", "gluten-free", "halal", "kosher", "nut-free", "dairy-free"])).default([]),
  provider: z.string(),
  updatedAt: z.string().datetime(),
});

export const CanonicalOrder = z.object({
  schemaVersion: z.literal("1.5.0"),
  id: z.string(),                              // provider's order ID
  locationId: z.string(),
  orderType: z.enum(["dine-in", "takeout", "delivery", "catering", "pickup"]),
  status: z.enum(["pending", "confirmed", "preparing", "ready", "in-transit", "delivered", "cancelled", "refunded"]),
  tableNumber: z.string().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  lines: z.array(z.object({
    lineNo: z.number().int(),
    itemId: z.string(),
    name: z.string(),
    quantity: z.number().positive(),
    unitPriceUsdCents: z.number().int().positive(),
    modifiers: z.array(z.object({
      name: z.string(),
      optionName: z.string(),
      priceDeltaUsdCents: z.number().int().default(0),
    })).default([]),
    lineTotalUsdCents: z.number().int().positive(),
    notes: z.string().optional(),
  })),
  subtotalUsdCents: z.number().int().positive(),
  taxUsdCents: z.number().int().default(0),
  tipUsdCents: z.number().int().default(0),
  totalUsdCents: z.number().int().positive(),
  currency: z.string().default("USD"),
  placedAt: z.string().datetime(),
  requestedForAt: z.string().datetime().optional(),
  fulfilledAt: z.string().datetime().optional(),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
});

export const CanonicalReservation = z.object({
  schemaVersion: z.literal("1.5.0"),
  id: z.string(),
  locationId: z.string(),
  partySize: z.number().int().positive(),
  customerName: z.string(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  startAt: z.string().datetime(),
  durationMin: z.number().int().default(90),
  tableNumber: z.string().optional(),
  status: z.enum(["pending", "confirmed", "seated", "completed", "cancelled", "no-show"]).default("pending"),
  notes: z.string().optional(),
  provider: z.string(),
});

export const CanonicalOperatingHours = z.object({
  schemaVersion: z.literal("1.5.0"),
  locationId: z.string(),
  weekly: z.array(z.object({
    weekday: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
    opensAt: z.string(), // HH:mm local
    closesAt: z.string(),
  })).default([]),
  exceptions: z.array(z.object({
    date: z.string(), // YYYY-MM-DD
    closed: z.boolean().default(true),
    opensAt: z.string().optional(),
    closesAt: z.string().optional(),
    note: z.string().optional(),
  })).default([]),
  timezone: z.string(),
  provider: z.string(),
});
```

### 2.4 The service surface

```typescript
export const restaurants = {
  // Menu
  listMenu(input: { connectionId: string }): Promise<CanonicalMenuItem[]>,
  // Orders
  listOrders(input: { connectionId: string; from: Date; to: Date; status?: string }): Promise<CanonicalOrder[]>,
  createOrder(input: { connectionId: string; order: Omit<CanonicalOrder, "id"|"status"|"provider">; idempotencyKey: string }): Promise<CanonicalOrder>,
  updateOrderStatus(input: { connectionId: string; orderId: string; status: CanonicalOrder["status"] }): Promise<CanonicalOrder>,
  cancelOrder(input: { connectionId: string; orderId: string; reason: string }): Promise<CanonicalOrder>,
  // Reservations
  listReservations(input: { connectionId: string; from: Date; to: Date }): Promise<CanonicalReservation[]>,
  createReservation(input: { connectionId: string; reservation: Omit<CanonicalReservation, "id"|"status"|"provider">; idempotencyKey: string }): Promise<CanonicalReservation>,
  cancelReservation(input: { connectionId: string; reservationId: string }): Promise<CanonicalReservation>,
  // Operating hours
  getOperatingHours(input: { connectionId: string }): Promise<CanonicalOperatingHours>,
  // Inventory (for kitchen management)
  getInventory(input: { connectionId: string }): Promise<Array<{ sku: string; name: string; inStock: boolean; quantity?: number }>>,
  // Staff schedules
  getStaffSchedule(input: { connectionId: string; from: Date; to: Date }): Promise<Array<{ staffId: string; name: string; startUtc: string; endUtc: string; role: string }>>,
  // Sync (internal)
  incrementalOrderSync(input: { connectionId: string }): Promise<{ added: number; updated: number; nextToken: string }>,
};
```

---

## 3. POS Order Sync

Restaurant POS data is sync-heavy. The scheduler runs `incrementalOrderSync` every 5 minutes (default; configurable). Orders are pulled in delta — only those created/updated since `orderSyncToken`.

For POS providers that support webhooks (Square, Toast, Clover), order events are pushed in real-time:

- `order.created` → triggers an immediate fetch of the full order via `getOrder`
- `order.updated` → triggers a re-fetch of the changed order
- `order.fulfilled` → marks the order as `fulfilled` in Eks-Food without a re-fetch

For providers without webhooks (Lightspeed, generic POS), the 5-minute polling sync is the only source. This is acceptable for most restaurant workflows but introduces a 5-minute lag for real-time dashboards.

### 3.1 Order-to-booking reconciliation

Eks-Food bookings (cook → customer) are reconciled against restaurant POS orders when a restaurant is also an Eks-Food cook partner. The reconciliation flow:

1. A new POS order arrives via sync.
2. The matching engine checks if the order corresponds to an existing Eks-Food booking (matched by `customerEmail` + `placedAt ± 5 min`).
3. On match: the booking is marked `fulfilled` automatically; the order's `totalUsdCents` is cross-checked against the booking's expected total.
4. On mismatch: the order is logged as an "unmatched POS order" for manual review.

---

## 4. The Merchant Category

### 4.1 The providers

| Provider | Code | Type | Region | Auth |
|---|---|---|---|---|
| SAP Ariba | `sap-ariba` | Procurement & contract management | Global | OAuth2 client-credentials |
| Coupa | `coupa` | Procurement & invoicing | Global | API key + HMAC |
| Custom contract system (generic REST) | `merchant-generic` | Custom | Any | API key / OAuth2 |
| QuickBooks Online | `quickbooks` | Invoicing & accounting | US, CA, UK, AU | OAuth2 authorization-code |
| Xero | `xero` | Invoicing & accounting | Global | OAuth2 authorization-code |

The merchant category overlaps with procurement (catalogue, PO) but is distinct in focus: procurement is supplier-side, merchant is buyer-side (the Eks-Food caterer acting as supplier to corporate customers).

### 4.2 The Prisma model

```prisma
model MerchantConnection {
  id              String   @id @default(cuid())
  organizationId  String
  providerConfigId String  // → ProviderConfiguration.id
  providerCode    String   // "sap-ariba", "coupa", "merchant-generic", "quickbooks", "xero"
  // The tenant's customer ID at this merchant system
  customerAccountNumber String?
  // Sync state
  lastContractSyncAt DateTime?
  contractSyncToken String?
  lastOrderSyncAt   DateTime?
  orderSyncToken    String?
  lastInvoiceSyncAt DateTime?
  invoiceSyncToken  String?
  // Webhook registration
  webhookEndpointId String?
  // Status
  status          String   @default("ACTIVE") // ACTIVE | PAUSED | ERROR
  lastError       String?
  connectedAt     DateTime @default(now())
  updatedAt       DateTime @updatedAt

  provider        ProviderConfiguration @relation(fields: [providerConfigId], references: [id])

  @@unique([organizationId, providerCode])
}
```

### 4.3 The canonical schema

```typescript
export const CanonicalContract = z.object({
  schemaVersion: z.literal("1.6.0"),
  id: z.string(),
  contractNumber: z.string(),
  buyerOrgName: z.string(),
  buyerOrgId: z.string().optional(),
  sellerOrgName: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(["draft", "pending-approval", "active", "expired", "terminated", "cancelled"]),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  totalValueUsdCents: z.number().int().positive(),
  currency: z.string().default("USD"),
  // For recurring-meal contracts
  recurringSchedule: z.object({
    frequency: z.enum(["daily", "weekly", "bi-weekly", "monthly"]),
    daysOfWeek: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).default([]),
    deliveryTime: z.string(), // HH:mm
    headcount: z.number().int().positive(),
  }).optional(),
  // Catering contracts: linked event dates
  events: z.array(z.object({
    date: z.string().datetime(),
    headcount: z.number().int().positive(),
    menuId: z.string().optional(),
    location: z.string().optional(),
  })).default([]),
  // Approvals
  approvals: z.array(z.object({
    role: z.string(),
    approverEmail: z.string().email(),
    status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    decidedAt: z.string().datetime().optional(),
    comments: z.string().optional(),
  })).default([]),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
});

export const CanonicalMerchantOrder = z.object({
  schemaVersion: z.literal("1.6.0"),
  id: z.string(),
  orderNumber: z.string(),
  contractId: z.string().optional(),
  buyerOrgName: z.string(),
  buyerAccountNumber: z.string(),
  status: z.enum(["draft", "submitted", "confirmed", "in-progress", "delivered", "cancelled", "rejected"]),
  // For recurring orders: links to the recurring schedule
  recurringScheduleId: z.string().optional(),
  // Order lines (catering items or meal packages)
  lines: z.array(z.object({
    lineNo: z.number().int(),
    description: z.string(),
    quantity: z.number().positive(),
    unit: z.string().default("each"), // "head" for per-head catering, "each" for items, "case" for cases
    unitPriceUsdCents: z.number().int().positive(),
    lineTotalUsdCents: z.number().int().positive(),
    deliveryDate: z.string().datetime().optional(),
    deliveryLocation: z.string().optional(),
  })),
  subtotalUsdCents: z.number().int().positive(),
  taxUsdCents: z.number().int().default(0),
  totalUsdCents: z.number().int().positive(),
  currency: z.string().default("USD"),
  placedAt: z.string().datetime(),
  requestedDeliveryDate: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().optional(),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
});

export const CanonicalMerchantInvoice = z.object({
  schemaVersion: z.literal("1.6.0"),
  id: z.string(),
  invoiceNumber: z.string(),
  orderId: z.string().optional(),
  contractId: z.string().optional(),
  buyerOrgName: z.string(),
  buyerAccountNumber: z.string(),
  status: z.enum(["draft", "sent", "viewed", "approved", "disputed", "paid", "void"]),
  lines: z.array(z.object({
    lineNo: z.number().int(),
    description: z.string(),
    quantity: z.number().positive(),
    unitPriceUsdCents: z.number().int().positive(),
    lineTotalUsdCents: z.number().int().positive(),
  })),
  subtotalUsdCents: z.number().int().positive(),
  taxUsdCents: z.number().int().default(0),
  totalUsdCents: z.number().int().positive(),
  currency: z.string().default("USD"),
  issuedAt: z.string().datetime(),
  dueAt: z.string().datetime(),
  sentAt: z.string().datetime().optional(),
  paidAt: z.string().datetime().optional(),
  // Payment reference (from the M1 PaymentProvider — not initiated by this connector)
  paymentReference: z.string().optional(),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
});
```

### 4.4 The service surface

```typescript
export const merchant = {
  // Contracts
  listContracts(input: { connectionId: string; status?: string }): Promise<CanonicalContract[]>,
  getContract(input: { connectionId: string; contractId: string }): Promise<CanonicalContract>,
  createContract(input: { connectionId: string; contract: Omit<CanonicalContract, "id"|"contractNumber"|"status"|"provider">; idempotencyKey: string }): Promise<CanonicalContract>,
  submitContractForApproval(input: { connectionId: string; contractId: string }): Promise<CanonicalContract>,
  cancelContract(input: { connectionId: string; contractId: string; reason: string }): Promise<CanonicalContract>,
  // Orders
  listOrders(input: { connectionId: string; from: Date; to: Date; status?: string }): Promise<CanonicalMerchantOrder[]>,
  createOrder(input: { connectionId: string; order: Omit<CanonicalMerchantOrder, "id"|"orderNumber"|"status"|"provider">; idempotencyKey: string }): Promise<CanonicalMerchantOrder>,
  cancelOrder(input: { connectionId: string; orderId: string; reason: string }): Promise<CanonicalMerchantOrder>,
  // Invoices
  listInvoices(input: { connectionId: string; from: Date; to: Date; status?: string }): Promise<CanonicalMerchantInvoice[]>,
  createInvoice(input: { connectionId: string; invoice: Omit<CanonicalMerchantInvoice, "id"|"invoiceNumber"|"status"|"provider">; idempotencyKey: string }): Promise<CanonicalMerchantInvoice>,
  sendInvoice(input: { connectionId: string; invoiceId: string }): Promise<CanonicalMerchantInvoice>,
  markInvoicePaid(input: { connectionId: string; invoiceId: string; paymentReference: string; paidAt: Date }): Promise<CanonicalMerchantInvoice>,
  // Sync (internal)
  incrementalContractSync(input: { connectionId: string }): Promise<{ added: number; updated: number; nextToken: string }>,
  incrementalOrderSync(input: { connectionId: string }): Promise<{ added: number; updated: number; nextToken: string }>,
  incrementalInvoiceSync(input: { connectionId: string }): Promise<{ added: number; updated: number; nextToken: string }>,
};
```

---

## 5. Catering Contracts — Worked Example

A corporate customer (Acme Corp) signs a recurring-meal contract with an Eks-Food caterer. The flow:

```typescript
import { merchant } from "@eks/connectors/merchant";

async function createCateringContract(catererOrgId: string, acmeOrgId: string): Promise<CanonicalContract> {
  const conn = await db.merchantConnection.findFirst({
    where: { organizationId: catererOrgId, providerCode: "sap-ariba", status: "ACTIVE" },
  });
  if (!conn) throw new Error("No Ariba connection configured");

  const contract = await merchant.createContract({
    connectionId: conn.id,
    idempotencyKey: `caterer:${catererOrgId}:acme:${Date.now()}`,
    contract: {
      schemaVersion: "1.6.0",
      contractNumber: "", // populated by provider
      buyerOrgName: "Acme Corp",
      buyerOrgId: acmeOrgId,
      sellerOrgName: "Eks-Food Caterer",
      title: "Weekly catering — Acme HQ",
      description: "Tuesday and Thursday lunch for 50 pax at Acme HQ",
      status: "draft",
      startDate: new Date("2025-02-01").toISOString(),
      endDate: new Date("2025-12-31").toISOString(),
      totalValueUsdCents: 130_000_00, // $130,000
      currency: "USD",
      recurringSchedule: {
        frequency: "weekly",
        daysOfWeek: ["tue", "thu"],
        deliveryTime: "12:30",
        headcount: 50,
      },
      events: [],
      approvals: [
        { role: "acme-procurement", approverEmail: "procurement@acme.com", status: "pending" },
        { role: "caterer-finance", approverEmail: "finance@caterer.com", status: "pending" },
      ],
    },
  });

  // Submit for approval — Ariba routes to the approvers
  await merchant.submitContractForApproval({ connectionId: conn.id, contractId: contract.id });

  return contract;
}
```

Once both approvers approve, Ariba pushes a webhook to Eks-Food. The webhook handler transitions the contract to `active` and the scheduler begins generating weekly orders automatically (every Monday at 09:00, two orders are generated for the following Tuesday and Thursday).

---

## 6. Recurring Order Generation

For contracts with a `recurringSchedule`, the M4 `Scheduler` runs a daily job at 09:00 (tenant-local time) that:

1. Lists all `active` contracts with a `recurringSchedule` where the next occurrence falls within the next 7 days.
2. For each occurrence, generates a `CanonicalMerchantOrder` via `merchant.createOrder` (idempotent via `idempotencyKey = contract:${contractId}:${date}`).
3. The order's lines are derived from the contract's `headcount × per-head-price` (catering) or from a fixed menu (corporate meals).
4. The order is submitted to the merchant provider for confirmation.

Order generation is **forward-only** — once generated, an order is not modified by the scheduler. If the contract is cancelled mid-cycle, the scheduler skips future occurrences but doesn't touch already-generated orders (the operator must cancel them manually).

---

## 7. Invoicing — Without Payment Processing

The merchant connector handles invoices but never initiates payments. The flow:

1. **Invoice creation** — when an order is delivered, the caterer creates an invoice via `merchant.createInvoice`. The invoice is `status = "draft"`.
2. **Sending** — `merchant.sendInvoice` transitions the invoice to `status = "sent"` and pushes it to the buyer's invoice portal (Ariba, Coupa, or email for QuickBooks/Xero).
3. **Buyer approval** — the buyer approves the invoice in their portal. The merchant connector receives a webhook (`invoice.approved`) and transitions to `status = "approved"`.
4. **Payment initiation** — *outside the merchant connector*. The M1 `PaymentProvider` (Payswap or Stripe) initiates the actual payment via the buyer's saved payment method. See `docs/PAYMENTS.md`.
5. **Payment confirmation** — the M1 `EventOutbox` publishes a `PaymentSucceeded` event. The merchant module listens, calls `merchant.markInvoicePaid` with the `paymentReference`, and transitions the invoice to `status = "paid"`.

This separation is intentional: payment-processing logic (PCI compliance, fraud checks, retries, refunds) is the PaymentProvider's responsibility. The merchant connector only tracks invoice state. If a payment fails, the invoice remains `status = "approved"` and the PaymentProvider handles retries; the merchant connector is uninvolved.

---

## 8. Restaurant + Merchant Overlap

Some Eks-Food partners are both restaurants (sell to consumers via POS) and merchants (sell catering to corporates). The two connectors coexist on the same tenant:

- `RestaurantConnection` rows track POS integrations (Square, Toast, etc.) — consumer-side.
- `MerchantConnection` rows track contract/invoicing integrations (Ariba, Coupa, etc.) — corporate-side.

The same menu can be exposed through both: the restaurant's POS menu ( dine-in, takeout) and a curated catering menu (corporate meals). The matching engine treats them as separate surfaces — a consumer order through POS doesn't conflict with a catering order through Ariba.

### 8.1 Order deduplication

When a corporate customer orders a one-off catering meal via the consumer marketplace (not via a contract), the order appears in both the POS (consumer-side) and the merchant system (if the caterer is also a merchant partner). The deduplication logic:

- Match by `(buyerEmail, totalUsdCents, placedAt ± 5 min)`.
- On match: the POS order is the "source of truth" for line items; the merchant order is marked `linkedOrder = POS-<id>` and its invoice is suppressed (the consumer pays via the marketplace, not via invoice).

---

## 9. Per-Provider Implementation Notes

### 9.1 Square POS adapter (`square.ts`)

**Endpoints:**
- Catalog: `https://connect.squareup.com/v2/catalog/list` and `https://connect.squareup.com/v2/catalog/search`
- Orders: `https://connect.squareup.com/v2/orders/search` (with `location_ids` filter)
- Webhooks: `https://connect.squareup.com/v2/webhooks/subscriptions` for `order.created`, `order.updated`, `order.fulfilled`

**Auth:** OAuth2 authorization-code. The cook's Square access token is stored encrypted on `ProviderCredential`; refresh is automatic via the M4 `AuthProvider`.

**Quirks:**
- Square's Catalog API returns `CatalogItem` and `CatalogItemVariation` as separate objects; the adapter joins them into a single `CanonicalMenuItem`.
- Order totals are computed server-side by Square; the adapter trusts the returned `total_money` rather than summing line items (Square applies modifiers, discounts, and taxes that are complex to replicate).
- The webhook signature is verified via Square's signature scheme (`x-square-hmacsha256-signature` header) — not the standard HMAC-SHA256 used by other providers. The adapter's `handleWebhook` handles this.

### 9.2 Toast POS adapter (`toast.ts`)

**Endpoints:**
- Menus: `https://ws-api.toasttab.com/menus/v1/menus`
- Orders: `https://ws-api.toasttab.com/orders/v1/orders` (polling with `lastModified` cursor)
- Webhooks: `https://ws-api.toasttab.com/webhooks/v1/subscriptions` for order events

**Auth:** API key (`Authorization: Bearer <token>`), with a separate `Toast-Restaurant-Id` header per location.

**Quirks:**
- Toast's webhook delivery is best-effort; the adapter runs polling fallback every 5 min to catch missed events.
- Toast's menu API returns menu items grouped by menu, section, and group; the adapter flattens to a list of `CanonicalMenuItem` with `category` populated from the section name.

### 9.3 SAP Ariba adapter (`sap-ariba.ts`)

**Endpoints:**
- Contracts: `https://<realm>.ariba.com/api/contract-management/v1/contracts`
- Orders: `https://<realm>.ariba.com/api/procurement/v1/orders`
- Invoices: `https://<realm>.ariba.com/api/invoicing/v1/invoices`

**Auth:** OAuth2 client-credentials (`<realm>` is the tenant's Ariba realm).

**Quirks:**
- Ariba's API requires the realm in the URL path; the adapter reads it from `ProviderConfiguration.config.realm`.
- Contract approvals are multi-step (each approver sees the contract in their queue). The adapter surfaces the approval status via the `approvals[]` array on `CanonicalContract`.
- Invoice PDFs are returned as a separate API call; the adapter stores the URL in `providerMetadata.pdfUrl` and the merchant module fetches it on demand.

### 9.4 QuickBooks Online adapter (`quickbooks.ts`)

**Endpoints:**
- Invoices: `https://quickbooks.api.intuit.com/v3/company/<realmId>/invoice`
- Customers: `https://quickbooks.api.intuit.com/v3/company/<realmId>/customer`

**Auth:** OAuth2 authorization-code (Intuit's OAuth2 with refresh).

**Quirks:**
- QuickBooks is accounting-only — no contracts, no orders. The adapter maps `supportedCalls = ["list-invoices", "create-invoice", "send-invoice"]` only.
- The invoice `status` mapping: QuickBooks `Draft` → `draft`, `Payable` → `sent`, `Paid` → `paid`, `Void` → `void`.

### 9.5 Generic adapters (`pos-generic.ts`, `merchant-generic.ts`)

For partners with bespoke APIs. The adapter takes a per-tenant `ProviderConfiguration.config.endpointMapping` that maps canonical operations to URL paths and HTTP methods. This is the escape hatch when no provider-specific adapter exists.

```json
{
  "endpoints": {
    "listMenu": { "method": "GET", "path": "/api/menu" },
    "createOrder": { "method": "POST", "path": "/api/orders" },
    "listInvoices": { "method": "GET", "path": "/api/invoices" }
  },
  "auth": { "type": "api-key", "header": "X-Api-Key" }
}
```

The generic adapter uses `mapSchema` rules from the M4 `MappingEngine` to translate between the partner's JSON shapes and the canonical schemas. This is more brittle than a purpose-built adapter (no error-shape handling, no webhook signature verification) but enables long-tail coverage.

---

## 10. Caching Strategy

| Category | Capability | Namespace | TTL | Notes |
|---|---|---|---|---|
| restaurants | `list-menu` | `rest-menu:v1` | 1 h | Menus change rarely; invalidate on webhook |
| restaurants | `get-operating-hours` | `rest-hours:v1` | 24 h | Hours change weekly |
| restaurants | `list-orders` | `rest-orders:v1` | 30 s | Real-time-ish; webhooks refresh |
| restaurants | `list-reservations` | `rest-res:v1` | 30 s | Same |
| restaurants | `get-inventory` | `rest-inv:v1` | 5 min | Inventory fluctuates |
| restaurants | `get-staff-schedule` | `rest-staff:v1` | 1 h | Schedule changes weekly |
| merchant | `list-contracts` | `mer-contracts:v1` | 5 min | Contracts change rarely; approvals update more often |
| merchant | `list-orders` | `mer-orders:v1` | 30 s | Order status changes during fulfilment |
| merchant | `list-invoices` | `mer-invoices:v1` | 5 min | Invoice state changes with payment |

---

## 11. Operations

### 11.1 Order sync lag

`ProviderHealth.syncLagSec` for restaurants/merchant should stay < 5 min. > 15 min is `DEGRADED`; > 30 min is `UNHEALTHY` (page on-call).

### 11.2 Webhook delivery

For Square/Toast/Clover, webhook delivery failures cascade quickly: missed `order.created` events mean missed orders in the matching engine's reconciliation. The webhook monitor (see `CONNECTOR_OPERATIONS.md` §5) surfaces failures; > 5 failures in 5 min triggers a fall-back to polling-only mode.

### 11.3 Invoice matching

Invoice matching (merchant invoice ↔ procurement PO ↔ restaurant order) is the most common ops intervention. The merchant module surfaces "unmatched" invoices for manual review. Common causes:

- Buyer's purchase-order number not on the invoice (supplier used their own reference).
- Quantity or price mismatch (substituted SKU, contract price not applied).
- Duplicate invoice (same invoice number, different lines — usually a re-issue after a correction).

---

## 12. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Initiating payment from the merchant connector | PCI compliance violation; refunds broken | Use the M1 `PaymentProvider`; the merchant connector only tracks invoice state |
| Treating POS order total as authoritative without line-item validation | POS-side pricing bugs cascade into merchant invoices | Always re-sum line items; flag discrepancies > 1% for review |
| Trusting contract `approvals[]` without re-fetching | Stale approval state on the dashboard | Webhook-driven refresh; re-fetch on every UI view |
| Generating recurring orders for cancelled contracts | Caterer delivers meals that aren't wanted | Forward-only scheduler; cancelled contracts skip future occurrences |
| Calling Square without the location_id filter | Other-location orders pollute the sync | Always pass `location_ids` in the orders search |
| Persisting POS customer emails in plaintext | PII leak | Hash emails in logs; encrypt in DB (the M2 IAM stack handles this) |
| Assuming webhook delivery for QuickBooks/Xero | Invoices stuck in `sent` for days | QuickBooks doesn't have invoice-state webhooks; poll daily |
| Bypassing the merchant connector for invoice creation | Invoices don't reconcile; finance loses visibility | Always call `merchant.createInvoice` for B2B transactions |

---

## 13. Further Reading

- `PROVIDER_DEVELOPMENT.md` — the adapter authoring pattern.
- `PROVIDER_SELECTION.md` — the `tenant-pinned` and `quality-first` strategies.
- `CONNECTOR_OPERATIONS.md` — sync dashboard, webhook monitor, invoice matching.
- `PROCUREMENT_GUIDE.md` — supplier-side procurement (mirror image of merchant buyer-side).
- `DISASTER_RECOVERY.md` — POS/merchant-specific DR (POS outage during peak, contract sync failure).
- `docs/PAYMENTS.md` — the M1 `PaymentProvider` abstraction (Payswap, Stripe) that handles payments.
- `docs/integration/SYNCHRONIZATION_GUIDE.md` — the M4 sync engine (underlying incremental sync).
- `docs/integration/WEBHOOK_GUIDE.md` — the M4 webhook platform.
