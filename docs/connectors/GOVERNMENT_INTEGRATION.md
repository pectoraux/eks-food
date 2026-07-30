# Eks-Food Connector Ecosystem — Government Integration Guide

> **Audience:** Platform engineers building regulatory compliance features, ops engineers monitoring government-data sync, integration partners adding a country plugin. Read alongside `PROVIDER_DEVELOPMENT.md`, `PROVIDER_SELECTION.md`, `CONNECTOR_OPERATIONS.md`, and the per-category guides.
>
> **Status:** Milestone 5. This document covers the **government** category of the `@eks/connectors` package (`src/packages/connectors/government/`), its country-specific plugin architecture, the canonical schemas, the regional-exact routing strategy, and the compliance-verification workflows. Crucially: Eks-Food does **not** hardcode any country's government APIs. Country support is added via plugins without code changes to the engine.

---

## 1. Why Government Integration Matters to Eks-Food

Food-service operations are heavily regulated. Eks-Food's government connector ecosystem automates the compliance surface:

- **Business registration** — verifies the cook's business is registered with the relevant authority (Ghana Revenue Authority, Nigerian CAC, Kenya Business Registration Service).
- **Food establishment licensing** — verifies the cook's kitchen has a valid food-handling permit (Ghana FDA, NAFDAC in Nigeria, KEBS in Kenya).
- **Food handler certifications** — verifies each cook (and their staff) holds a valid food handler certificate; tracks expiry; surfaces recertification prompts.
- **Inspection databases** — syncs the authority's inspection history for the establishment (pass/fail, violations, corrective actions). The M2 inspection module (`src/packages/domain/contexts/safety/`) consumes this.
- **Regulatory notices** — subscribes to notices from the authority (recall notices, regulation changes, advisory bulletins). The notifications module fans these out to affected cooks.
- **Tax registration** — verifies the cook's tax ID (TIN in Ghana, NTN in Nigeria, KRA PIN in Kenya); pulls VAT registration status.
- **Compliance verification** — the M2 verification module (`@eks/verification`) uses the government connector to perform documentless verification (no PDFs, no manual entry — the connector queries the authority directly).

Each government call goes through `government.<method>()` from `@eks/connectors/government`. The selection engine uses the `region-exact` strategy — a Ghana-region request never routes to a Nigerian provider.

---

## 2. The Plugin Architecture (No Hardcoded Country APIs)

Eks-Food does not ship a single "Ghana FDA adapter" or "Nigeria NAFDAC adapter". Instead, it ships a **plugin system**: each country has a plugin (a directory under `src/packages/connectors/government/plugins/<country>/`) that registers one or more providers with the engine. Adding a country is a plugin-drop, not an engine change.

### 2.1 The plugin contract

```typescript
// src/packages/connectors/government/plugin.ts
export interface GovernmentPlugin {
  readonly countryCode: string;        // ISO-3166-1 alpha-2, e.g. "GH"
  readonly displayName: string;        // "Ghana"
  readonly authorities: ReadonlyArray<{
    code: string;                      // "ghana-fda", "gra", "ghana-tin"
    displayName: string;               // "Ghana Food and Drugs Authority"
    authorityType: string;             // "food-safety" | "tax" | "business-registration" | "inspection" | "health"
    capabilities: readonly string[];   // subset of GOV_CAPABILITIES (see §3.2)
  }>;
  /** Register adapters for this plugin's authorities with the engine. */
  register(engine: GovernmentEngine): void;
}
```

### 2.2 Plugin discovery

Plugins are auto-discovered at runtime via a directory scan in `src/packages/connectors/government/index.ts`:

```typescript
import { readdirSync } from "node:fs";
import { join } from "node:path";

const pluginsDir = join(__dirname, "plugins");
for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const plugin = require(join(pluginsDir, entry.name, "index.ts")).default as GovernmentPlugin;
  plugin.register(engine);
  engine.registerPlugin(plugin);
}
```

To add a country: create `src/packages/connectors/government/plugins/<country>/index.ts`, implement the `GovernmentPlugin` interface, and the engine picks it up on next restart. No core code changes.

### 2.3 The current plugin set

Eks-Food ships plugins for the four launch markets:

| Plugin | Country | Authorities |
|---|---|---|
| `plugins/gh/` | Ghana | Ghana FDA (food-safety), GRA (tax), RGD (business-registration), FDA-inspections (inspection), GHS (health) |
| `plugins/ng/` | Nigeria | NAFDAC (food-safety), FIRS (tax), CAC (business-registration), NAFDAC-inspections (inspection) |
| `plugins/ke/` | Kenya | KEBS (food-safety), KRA (tax), BRS (business-registration), KEBS-inspections (inspection) |
| `plugins/za/` | South Africa | SABS (food-safety), SARS (tax), CIPC (business-registration), DOH-inspections (inspection) |

Each plugin registers its authorities as `ExternalProvider` rows (in the catalog seed) and provides adapter implementations for the capabilities each authority supports. A single authority may support multiple capabilities (e.g. Ghana FDA supports `verify-license`, `list-inspections`, `subscribe-notices`).

---

## 3. The Canonical Schema

### 3.1 `CanonicalEstablishmentLicense`

```typescript
export const CanonicalEstablishmentLicense = z.object({
  schemaVersion: z.literal("1.1.0"),
  licenseNumber: z.string(),
  establishmentName: z.string(),
  establishmentType: z.enum(["restaurant", "kitchen", "catering", "food-truck", "market-stall", "home-based", "other"]),
  ownerName: z.string(),
  ownerNationalId: z.string().optional(),       // masked
  address: z.object({
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    region: z.string().optional(),
    postcode: z.string().optional(),
    country: z.string().length(2),
  }),
  authorityCode: z.string(),                    // "ghana-fda", "nafdac", etc.
  licenseType: z.string(),                      // "food-handling-permit", "catering-permit", etc.
  status: z.enum(["active", "suspended", "revoked", "expired", "pending"]),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  conditions: z.array(z.string()).default([]),  // license-specific operating conditions
  inspectionRequired: z.boolean().default(true),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
  verifiedAt: z.string().datetime(),
});
```

### 3.2 `CanonicalFoodHandlerCertificate`

```typescript
export const CanonicalFoodHandlerCertificate = z.object({
  schemaVersion: z.literal("1.1.0"),
  certificateNumber: z.string(),
  holderName: z.string(),
  holderNationalId: z.string().optional(),      // masked
  authorityCode: z.string(),
  certificateType: z.string(),                  // "basic-food-hygiene", "advanced-food-safety", etc.
  status: z.enum(["active", "expired", "revoked", "pending"]),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  trainingProvider: z.string().optional(),
  provider: z.string(),
  verifiedAt: z.string().datetime(),
});
```

### 3.3 `CanonicalInspection`

```typescript
export const CanonicalInspection = z.object({
  schemaVersion: z.literal("1.1.0"),
  inspectionId: z.string(),                     // authority's inspection ID
  establishmentLicenseNumber: z.string(),
  authorityCode: z.string(),
  inspectionType: z.enum(["routine", "complaint", "follow-up", "pre-licensing", "random"]),
  status: z.enum(["scheduled", "in-progress", "completed", "cancelled"]),
  result: z.enum(["pass", "pass-with-observations", "fail", "pending"]).optional(),
  scheduledAt: z.string().datetime().optional(),
  conductedAt: z.string().datetime().optional(),
  reportedAt: z.string().datetime().optional(),
  inspectorName: z.string().optional(),
  violations: z.array(z.object({
    code: z.string(),
    description: z.string(),
    severity: z.enum(["minor", "major", "critical"]),
    correctiveAction: z.string().optional(),
    resolvedAt: z.string().datetime().optional(),
  })).default([]),
  score: z.number().min(0).max(100).optional(),
  reportUrl: z.string().optional(),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
});
```

### 3.4 `CanonicalRegulatoryNotice`

```typescript
export const CanonicalRegulatoryNotice = z.object({
  schemaVersion: z.literal("1.1.0"),
  noticeId: z.string(),
  authorityCode: z.string(),
  noticeType: z.enum(["recall", "regulation-change", "advisory", "alert", "policy-update"]),
  severity: z.enum(["info", "warning", "critical"]),
  headline: z.string(),
  summary: z.string(),
  details: z.string(),
  affectedProducts: z.array(z.object({
    name: z.string(),
    batch: z.string().optional(),
    barcode: z.string().optional(),
  })).default([]),
  affectedEstablishments: z.array(z.string()).default([]), // license numbers; empty = all
  publishedAt: z.string().datetime(),
  effectiveAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  sourceUrl: z.string().optional(),
  provider: z.string(),
});
```

