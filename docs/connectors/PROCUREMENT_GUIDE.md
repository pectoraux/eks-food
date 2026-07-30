# Eks-Food Connector Ecosystem — Procurement Integration Guide

> **Audience:** Platform engineers building supply-chain features, ops engineers monitoring supplier feeds, integration partners adding a new procurement provider. Read alongside `PROVIDER_DEVELOPMENT.md`, `PROVIDER_SELECTION.md`, `CONNECTOR_OPERATIONS.md`, and `SYNCHRONIZATION_GUIDE.md`.
>
> **Status:** Milestone 5. This document covers the **procurement** category of the `@eks/connectors` package (`src/packages/connectors/procurement/`), its production adapters (Sysco, US Foods, Metro Cash & Carry, local-market CSV/SFTP adapters), the canonical schema, the incremental sync model, and the per-tenant supplier connection model.

---

## 1. Why Procurement Matters to Eks-Food

Procurement is the supply side of the Eks-Food marketplace. Cooks source ingredients from wholesale suppliers; the procurement connector ecosystem automates:

- **Supplier catalogue sync** — every supplier publishes a catalogue (thousands of SKUs, prices, units, availability). Eks-Food keeps an up-to-date mirror so cooks can compare prices across suppliers.
- **Inventory feeds** — suppliers publish real-time stock levels; the catalogue's `inStock` flag drives substitution recommendations when a cook's first-choice supplier is out.
- **Wholesale pricing** — per-tier (cook tier, organisation tier) pricing; bulk discounts; contract pricing overrides.
- **Seasonal pricing** — agricultural commodities fluctuate; the connector surfaces seasonal trends so cooks can lock in contracts before prices spike.
- **Purchase orders** — cook creates a PO in Eks-Food; the connector submits it to the supplier's API; the supplier acknowledges; the connector syncs the fulfilment status back.
- **Delivery schedules** — supplier delivery windows drive the cook's prep schedule; missed deliveries trigger alternative-supplier fallback.
- **Invoices** — invoices arrive via the connector (EDI 810, PDF, JSON) and are matched to POs by the merchant module.

Each procurement call goes through `procurement.<method>()` from `@eks/connectors/procurement`. The selection engine uses the `cost-aware` strategy — sync is non-interactive and quality differences between suppliers are small.

---

## 2. The Providers

Eks-Food's procurement connectors are heterogeneous — global distributors, regional wholesalers, and small local-market CSV feeds. The adapters ship for the most common cases:

| Provider | Code | Type | Region | Auth |
|---|---|---|---|---|
| Sysco | `sysco` | Global distributor | US, CA, UK | OAuth2 client-credentials |
| US Foods | `us-foods` | Global distributor | US | API key + HMAC signing |
| Metro Cash & Carry | `metro` | Regional wholesaler | DE, EE, LV, LT, PL, RO, BG, GR, TR, … | OAuth2 client-credentials |
| CSV/SFTP (generic) | `csv-sftp` | File import-export | Any | SFTP password / SSH key |
| EDI (generic) | `edi-generic` | EDI 850/855/810/846 | Any | AS2 certificate |
| Local-market (Ghana: Adu-Ghana, MaxMart) | `gh-local` | Regional wholesaler | GH | API key (per supplier) |
| Local-market (Nigeria: Shoprite Wholesale) | `ng-local` | Regional wholesaler | NG | API key |

The platform is provider-pluggable. The `ExternalProvider` catalog can be extended without code changes via the `POST /api/v1/providers/catalog` admin route — though new adapters still require an adapter file in `src/packages/connectors/procurement/adapters/`.

---

## 3. The Prisma Model

The `ProcurementConnection` model records the per-tenant supplier binding. One row per (organisation, supplier) pair.