### 3.5 `CanonicalBusinessRegistration`

```typescript
export const CanonicalBusinessRegistration = z.object({
  schemaVersion: z.literal("1.1.0"),
  registrationNumber: z.string(),
  businessName: z.string(),
  businessType: z.enum(["sole-proprietor", "partnership", "llc", "corporation", "cooperative", "non-profit"]),
  ownerName: z.string(),
  taxId: z.string().optional(),
  vatNumber: z.string().optional(),
  registrationDate: z.string().datetime(),
  status: z.enum(["active", "dissolved", "suspended"]),
  authorityCode: z.string(),
  address: z.object({
    line1: z.string(),
    city: z.string(),
    country: z.string().length(2),
  }),
  provider: z.string(),
  verifiedAt: z.string().datetime(),
});
```

### 3.6 The capability taxonomy

```typescript
export const GOV_CAPABILITIES = [
  "verify-business-registration",
  "verify-tax-registration",
  "verify-license",                 // food establishment license
  "verify-certificate",             // food handler certificate
  "list-inspections",
  "get-inspection",
  "subscribe-notices",
  "list-notices",
  "search-establishments",
] as const;
```

---

## 4. The Prisma Model

The `GovernmentConnection` model records the per-tenant regulatory context. One row per (organisation, authority) pair — a tenant operating in Ghana will have multiple rows (one for Ghana FDA, one for GRA, one for RGD).

```prisma
model GovernmentConnection {
  id              String   @id @default(cuid())
  organizationId  String
  providerConfigId String  // → ProviderConfiguration.id
  countryCode     String   // ISO-3166-1 alpha-2
  authorityCode   String   // "ghana-fda", "nafdac", etc.
  authorityType   String   // "food-safety" | "tax" | "business-registration" | "inspection" | "health"
  // The tenant's registered IDs at this authority
  establishmentLicenseNumber String?
  businessRegistrationNumber  String?
  taxId                       String?
  // Sync state
  lastInspectionSyncAt DateTime?
  inspectionSyncToken   String?
  lastNoticeSyncAt      DateTime?
  noticeSyncToken       String?
  // Notice subscriptions
  noticeSubscriptions String @default("[\"recall\",\"alert\",\"regulation-change\"]")
  // Status
  status          String   @default("ACTIVE") // ACTIVE | PAUSED | ERROR | UNCONFIGURED
  lastError       String?
  connectedAt     DateTime @default(now())
  updatedAt       DateTime @updatedAt

  provider        ProviderConfiguration @relation(fields: [providerConfigId], references: [id])

  @@unique([organizationId, authorityCode])
  @@index([organizationId, countryCode])
}
```

---

## 5. The Service Surface

```typescript
export const government = {
  // Verification (synchronous)
  verifyBusinessRegistration(input: { countryCode: string; registrationNumber: string }): Promise<CanonicalBusinessRegistration>,
  verifyTaxRegistration(input: { countryCode: string; taxId: string }): Promise<{ registered: boolean; vatRegistered: boolean; verifiedAt: string; provider: string }>,
  verifyLicense(input: { countryCode: string; licenseNumber: string }): Promise<CanonicalEstablishmentLicense>,
  verifyCertificate(input: { countryCode: string; certificateNumber: string }): Promise<CanonicalFoodHandlerCertificate>,

  // Inspection data (sync-driven)
  listInspections(input: { countryCode: string; establishmentLicenseNumber: string; from?: Date; to?: Date }): Promise<CanonicalInspection[]>,
  getInspection(input: { countryCode: string; inspectionId: string }): Promise<CanonicalInspection>,

  // Regulatory notices
  listNotices(input: { countryCode: string; authorityCode?: string; from?: Date; to?: Date; types?: string[] }): Promise<CanonicalRegulatoryNotice[]>,
  subscribeNotices(input: { connectionId: string; types: string[] }): Promise<void>,

  // Establishment search (for inspection lookup by address/name)
  searchEstablishments(input: { countryCode: string; q: string; city?: string }): Promise<CanonicalEstablishmentLicense[]>,

  // Sync (internal — called by the scheduler)
  incrementalInspectionSync(input: { connectionId: string }): Promise<{ added: number; nextToken: string }>,
  incrementalNoticeSync(input: { connectionId: string }): Promise<{ added: number; nextToken: string }>,
};
```

Every call requires `countryCode`. The selection engine's `region-exact` strategy routes to the plugin(s) registered for that country — never across countries.

---

## 6. The Plugin Authoring Pattern

A new country plugin is a self-contained directory. Example skeleton for a fictional "Togo" plugin:

```
src/packages/connectors/government/plugins/tg/
├── index.ts                          (plugin definition)
├── authorities/
│   ├── anam.ts                       (Agence Nationale de Sécurité Sanitaire — food safety)
│   ├── otr.ts                        (Office des Timbres et Recettes — tax)
│   └── ccrm.ts                       (Centre de Formalités des Entreprises — business reg)
├── __tests__/
│   └── anam.spec.ts
└── __fixtures__/
    └── anam/
        ├── verify-license-success.json
        └── verify-license-not-found.json
```

### 6.1 The plugin entry point

```typescript
// src/packages/connectors/government/plugins/tg/index.ts
import type { GovernmentPlugin } from "../../plugin";
import { anamAdapter } from "./authorities/anam";
import { otrAdapter } from "./authorities/otr";
import { ccrmAdapter } from "./authorities/ccrm";

const tgPlugin: GovernmentPlugin = {
  countryCode: "TG",
  displayName: "Togo",
  authorities: [
    { code: "tg-anam", displayName: "Agence Nationale de Sécurité Sanitaire", authorityType: "food-safety", capabilities: ["verify-license", "list-inspections", "subscribe-notices"] },
    { code: "tg-otr",  displayName: "Office des Timbres et Recettes", authorityType: "tax", capabilities: ["verify-tax-registration"] },
    { code: "tg-ccrm", displayName: "Centre de Formalités des Entreprises", authorityType: "business-registration", capabilities: ["verify-business-registration", "search-establishments"] },
  ],
  register(engine) {
    engine.registerAuthority("tg-anam", anamAdapter);
    engine.registerAuthority("tg-otr", otrAdapter);
    engine.registerAuthority("tg-ccrm", ccrmAdapter);
  },
};

export default tgPlugin;
```

### 6.2 The authority adapter

Each authority adapter implements the `ProviderAdapter` interface from §4 of `PROVIDER_DEVELOPMENT.md`. The ANAM (Togo food safety) adapter:

```typescript
// src/packages/connectors/government/plugins/tg/authorities/anam.ts
import { z } from "zod";
import type { ProviderAdapter } from "../../../types";
import type { CanonicalEstablishmentLicense, CanonicalInspection, CanonicalRegulatoryNotice } from "../../../types";

export const AnamConfig = z.object({
  baseUrl: z.string().url().default("https://api.anam.tg/v1"),
  timeoutMs: z.number().int().min(1000).max(30_000).default(10_000),
});
export type AnamConfigT = z.infer<typeof AnamConfig>;

export const AnamCredentialSchema = z.object({
  apiKey: z.string().min(16).max(128),
  clientId: z.string().min(8).max(64),
});

export const anamAdapter: ProviderAdapter<unknown, "verify-license" | "list-inspections" | "subscribe-notices"> = {
  providerCode: "tg-anam",
  category: "government",
  name: "ANAM Togo",
  code: "tg-anam",
  supportedCalls: ["verify-license", "list-inspections", "subscribe-notices"],

  async authenticate(ctx) {
    const cfg = AnamConfig.parse(ctx.config.config);
    const creds = AnamCredentialSchema.parse(ctx.config.credentials);
    const res = await fetch(`${cfg.baseUrl}/auth/verify`, {
      headers: { "X-API-Key": creds.apiKey, "X-Client-Id": creds.clientId },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    return { ok: res.ok, detail: res.ok ? undefined : `anam_${res.status}` };
  },

  async invoke(ctx, kind, input) {
    const cfg = AnamConfig.parse(ctx.config.config);
    const creds = AnamCredentialSchema.parse(ctx.config.credentials);
    const headers = { "X-API-Key": creds.apiKey, "X-Client-Id": creds.clientId };

    try {
      if (kind === "verify-license") {
        const { licenseNumber } = input as { licenseNumber: string };
        const res = await fetch(`${cfg.baseUrl}/licenses/${encodeURIComponent(licenseNumber)}`, {
          headers, signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        if (res.status === 404) return { ok: true, value: null };
        if (!res.ok) return { ok: false, error: `anam_${res.status}`, retryable: res.status >= 500 };
        return { ok: true, value: await res.json() };
      }
      if (kind === "list-inspections") {
        const { establishmentLicenseNumber, from, to } = input as { establishmentLicenseNumber: string; from?: string; to?: string };
        const url = new URL(`${cfg.baseUrl}/inspections`);
        url.searchParams.set("license", establishmentLicenseNumber);
        if (from) url.searchParams.set("from", from);
        if (to) url.searchParams.set("to", to);
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(cfg.timeoutMs) });
        if (!res.ok) return { ok: false, error: `anam_${res.status}`, retryable: res.status >= 500 };
        return { ok: true, value: await res.json() };
      }
      if (kind === "subscribe-notices") {
        // Notifies ANAM to push notices to our webhook
        const res = await fetch(`${cfg.baseUrl}/notices/subscribe`, {
          method: "POST", headers,
          body: JSON.stringify({ callbackUrl: "https://eks-food.com/api/v1/providers/government/webhook/tg-anam" }),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        if (!res.ok) return { ok: false, error: `anam_${res.status}`, retryable: res.status >= 500 };
        return { ok: true, value: await res.json() };
      }
      return { ok: false, error: `anam_unsupported:${kind}`, retryable: false };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
    }
  },

  normalize(kind, raw) {
    if (kind === "verify-license") {
      if (!raw) return null;
      const r = raw as AnamLicenseResponse;
      const license: CanonicalEstablishmentLicense = {
        schemaVersion: "1.1.0",
        licenseNumber: r.numero_licence,
        establishmentName: r.nom_etablissement,
        establishmentType: mapAnamType(r.type_etablissement),
        ownerName: r.proprietaire,
        address: {
          line1: r.adresse, city: r.ville, region: r.region, country: "TG",
        },
        authorityCode: "tg-anam",
        licenseType: r.type_permis,
        status: mapAnamStatus(r.statut),
        issuedAt: new Date(r.date_delivrance).toISOString(),
        expiresAt: new Date(r.date_expiration).toISOString(),
        conditions: r.conditions ?? [],
        inspectionRequired: r.controle_periodique ?? true,
        provider: "tg-anam",
        verifiedAt: new Date().toISOString(),
      };
      return license as unknown as CanonicalEstablishmentLicense;
    }
    // … other normalisations …
    return raw as unknown as CanonicalInspection;
  },

  async mapSchema(_ctx, source) { return source; },
  async poll(_ctx) { return { records: [], hasMore: false }; },
  async sync(_ctx) {
    return { recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0, recordsDeleted: 0, conflicts: 0, errors: [] };
  },
  async healthCheck(ctx) {
    const start = Date.now();
    const r = await this.authenticate!(ctx);
    return { healthy: r.ok, latencyMs: Date.now() - start, detail: r.detail };
  },
};

function mapAnamType(t: string): CanonicalEstablishmentLicense["establishmentType"] {
  switch (t) {
    case "restaurant": return "restaurant";
    case "cuisine": return "kitchen";
    case "traiteur": return "catering";
    default: return "other";
  }
}

function mapAnamStatus(s: string): CanonicalEstablishmentLicense["status"] {
  switch (s) {
    case "valide": return "active";
    case "suspendu": return "suspended";
    case "retire": return "revoked";
    case "expire": return "expired";
    default: return "pending";
  }
}
```

---

## 7. The Compliance Verification Workflow

When a cook signs up (or a regulatory checkpoint fires), the M2 `@eks/verification` module uses the government connector to perform documentless verification.