```prisma
model ProcurementConnection {
  id              String   @id @default(cuid())
  organizationId  String
  providerConfigId String  // → ProviderConfiguration.id
  supplierCode    String   // e.g. "sysco", "metro", "gh-local:adu-ghana"
  supplierDisplayName String
  // The tenant's account number at this supplier (for PO submission, invoice matching)
  supplierAccountNumber String?
  // Sync state
  lastCatalogSyncAt DateTime?
  catalogSyncToken String? // opaque cursor — adapter-managed
  lastInventorySyncAt DateTime?
  inventorySyncToken String?
  // Catalog scope (which categories/departments to sync — null = all)
  catalogScope    String?  // JSON array of department codes
  // PO submission configuration
  poConfig        String   @default("{}") // JSON: default delivery window, default shipping address
  // Invoice matching
  invoiceMatchingEnabled Boolean @default(true)
  invoiceMatchStrategy String @default("po_number") // po_number | supplier_ref | fuzzy
  // Status
  status          String   @default("ACTIVE") // ACTIVE | PAUSED | ERROR
  lastError       String?
  connectedAt     DateTime @default(now())
  updatedAt       DateTime @updatedAt

  provider        ProviderConfiguration @relation(fields: [providerConfigId], references: [id])

  @@unique([organizationId, supplierCode])
  @@index([organizationId, status])
}
```

---

## 4. The Canonical Schema

Procurement data is rich — catalogues, inventory, prices, POs, invoices. Each is a separate canonical type.

### 4.1 `CanonicalProduct`

```typescript
export const CanonicalProduct = z.object({
  schemaVersion: z.literal("1.4.0"),
  sku: z.string(),                          // supplier's SKU
  ean: z.string().optional(),               // EAN-13 / UPC-A
  name: z.string(),
  description: z.string().optional(),
  category: z.string(),                     // supplier's category path (e.g. "Dairy/Cheese/Mozzarella")
  brand: z.string().optional(),
  unit: z.enum(["kg", "g", "l", "ml", "each", "pack", "case", "dozen"]),
  unitQuantity: z.number().positive().default(1), // e.g. case of 12
  unitDescription: z.string().optional(),   // "case of 12 x 500g"
  // Pricing — multiple tiers can be present; the cook's tier is resolved at order time
  pricing: z.array(z.object({
    tier: z.string(),                       // "retail" | "wholesale" | "tier-1" | "contract:xyz"
    priceUsdCents: z.number().int().positive(),
    currency: z.string().default("USD"),
    minQuantity: z.number().int().default(1),
    validFrom: z.string().datetime().optional(),
    validTo: z.string().datetime().optional(),
  })),
  // Availability
  inStock: z.boolean().default(true),
  stockQuantity: z.number().optional(),
  leadTimeDays: z.number().int().default(1),
  // Seasonality
  seasonalFrom: z.string().optional(),      // MM-DD
  seasonalTo: z.string().optional(),
  // Nutritional / origin metadata (optional, supplier-dependent)
  originCountry: z.string().length(2).optional(),
  organic: z.boolean().default(false),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
  updatedAt: z.string().datetime(),
});
```

### 4.2 `CanonicalInventory`

```typescript
export const CanonicalInventory = z.object({
  schemaVersion: z.literal("1.4.0"),
  sku: z.string(),
  warehouseCode: z.string().optional(),
  inStock: z.boolean(),
  quantity: z.number().optional(),
  // "available" = on-hand minus reserved; "on-hand" = physical
  quantityType: z.enum(["available", "on-hand", "reserved"]).default("available"),
  // Restock ETA for out-of-stock items
  expectedRestockAt: z.string().datetime().optional(),
  observedAt: z.string().datetime(),
  provider: z.string(),
});
```

### 4.3 `CanonicalPurchaseOrder`

```typescript
export const CanonicalPurchaseOrder = z.object({
  schemaVersion: z.literal("1.4.0"),
  poNumber: z.string(),                     // Eks-Food's PO number (deterministic from idempotencyKey)
  supplierPoNumber: z.string().optional(),  // supplier's PO reference (after acknowledgement)
  supplierCode: z.string(),
  buyerOrgId: z.string(),
  buyerAccountNumber: z.string(),
  lines: z.array(z.object({
    lineNo: z.number().int(),
    sku: z.string(),
    name: z.string(),
    quantity: z.number().positive(),
    unit: z.string(),
    unitPriceUsdCents: z.number().int().positive(),
    lineTotalUsdCents: z.number().int().positive(),
  })),
  subtotalUsdCents: z.number().int().positive(),
  taxUsdCents: z.number().int().default(0),
  shippingUsdCents: z.number().int().default(0),
  totalUsdCents: z.number().int().positive(),
  currency: z.string().default("USD"),
  status: z.enum(["draft", "submitted", "acknowledged", "picking", "shipped", "delivered", "cancelled", "rejected"]).default("draft"),
  requestedDeliveryDate: z.string().datetime(),
  shippingAddress: z.object({
    name: z.string(),
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    region: z.string().optional(),
    postcode: z.string().optional(),
    country: z.string().length(2),
  }),
  notes: z.string().optional(),
  submittedAt: z.string().datetime().optional(),
  acknowledgedAt: z.string().datetime().optional(),
  expectedDeliveryAt: z.string().datetime().optional(),
  shippedAt: z.string().datetime().optional(),
  deliveredAt: z.string().datetime().optional(),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
});
```

### 4.4 `CanonicalInvoice`

```typescript
export const CanonicalInvoice = z.object({
  schemaVersion: z.literal("1.4.0"),
  invoiceNumber: z.string(),
  supplierCode: z.string(),
  buyerOrgId: z.string(),
  poNumber: z.string().optional(),          // matched PO (if invoiceMatchingEnabled)
  lines: z.array(z.object({
    lineNo: z.number().int(),
    sku: z.string().optional(),
    description: z.string(),
    quantity: z.number().positive(),
    unitPriceUsdCents: z.number().int().positive(),
    lineTotalUsdCents: z.number().int().positive(),
  })),
  subtotalUsdCents: z.number().int().positive(),
  taxUsdCents: z.number().int().default(0),
  shippingUsdCents: z.number().int().default(0),
  totalUsdCents: z.number().int().positive(),
  currency: z.string().default("USD"),
  status: z.enum(["received", "matched", "disputed", "paid"]).default("received"),
  issuedAt: z.string().datetime(),
  dueAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
});
```

---

## 5. The Service Surface

```typescript
export const procurement = {
  // Catalogue
  searchCatalog(input: { supplierCode: string; q?: string; category?: string; brand?: string; limit?: number; offset?: number }): Promise<{ products: CanonicalProduct[]; total: number }>,
  getProduct(input: { supplierCode: string; sku: string }): Promise<CanonicalProduct>,
  listCategories(input: { supplierCode: string }): Promise<Array<{ code: string; name: string; parent?: string }>>,
  // Inventory
  getInventory(input: { supplierCode: string; skus: string[] }): Promise<CanonicalInventory[]>,
  // Purchase orders
  createPurchaseOrder(input: { supplierCode: string; po: Omit<CanonicalPurchaseOrder, "poNumber"|"supplierPoNumber"|"status"|"provider">; idempotencyKey: string }): Promise<CanonicalPurchaseOrder>,
  getPurchaseOrder(input: { supplierCode: string; poNumber: string }): Promise<CanonicalPurchaseOrder>,
  cancelPurchaseOrder(input: { supplierCode: string; poNumber: string; reason: string }): Promise<CanonicalPurchaseOrder>,
  // Invoices
  listInvoices(input: { supplierCode: string; from: Date; to: Date }): Promise<CanonicalInvoice[]>,
  // Delivery schedules
  getDeliveryWindows(input: { supplierCode: string; postalCode: string }): Promise<Array<{ startUtc: string; endUtc: string; cutoffUtc: string; service: string }>>,
  // Sync (internal — called by the scheduler)
  incrementalCatalogSync(input: { connectionId: string }): Promise<{ added: number; updated: number; removed: number; nextToken: string }>,
  incrementalInventorySync(input: { connectionId: string }): Promise<{ updated: number; nextToken: string }>,
};
```

---

## 6. Incremental Synchronization

Procurement data is sync-heavy. The catalogue and inventory are continuously refreshed; POs and invoices are event-driven (webhooks where supported, polling otherwise).

### 6.1 Catalogue sync

Catalogue sync runs every 6 hours (configurable via `ProviderConfiguration.config.schedule.catalogCron`). The flow:

1. The scheduler calls `incrementalCatalogSync` with the `ProcurementConnection.catalogSyncToken`.
2. The adapter fetches the supplier's catalogue delta (changed products since `catalogSyncToken`).
3. Each product is normalised to `CanonicalProduct`, validated against the Zod schema, and upserted into the M1 domain layer (`src/packages/domain/contexts/procurement/`).
4. The adapter returns `{ added, updated, removed, nextToken }` and the engine persists `nextToken` on `ProcurementConnection.catalogSyncToken`.
5. A `SynchronizationHistory` row records the run.