```typescript
import { government } from "@eks/connectors/government";
import { verify } from "@eks/verification";

async function verifyCookCompliance(cook: Cook): Promise<VerificationResult> {
  const results: VerificationResult = {
    businessRegistration: "unknown",
    foodLicense: "unknown",
    foodHandlerCertificate: "unknown",
    taxRegistration: "unknown",
  };

  // 1. Verify business registration
  try {
    const reg = await government.verifyBusinessRegistration({
      countryCode: cook.countryCode,
      registrationNumber: cook.businessRegistrationNumber,
    });
    results.businessRegistration = reg.status === "active" ? "verified" : "failed";
  } catch (e) {
    results.businessRegistration = "unknown";
  }

  // 2. Verify food establishment license
  try {
    const license = await government.verifyLicense({
      countryCode: cook.countryCode,
      licenseNumber: cook.establishmentLicenseNumber,
    });
    results.foodLicense = license.status === "active" && new Date(license.expiresAt) > new Date() ? "verified" : "failed";
  } catch (e) {
    results.foodLicense = "unknown";
  }

  // 3. Verify food handler certificate
  try {
    const cert = await government.verifyCertificate({
      countryCode: cook.countryCode,
      certificateNumber: cook.foodHandlerCertificateNumber,
    });
    results.foodHandlerCertificate = cert.status === "active" && new Date(cert.expiresAt) > new Date() ? "verified" : "failed";
  } catch (e) {
    results.foodHandlerCertificate = "unknown";
  }

  // 4. Verify tax registration
  try {
    const tax = await government.verifyTaxRegistration({
      countryCode: cook.countryCode,
      taxId: cook.taxId,
    });
    results.taxRegistration = tax.registered ? "verified" : "failed";
  } catch (e) {
    results.taxRegistration = "unknown";
  }

  return results;
}
```

The verification result is recorded on the M2 `VerificationRequest` model (`docs/identity/VERIFICATION.md`). A cook with any "failed" status is blocked from receiving bookings until resolved; "unknown" is allowed but flagged for manual review.

---

## 8. Inspection Sync

Inspection data is sync-driven. The scheduler runs `incrementalInspectionSync` daily for each `ACTIVE` `GovernmentConnection` with an `authorityType` of `inspection` (or `food-safety` for authorities that combine licensing + inspections, like Ghana FDA).

The sync flow:

1. The adapter calls the authority's inspections endpoint with `inspectionSyncToken` (a date-based or sequence-based cursor).
2. New inspections are normalised to `CanonicalInspection`, validated, and upserted into the M2 inspection module (`src/packages/domain/contexts/safety/`).
3. The adapter returns `{ added, nextToken }` and the engine persists `nextToken`.

A new inspection with `result = "fail"` triggers:

1. A `GovernmentInspectionFailed` event on the M1 `EventOutbox`.
2. The notifications module sends an alert to the cook (push + SMS).
3. The matching engine down-weights the cook's bookings for 7 days (or until a follow-up inspection passes).
4. The merchant module surfaces the failure on any active catering contracts with the cook — the operator can decide whether to terminate.

---

## 9. Regulatory Notice Subscription

Regulatory notices (recalls, alerts, regulation changes) are delivered via webhook where supported, or polled daily otherwise.

### 9.1 Webhook subscription

```typescript
// At GovernmentConnection activation:
await government.subscribeNotices({
  connectionId,
  types: ["recall", "alert", "regulation-change"],
});
```

The adapter calls the authority's subscription endpoint with the Eks-Food webhook URL. The authority pushes notices to `/api/v1/providers/government/webhook/<authorityCode>`.

### 9.2 Polling fallback

For authorities without webhook support (e.g. NAFDAC), the scheduler polls `listNotices` every 24 hours. The adapter tracks `lastNoticeSyncAt` and queries for notices published since then.

### 9.3 Notice routing

On receipt, the notice is normalised to `CanonicalRegulatoryNotice`, persisted, and routed:

- **Recall notices** with `affectedProducts` → matched against the cook's recent procurement POs (via the procurement connector). Affected cooks are notified immediately (severity = critical).
- **Recall notices** with `affectedEstablishments` → matched against cook license numbers. Affected cooks are notified.
- **Advisory notices** → routed to the notifications module for fan-out to all cooks in the country.
- **Regulation changes** → routed to the operations team for review; surfaced in the cook's "regulatory updates" inbox.

---

## 10. Regional-Exact Routing

The selection engine's `region-exact` strategy for government means:

1. A request with `countryCode = "GH"` only considers providers with `ProviderRegion.region = "GH"`.
2. There is no cross-country fallback. If all Ghana authorities are unavailable, the call returns `NO_PROVIDER_AVAILABLE_FOR_REGION`.
3. The business surface must handle this gracefully (see §11).

This strictness is intentional: querying a Nigerian authority for a Ghana license number is nonsensical and would always return 404. The engine doesn't waste a provider call on it.

### 10.1 The "UNCONFIGURED" status