If the sync token is expired (supplier-side — varies, typically 30-90 days), the adapter triggers a `fullResync` automatically. A full sync for a 50k-SKU catalogue takes ~10 minutes via the M4 worker queue.

### 6.2 Inventory sync

Inventory sync runs every 30 minutes (default; configurable). Inventory is per-warehouse; the adapter fetches deltas for each warehouse the tenant is configured for.

Inventory sync is **append-only** in the canonical model: each observation is a new `CanonicalInventory` row with `observedAt`. Historical inventory is retained for trend analysis (the procurement planner uses 90-day inventory history to detect supply-tightening patterns).

### 6.3 PO status sync

POs are event-driven where the supplier supports webhooks (Sysco, Metro). For suppliers without webhooks (US Foods, local-market), the scheduler polls `getPurchaseOrder` every 15 minutes for any PO in `submitted` / `acknowledged` / `picking` / `shipped` status. Polling stops when the PO reaches `delivered` or a terminal state.

### 6.4 Invoice sync

Invoices are pushed by the supplier (webhook for Sysco/Metro; AS2 for EDI; SFTP drop for CSV). The `handleWebhook` method on the adapter (or the SFTP poller) ingests the invoice, normalises to `CanonicalInvoice`, matches against POs (per `ProcurementConnection.invoiceMatchStrategy`), and writes the result.

If matching fails, the invoice is marked `received` (not `matched`) and surfaced for manual review in the merchant module.

---

## 7. Conflict Detection

Procurement sync is one-directional (supplier → Eks-Food) for catalogue and inventory, so conflicts are rare. POs are bidirectional (Eks-Food → supplier for create/cancel; supplier → Eks-Food for status), so conflicts can occur:

- A cook cancels a PO at the same moment the supplier marks it `shipped`. The adapter receives the cancellation request and the shipment notification in the same window.
- The engine resolves this by **status precedence**: `shipped` > `cancelled` (a shipped PO cannot be cancelled; the cook must request a return after delivery). The adapter returns the current `CanonicalPurchaseOrder.status` and a `conflict` field with `{ requestedAction: "cancel", currentState: "shipped", resolution: "request_return" }`.

Conflicts are logged in `SynchronizationHistory.conflicts` and surfaced in the sync dashboard (see `CONNECTOR_OPERATIONS.md` §3).

---

## 8. Purchase Order Lifecycle

The end-to-end PO flow:

```typescript
import { procurement } from "@eks/connectors/procurement";

async function submitPurchaseOrder(cook: Cook, items: Array<{ sku: string; quantity: number }>): Promise<CanonicalPurchaseOrder> {
  // 1. Resolve current prices + inventory for each line
  const products = await Promise.all(items.map(i => procurement.getProduct({ supplierCode: "sysco", sku: i.sku })));
  const inventory = await procurement.getInventory({ supplierCode: "sysco", skus: items.map(i => i.sku) });

  // 2. Validate availability
  const outOfStock = items.filter((i, idx) => !inventory[idx].inStock);
  if (outOfStock.length) throw new Error(`Out of stock: ${outOfStock.map(i => i.sku).join(", ")}`);

  // 3. Resolve the cook's price tier (e.g. "contract:abc-123" or "wholesale")
  const tier = resolveCookTier(cook); // platform logic

  // 4. Build the canonical PO
  const po = {
    supplierCode: "sysco",
    buyerOrgId: cook.organizationId,
    buyerAccountNumber: cook.supplierAccountNumbers["sysco"],
    lines: items.map((i, idx) => ({
      lineNo: idx + 1,
      sku: i.sku,
      name: products[idx].name,
      quantity: i.quantity,
      unit: products[idx].unit,
      unitPriceUsdCents: products[idx].pricing.find(p => p.tier === tier)!.priceUsdCents,
      lineTotalUsdCents: products[idx].pricing.find(p => p.tier === tier)!.priceUsdCents * i.quantity,
    })),
    subtotalUsdCents: 0, // computed below
    taxUsdCents: 0,
    shippingUsdCents: 0,
    totalUsdCents: 0,
    currency: "USD",
    status: "draft",
    requestedDeliveryDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    shippingAddress: cook.kitchenAddress,
  };
  po.subtotalUsdCents = po.lines.reduce((s, l) => s + l.lineTotalUsdCents, 0);
  po.totalUsdCents = po.subtotalUsdCents;

  // 5. Submit via the connector (idempotent)
  const submitted = await procurement.createPurchaseOrder({
    supplierCode: "sysco",
    po,
    idempotencyKey: `cook:${cook.id}:po:${hashItems(items)}`,
  });

  // 6. Update cook's PO record (domain layer)
  await db.procurementPurchaseOrder.create({ data: { ...submitted } });

  return submitted;
}
```

The `idempotencyKey` ensures the PO is created exactly once even if the cook's client retries. The adapter derives a deterministic `poNumber` from the key — for Sysco, this is stored in the PO's `customerPO` field; for Metro, in `externalReference`; for CSV/SFTP suppliers, in a custom field on the file.

---

## 9. Per-Provider Implementation Notes

### 9.1 Sysco adapter (`sysco.ts`)

**Endpoints:**
- Catalogue: `https://api.sysco.com/catalog/v1.0/products` (with `If-Modified-Since` for delta)
- Inventory: `https://api.sysco.com/inventory/v1.0/stock`
- POs: `https://api.sysco.com/orders/v1.0/purchaseorders`
- Invoices: `https://api.sysco.com/invoices/v1.0/invoices`

**Auth:** OAuth2 client-credentials. Token cached in `ConnectorCache` under `oauth:tokens`, TTL = `expires_in - 60s`.

**Quirks:**
- Sysco's catalogue API returns pricing only for the cook's contracted tier; the `pricing[]` array in the canonical schema has one entry.
- PO submission is synchronous (returns immediately with a `supplierPoNumber`); status updates come via webhook (`ORDER_ACKNOWLEDGED`, `ORDER_SHIPPED`, `ORDER_DELIVERED`).
- Invoices are EDI 810 delivered via Sysco's B2B gateway; the adapter parses the EDI into `CanonicalInvoice`.

### 9.2 US Foods adapter (`us-foods.ts`)

**Endpoints:**
- Catalogue: `https://api.usfoods.com/v1/products`
- Inventory: `https://api.usfoods.com/v1/inventory`
- POs: `https://api.usfoods.com/v1/orders`

**Auth:** API key + HMAC signing (`us-foods` uses a custom signed-request scheme — API key in `Authorization`, HMAC-SHA256 of the request body in `X-USFoods-Signature`).

**Quirks:**
- No webhook support — the adapter polls PO status every 15 min for active POs.
- Catalogue updates are full-snapshot (no delta API); the adapter computes diffs client-side using the `updatedAt` field on each product. This is expensive for 50k SKUs; the scheduler runs at 6-hour cadence to amortise.
- Invoices are PDF emailed to a configured address; the SFTP poller pulls them, OCRs the line items, and normalises to `CanonicalInvoice`. OCR is best-effort — unmatched invoices are surfaced for manual review.

### 9.3 Metro Cash & Carry adapter (`metro.ts`)

**Endpoints:**
- Catalogue: `https://api.metro.com/v1/products`
- Inventory: `https://api.metro.com/v1/availability`
- POs: `https://api.metro.com/v1/orders`

**Auth:** OAuth2 client-credentials.

**Quirks:**
- Metro operates country-specific endpoints (`api.metro.de`, `api.metro.pl`, etc.). The adapter routes based on the cook's country.
- Catalogue is multi-language; the adapter fetches the cook's preferred language and stores it in `providerMetadata.language`.
- Metro's API uses GTIN (EAN-13) as the primary identifier; the adapter populates `ean` and derives `sku` from the supplier's article number.

### 9.4 CSV/SFTP adapter (`csv-sftp.ts`)

A generic adapter for suppliers that publish catalogues via daily CSV drops on SFTP. The adapter:

1. Connects to the configured SFTP server (credential on `ProviderCredential`, type `basic` with SSH key support).
2. Polls the configured directory every 6 hours for new files (`catalog-YYYYMMDD.csv`).
3. Parses the CSV via `papaparse`, applies the per-supplier column mapping (`ProviderConfiguration.config.columnMapping`).
4. Each row → `CanonicalProduct`. Adds new products, updates existing, marks missing products as `discontinued: true`.
5. Archives the processed file to `/processed/` on the SFTP server; failed files to `/failed/`.

The column mapping is per-supplier and configured at install time:

```json
{
  "columnMapping": {
    "sku": "article_number",
    "name": "product_description",
    "category": "department",
    "unit": "selling_unit",
    "priceUsdCents": { "column": "wholesale_price", "transform": "multiply_by_100" },
    "inStock": { "column": "availability_flag", "transform": "equals_Y" }
  }
}
```

### 9.5 EDI adapter (`edi-generic.ts`)

For suppliers that exchange EDI (X12 or EDIFACT) via AS2. The adapter:

1. Listens on the M4 webhook endpoint for inbound AS2 messages.
2. Verifies the AS2 signature (MDN).
3. Parses the EDI document via the `edi-parser` library.
4. Translates EDI 846 (Inventory) → `CanonicalInventory[]`, 850 (PO) → outbound `CanonicalPurchaseOrder`, 855 (PO Ack) → PO status update, 810 (Invoice) → `CanonicalInvoice`.

### 9.6 Local-market adapters (`gh-local.ts`, `ng-local.ts`)

For small regional suppliers with bespoke APIs. Each adapter is supplier-specific (e.g. Adu-Ghana has a REST API; MaxMart has a SOAP API). The adapter handles the idiosyncrasies; the canonical schema hides them from business code.

These adapters share a common pattern:

- Auth: API key in a custom header (`X-Adu-Key` for Adu-Ghana, etc.).
- Catalogue: full snapshot every 24 hours (small catalogues, ~500 SKUs).
- Inventory: not supported (`supported = false` for `getInventory` capability — cook must call the supplier directly to confirm availability).
- POs: not supported — these suppliers operate on phone/email orders; the connector syncs catalogue and pricing only.

---

## 10. Caching Strategy

| Capability | Namespace | TTL | Notes |
|---|---|---|---|
| `search-catalog` | `po-catalog-search:v1` | 1 h | Search results are derived; TTL is short to reflect pricing changes |
| `get-product` | `po-product:v1` | 1 h | Same |
| `list-categories` | `po-cats:v1` | 24 h | Categories change rarely |
| `get-inventory` | `po-inventory:v1` | 5 min | Inventory changes frequently; 5 min balances freshness vs quota |
| `get-po` | `po-po:v1` | 1 min | POs change frequently during fulfilment |
| `list-invoices` | `po-invoices:v1` | 5 min | New invoices arrive via webhook; cache invalidation on webhook |
| `get-delivery-windows` | `po-delivery:v1` | 24 h | Delivery windows change weekly |

Inventory cache is **per-warehouse**. A cook querying 5 SKUs across 3 warehouses results in 15 cache lookups (or 15 supplier calls on a cold cache).

---

## 11. Worked Example — Substitution Recommendation

When a cook's first-choice supplier is out of a SKU, the procurement connector surfaces alternatives:

```typescript
import { procurement } from "@eks/connectors/procurement";

async function findSubstitution(orgId: string, sku: string, supplierCode: string): Promise<CanonicalProduct[]> {
  // 1. Get the original product to know what we're substituting
  const original = await procurement.getProduct({ supplierCode, sku });

  // 2. Get all installed suppliers for this tenant
  const suppliers = await db.procurementConnection.findMany({ where: { organizationId: orgId, status: "ACTIVE" } });

  // 3. Search each supplier's catalogue for similar products (by category + brand)
  const candidates: CanonicalProduct[] = [];
  for (const s of suppliers) {
    const results = await procurement.searchCatalog({
      supplierCode: s.supplierCode,
      category: original.category,
      brand: original.brand,
      limit: 5,
    });
    candidates.push(...results.products);
  }

  // 4. Filter by current availability
  const withInventory = await Promise.all(
    candidates.map(async p => ({
      product: p,
      inventory: await procurement.getInventory({ supplierCode: p.provider, skus: [p.sku] }),
    })),
  );
  const inStock = withInventory.filter(x => x.inventory[0]?.inStock).map(x => x.product);

  // 5. Rank by price + brand match + unit equivalence
  return rankSubstitutions(original, inStock);
}
```