If a tenant operates in a country for which Eks-Food has no plugin (e.g. a tenant from Côte d'Ivoire before the `ci` plugin ships), the `GovernmentConnection` row is created with `status = UNCONFIGURED`. The compliance verification workflow returns "unknown" for all checks, and the cook is flagged for manual review.

The operations dashboard surfaces "UNCONFIGURED" connections prominently — adding a new country plugin is a tracked priority.

---

## 11. Graceful Degradation

Government connectors fail. The authority's API may be down, the cook's credentials may have expired, or the verification may time out. The business surface must degrade gracefully:

| Failure | Behaviour |
|---|---|
| Authority API down (5xx, timeout) | Verification returns "unknown"; cook is allowed but flagged for manual review |
| License not found (404) | Verification returns "failed"; cook is blocked from new bookings |
| License expired (status = expired) | Verification returns "failed"; cook is blocked; surfaced for recertification |
| License suspended | Verification returns "failed"; cook is blocked; surfaced for dispute |
| Credential expired (AUTH_FAILED) | Verification returns "unknown"; operator alerted to rotate credentials |
| Network error | Verification returns "unknown"; retried on next cook login |

The principle: **never block a cook for an infrastructure failure**. Verification "unknown" is acceptable; verification "failed" requires a positive signal from the authority.

---

## 12. Operations

### 12.1 Health monitoring

The M4 `HealthMonitor` calls each adapter's `healthCheck` every 5 min (government endpoints are slower and less critical than maps/weather). A health-check failure transitions `ProviderHealth.status = DEGRADED` after 2 consecutive failures, `UNHEALTHY` after 5.

### 12.2 Notice flood

A major recall can trigger hundreds of notices in minutes. The webhook handler is rate-limited (10 notices/sec per authority) to prevent flooding the notifications module. Bursts above the rate limit are queued and processed with a 1-second back-off.

### 12.3 Inspection backlog

The sync dashboard surfaces "stale" connections — those where `lastInspectionSyncAt` is older than 48 hours. A stale connection usually means the authority's API is down; the operator can manually trigger a sync or wait for recovery.

### 12.4 Plugin versioning

Country plugins are versioned with the `@eks/connectors` package. A plugin update (e.g. an authority changes its API endpoint) is shipped as a new package version; the operator upgrades via `POST /api/v1/providers/cfg_abc/upgrade` with the new version. The engine handles the upgrade atomically: old version deactivated, schema migrations run, new version activated.

---

## 13. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Hardcoding authority URLs in business code | Plugin update requires code changes | All authority URLs live in plugin adapters; business code calls the typed surface |
| Treating "unknown" verification as failure | Cooks blocked by transient authority outages | "unknown" allows operation with flag; only "failed" blocks |
| Persisting inspection data without `verifiedAt` | Stale inspection treated as current | Always include `verifiedAt`; downstream code can detect staleness |
| Failing open on license-expiry edge cases | A license expiring at midnight blocks a cook booking at 12:01 am | Use `expiresAt > now + 24h` for verification; surface upcoming expiry as a warning |
| Assuming webhook delivery for notices | NAFDAC doesn't have webhooks; notices arrive 24h late | Always run the polling fallback; webhooks are an optimisation, not a guarantee |
| Calling a country plugin from a different country's request | 404 from the authority | The `region-exact` strategy prevents this; if you see it, file a bug |
| Storing unmasked national IDs in logs | PII leak; compliance violation | National IDs are masked in logs (first 4 + last 4); full value is encrypted in `ProviderCredential` |
| Adding a new country without fixture tests | Plugin ships with normalisation bugs | Every adapter must have fixture tests (see §6) |

---

## 14. Further Reading

- `PROVIDER_DEVELOPMENT.md` — the adapter authoring pattern (the `invoke`/`normalize`/`healthCheck` contract).
- `PROVIDER_SELECTION.md` — the `region-exact` strategy used for government.
- `CONNECTOR_OPERATIONS.md` — sync dashboard, notice flood handling, inspection backlog.
- `DISASTER_RECOVERY.md` — government-specific DR (authority outage, credential expiry, stale data recovery).
- `docs/identity/VERIFICATION.md` — the M2 verification module that consumes compliance data.
- `docs/integration/SYNCHRONIZATION_GUIDE.md` — the M4 sync engine (used for inspection + notice sync).
- `docs/integration/WEBHOOK_GUIDE.md` — the M4 webhook platform (used for notice subscriptions).