This call fans out across suppliers. The selection engine does NOT route this — it's a fan-out, not a single-provider call. The fan-out is parallel via `Promise.all`; the cache hit rate is typically high because cooks repeatedly query the same SKUs.

---

## 12. Operations

### 12.1 Sync dashboard

The sync dashboard (see `CONNECTOR_OPERATIONS.md` §3) is the primary ops surface for procurement. Per-connection, it shows:

- Catalogue sync: last run, next scheduled, records added/updated/removed, sync token age.
- Inventory sync: last run, next scheduled, records updated, lag from supplier.
- PO status sync: in-flight POs, last status update, stuck POs (> 2 h without status change).
- Invoice sync: invoices received (24h), invoices matched, invoices pending manual review.

### 12.2 Quota

Procurement APIs are typically generous (Sysco: 10k calls/hour; Metro: 5k calls/hour). The main cost driver is the catalogue full-resync, which can hit 50k calls for a large supplier. The scheduler runs full syncs overnight to avoid peak-hour rate limits.

### 12.3 Invoice matching

The invoice-matching view (in the merchant module) shows invoices that didn't auto-match. Common causes:

- Supplier's `invoice.poNumber` doesn't match Eks-Food's `poNumber` (the supplier used their own reference). Operator manually links the invoice to the PO.
- Line items don't match (substituted SKU, quantity change). Operator reviews and approves the difference.
- Duplicate invoice (same `invoiceNumber` from the same supplier). The engine deduplicates by `(supplierCode, invoiceNumber)` and surfaces duplicates for investigation.

### 12.4 Catalogue drift

The catalogue-sync job tracks "drift" — products that have changed price > 20% in the last 30 days. The procurement planner surfaces these in the cook's catalogue view ("prices volatile — consider locking in a contract"). The drift computation runs as a nightly batch on the M1 worker queue.

---

## 13. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Persisting supplier SKUs across suppliers | Cook switches suppliers; SKU lookup fails | Use the canonical `ean` for cross-supplier matching; per-supplier SKUs are provider-specific |
| Submitting POs without checking inventory | PO rejected by supplier; cook waits days for the rejection | Always call `getInventory` before `createPurchaseOrder`; the connector doesn't enforce this |
| Treating catalogue pricing as fixed | Cook sees stale price at checkout; disputes invoice | Catalogue sync is every 6 h; re-fetch price at PO submission time |
| Syncing inventory for all warehouses | Quota burn; most warehouses are irrelevant | Configure `catalogScope` and `inventoryWarehouses` on the connection |
| Trusting supplier lead times as deterministic | Cook plans prep around a delivery that arrives 2 days late | Use `expectedDeliveryAt` from the PO acknowledgement, not the catalogue's `leadTimeDays` |
| Hardcoding EDI field positions | Supplier changes their EDI format; parser breaks | Use the EDI segment/element lookup, not positional indexing |
| Skipping invoice matching for small invoices | $5 invoices accumulate; month-end reconciliation is a nightmare | Match all invoices, regardless of size; manual review cost is fixed per invoice |
| Assuming webhook delivery for PO status | US Foods doesn't have webhooks; POs stuck in `submitted` for days | Poll every 15 min for suppliers without webhooks |

---

## 14. Further Reading

- `PROVIDER_DEVELOPMENT.md` — the adapter authoring pattern.
- `PROVIDER_SELECTION.md` — the `cost-aware` strategy used for procurement.
- `CONNECTOR_OPERATIONS.md` — sync dashboard, invoice matching, catalogue drift.
- `RESTAURANT_MERCHANT.md` — invoice matching flows into the merchant module's invoicing surface.
- `DISASTER_RECOVERY.md` — procurement-specific DR (supplier outage, sync token corruption, PO stuck in transit).
- `docs/integration/SYNCHRONIZATION_GUIDE.md` — the M4 sync engine (underlying incremental sync).
- `docs/integration/TRANSFORMATION_GUIDE.md` — the CSV/XML/EDI normalisation pipeline.
