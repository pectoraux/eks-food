# Eks-Food IAM — Identity Verification

> **Audience:** Identity engineers, compliance officers, ops engineers wiring up verification providers. Read alongside `ORGANIZATIONS.md` (verification gates org activation), `AUDIT_AND_COMPLIANCE.md` (verification status is audited), and `API_REFERENCE.md` (no verification endpoints in M2 — the interface is internal).
>
> **Status:** M2 scope is **interface-only**. The `VerificationProvider` interface and the `VerificationRequest` / `VerificationResult` flow are published in `@eks/verification`. No concrete providers are wired in M2; the `MockVerificationProvider` returns `verified` for everything. M3 wires the first real providers.

---

## 1. Why Verification Is Separate from Authentication

**Authentication** answers "are you who you say you are?" — verified by a credential (password, passkey, OTP).

**Identity verification** answers "is the real-world person behind this account who they claim to be, and are their claimed attributes (government ID, business license, address, food-safety license) genuine?" — verified by a third-party provider that checks documents, databases, and registries.

Eks-Food needs identity verification for:
- **Cooks** — to issue the public "Verified Cook" badge, the platform must verify a food-safety license.
- **Restaurants / vendors / suppliers** — to activate an `Organization` of type `restaurant` or `vendor`, the platform must verify a business license and a food-handling permit.
- **Inspection agencies** — to grant the `INSPECTOR` role, the platform must verify professional certification.
- **Logistics providers** — to list as a delivery partner, the platform must verify a vehicle license and driver certification.

Authentication alone cannot establish these real-world attributes. Verification is a separate flow with a separate provider abstraction.

---

## 2. The VerificationProvider Interface

```ts
// @eks/verification/provider.ts

export interface VerificationProvider {
  /** Stable identifier for the provider (e.g. "smile_id", "verify_ng"). */
  readonly name: string;

  /** The verification capabilities this provider supports. */
  readonly capabilities: readonly VerificationCapability[];

  /** Verify a government-issued ID (passport, driver's license, national ID). */
  verifyGovernmentId?(input: GovernmentIdInput): Promise<VerificationResult>;

  /** Verify a business registration (corporate registry lookup). */
  verifyBusiness?(input: BusinessInput): Promise<VerificationResult>;

  /** Verify a physical address (utility bill, lease, etc.). */
  verifyAddress?(input: AddressInput): Promise<VerificationResult>;

  /** Verify a food-safety license (Ghana FDA, NAFDAC, etc.). */
  verifyFoodSafetyLicense?(input: FoodSafetyLicenseInput): Promise<VerificationResult>;

  /** Verify a professional certification (chef cert, inspector cert, etc.). */
  verifyProfessionalCertification?(input: ProfessionalCertificationInput): Promise<VerificationResult>;
}

export type VerificationCapability =
  | "government_id"
  | "business"
  | "address"
  | "food_safety_license"
  | "professional_certification";
```

### 2.1 Capability negotiation
Not every provider supports every capability. The `capabilities` array advertises what the provider can do. The `VerificationService` (§3) routes each `VerificationRequest` to a provider that advertises the requested capability. If no provider is configured for a capability, the request fails with `code=BUSINESS_RULE`, `details.rule=no_provider_for_capability`.

### 2.2 Optional methods
The methods on `VerificationProvider` are optional (`verifyGovernmentId?`, etc.). A provider implements only the methods for its capabilities. The `VerificationService` checks `provider.capabilities` before invoking a method; calling a method the provider does not implement is a programmer error (caught at boot by a capability-method consistency check).

---

## 3. VerificationRequest / VerificationResult Flow

```
   [User or admin initiates verification]
            │
            │  e.g. cook submits "Verify Food Safety License"
            │  POST /api/v1/verifications (M3 endpoint)
            │  { capability: "food_safety_license", … }
            │
            ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  @eks/verification/VerificationService                        │
   │  1. Persist VerificationRequest (status=PENDING)              │
   │  2. Select provider (capabilities match + tenant's preferred) │
   │  3. Invoke provider.verify<Capability>(input)                 │
   │  4. Persist VerificationResult (status from provider)         │
   │  5. Stage verification.completed.v1 to outbox                 │
   │  6. Audit(VERIFICATION_COMPLETED)                             │
   └──────────────────────────────────────────────────────────────┘
            │
            ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  VerificationProvider (e.g. SmileId, VerifyNg)                │
   │  • Calls the provider's API                                   │
   │  • Returns VerificationResult with status + evidence          │
   └──────────────────────────────────────────────────────────────┘
            │
            ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Downstream reactions (via outbox subscribers)                 │
   │  • Cook's verificationStatus → VERIFIED (if food_safety_       │
   │    license passes) → "Verified Cook" badge awarded             │
   │  • Organization status → ACTIVE (if business license passes    │
   │    during PROVISIONING)                                        │
   │  • User notified of result (via @eks/notifications)            │
   └──────────────────────────────────────────────────────────────┘
```

### 3.1 VerificationRequest model

```prisma
model VerificationRequest {
  id              String   @id @default(cuid())
  organizationId  String
  userId          String?  // null for org-level verifications
  // What's being verified
  capability      String   // "government_id" | "business" | "address" | …
  input           String   @default("{}") // JSON — see §3.2 input shapes
  // Provider routing
  providerName    String   // "smile_id" | "verify_ng" | "mock" | …
  providerRequestId String? // the provider's request ID (for follow-up)
  // Lifecycle
  status          String   @default("PENDING")
  // PENDING | IN_PROGRESS | VERIFIED | REJECTED | EXPIRED | ERROR
  submittedAt     DateTime @default(now())
  completedAt     DateTime?
  expiresAt       DateTime?  // for time-limited verifications
  // Result
  result          String?  @default("{}") // JSON — VerificationResult payload
  // Audit
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([organizationId, capability, status])
  @@index([userId, capability, status])
}
```

### 3.2 Input shapes

```ts
export interface GovernmentIdInput {
  documentType: "passport" | "drivers_license" | "national_id" | "voters_card";
  documentNumber: string;          // the ID number
  countryCode: string;             // ISO 3166-1 alpha-2
  // The document image is uploaded to S3 (pre-signed URL) and the
  // S3 key is passed here — the provider fetches it via a signed URL.
  documentS3Key: string;
  // Selfie for liveness check (if provider supports it)
  selfieS3Key?: string;
  // User-attested PII (matched against the document by the provider)
  firstName: string;
  lastName: string;
  dateOfBirth: string;             // ISO date
}

export interface BusinessInput {
  businessName: string;
  registrationNumber: string;      // the corporate registry number
  countryCode: string;
  // Optional: certificate of incorporation upload
  certificateS3Key?: string;
}

export interface AddressInput {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  countryCode: string;
  postalCode?: string;
  // Proof of address (utility bill, lease, bank statement)
  proofDocumentS3Key: string;
}

export interface FoodSafetyLicenseInput {
  licenseNumber: string;
  issuingAuthority: string;        // e.g. "Ghana FDA", "NAFDAC"
  countryCode: string;
  // The license document (cert scan)
  licenseS3Key: string;
  issuedAt?: string;
  expiresAt?: string;
}

export interface ProfessionalCertificationInput {
  certificationName: string;       // e.g. "Certified Chef de Cuisine"
  issuingBody: string;             // e.g. "American Culinary Federation"
  certificationNumber: string;
  certificateS3Key: string;
  issuedAt?: string;
  expiresAt?: string;
}
```

### 3.3 VerificationResult

```ts
export interface VerificationResult {
  // The provider's overall verdict
  status: "VERIFIED" | "REJECTED" | "PENDING_REVIEW" | "ERROR";
  // Provider's reference for this verification
  providerReference: string;
  // Human-readable summary
  summary: string;
  // Per-field breakdown (which input fields the provider verified, and how)
  fields: readonly VerificationFieldResult[];
  // Evidence retained (links to provider's evidence artifacts; never raw
  // documents — those stay in the provider's vault, not ours)
  evidence: readonly VerificationEvidence[];
  // When the provider produced this result
  verifiedAt: ISODateString;
  // TTL of the verification (some verifications expire — e.g. an address
  // verification is valid for 90 days)
  validUntil?: ISODateString;
  // Provider-specific error code (if status=ERROR)
  errorCode?: string;
  errorMessage?: string;
}

export interface VerificationFieldResult {
  field: string;                  // "firstName", "licenseNumber", etc.
  status: "matched" | "mismatched" | "unverifiable";
  detail?: string;                // e.g. "matched against national registry"
}

export interface VerificationEvidence {
  type: "registry_lookup" | "document_scan" | "selfie_match" | "liveness_check";
  reference: string;              // provider's evidence ID
  // We do NOT store the document bytes — only the reference.
}
```

---

## 4. Storage of Verification Status (Not Raw Documents)

**Critical principle: Eks-Food does not store raw government-issued documents.**

The flow:
1. The user uploads their document (passport, license, etc.) directly to S3 via a pre-signed URL. The S3 bucket is in the tenant's `dataResidencyRegion`, encrypted SSE-KMS, with a 30-day lifecycle policy that deletes the object after the verification completes (whether pass or fail).
2. The `VerificationRequest` row stores only the S3 key (not the bytes) and the user-attested PII.
3. The `VerificationProvider` is given a short-lived pre-signed URL to fetch the document from S3. The provider fetches it, performs the verification, and returns a `VerificationResult` with `evidence` references (the provider's own evidence IDs, not document bytes).
4. After the verification completes (or fails after retries), a worker deletes the S3 object. The `VerificationRequest.input.documentS3Key` is set to `"[DELETED]"` in the database.
5. The `VerificationResult.evidence` array (provider references) is retained indefinitely — these are not documents, they are pointers into the provider's vault.

### 4.1 Why this matters
- **Liability:** Storing passport scans creates a high-value target for attackers. Not storing them eliminates the risk.
- **Compliance:** GDPR / NDPA / Act 843 data-minimisation principle — we collect only what we need, retain only as long as necessary.
- **Provider leverage:** The provider's vault is purpose-built for document storage with appropriate controls; our S3 bucket is for transient upload only.

### 4.2 Verification status on User / Organization
The `User.verificationStatus` and `Organization.status` fields are derived from `VerificationRequest` results:

- `User.verificationStatus` = `VERIFIED` if there is a `VerificationRequest` with `capability=government_id` (or `food_safety_license` for cooks) and `status=VERIFIED` and `validUntil > now` (or `validUntil IS NULL`).
- `Organization.status` = `ACTIVE` requires a `VerificationRequest` with `capability=business` and `status=VERIFIED` for the org's owner (or the org itself, depending on type).

A daily worker re-evaluates these derived fields:
- A verification whose `validUntil` has elapsed flips the `User.verificationStatus` back to `PENDING`.
- A cook with an expired food-safety license loses the "Verified Cook" badge until they re-verify.

---

## 5. Milestone-2 Scope

M2 publishes:
- The `VerificationProvider` interface (§2).
- The `VerificationRequest` and `VerificationResult` types (§3).
- The input shapes (§3.2).
- The `VerificationService` that routes requests to providers by capability.
- A `MockVerificationProvider` that returns `status=VERIFIED` for every request (for tests and dev).
- The `VerificationRequest` Prisma model.
- A `/api/v1/verifications` endpoint stub (returns `501 Not Implemented` for real provider calls; accepts requests and stores them as `PENDING`).

M2 does **not** wire any real provider. No API calls leave the platform. The verification status fields on `User` and `Organization` remain at their M1 defaults (`PENDING`).

This scope matches the M1 pattern (e.g. `@eks/payments` shipped the `PaymentProvider` interface + `MockPaymentProvider` in M1 with no live Payswap calls; M2 adds live calls).

---

## 6. Future Provider List (M3+)

The provider list is data — adding a provider is a deployment, not a code change (the interface is fixed). Candidates:

| Provider | Capabilities | Regions | Notes |
|---|---|---|---|
| **Smile ID** (smileidentity.com) | government_id, address | Nigeria, Ghana, Kenya, South Africa | Strong African coverage; selfie liveness check. |
| **VerifyMe Nigeria** (verifyme.ng) | government_id, address, business | Nigeria | NIN verification, drivers license, BVN. |
| **Ghana Card verification** (NIA Ghana) | government_id | Ghana | Direct integration with the National Identification Authority. |
| **Ghana FDA** (fdaghana.gov.gh) | food_safety_license | Ghana | Food-safety license registry lookup. |
| **NAFDAC** (nafdac.gov.ng) | food_safety_license | Nigeria | Nigerian food-safety license registry. |
| **RDW / KVK** | business | Netherlands (M4 expansion) | Corporate registry lookups. |
| **Aws Marketplace Identity Verification** | government_id | Global | Backup provider for non-African users. |
| **Persona** (withpersona.com) | government_id, address, business | Global | Backup for non-African users; document scan + selfie. |
| **Trulioo** | government_id, business, address | Global | Aggregate provider with 190+ countries. |

The `VerificationService` selects a provider per request based on:
1. The tenant's `dataResidencyRegion` (a Ghana-pinned tenant uses Ghana-licensed providers; this keeps personal data in-country per Act 843 / NDPR).
2. The capability requested.
3. The provider's `capabilities` array.
4. A per-tenant provider preference (stored in `TenantConfiguration.verificationProviderJson`).

### 6.1 Provider swap path
Same as the notification-provider swap (`NOTIFICATIONS.md` §6): implement the interface → add a feature flag → dual-write during the swap window → cut over → application code unchanged.

---

## 7. Verification Audit

Every verification lifecycle transition stages a domain event and writes an audit log row:

| Transition | Domain event | Audit action |
|---|---|---|
| Request submitted | `verification.submitted.v1` | `VERIFICATION_SUBMITTED` |
| Provider accepts | `verification.in_progress.v1` | `VERIFICATION_IN_PROGRESS` |
| Provider returns VERIFIED | `verification.completed.v1` (status=verified) | `VERIFICATION_VERIFIED` |
| Provider returns REJECTED | `verification.completed.v1` (status=rejected) | `VERIFICATION_REJECTED` |
| Provider returns ERROR | `verification.error.v1` | `VERIFICATION_ERROR` |
| Verification expires | `verification.expired.v1` | `VERIFICATION_EXPIRED` |
| Verification manually overridden (admin) | `verification.overridden.v1` | `VERIFICATION_OVERRIDDEN` |

The audit log records `capability`, `providerName`, `providerReference`, `userId`, `organizationId`, and `validUntil`. It does **not** record the input fields (which may contain PII like document numbers) — only the input's S3 key (which is later `"[DELETED]"`) and the provider's evidence references.

---

## 8. Privacy & Compliance

### 8.1 Data residency
Verification requests for a Ghana-pinned tenant use a Ghana-licensed provider (Smile ID's Ghana presence, Ghana FDA, NIA Ghana). The S3 upload bucket is in `gh-east-1`. No personal data leaves Ghana.

Verification requests for a Nigeria-pinned tenant use VerifyMe Nigeria or NAFDAC. The S3 bucket is in `ng-lagos-1`. No personal data leaves Nigeria.

Cross-region verification (e.g. a Côte d'Ivoire user with no Ivoirian provider available) requires explicit user consent (collected in the UI before the request is submitted) and is audited as `VERIFICATION_CROSS_REGION`.

### 8.2 Right to erasure
A user exercising their right to erasure (see `AUDIT_AND_COMPLIANCE.md` §4.2) has their `VerificationRequest` rows soft-deleted (the `input` JSON is scrubbed to `"[REDACTED]"`). The `VerificationResult` is retained for compliance (regulators may ask "did you verify this cook's food-safety license?" years later). The provider's evidence references are retained; if the user requests deletion from the provider, that is the provider's separate flow.

### 8.3 Document retention
Documents (passport scans, license scans) are deleted from S3 within 30 days of the verification completing. The deletion is audited as `VERIFICATION_DOCUMENT_DELETED` with the S3 key (already redacted). A daily worker verifies that no document in the verification S3 bucket is older than 30 days; any exception pages the on-call.

---

## 9. Cross-References

| Topic | Document |
|---|---|
| Org activation gated by business-license verification | `ORGANIZATIONS.md` §3 |
| Cook verification status (the "Verified Cook" badge) | (M1 platform build — `docs/ARCHITECTURE.md`) |
| Audit log entries for `VERIFICATION_*` | `AUDIT_AND_COMPLIANCE.md` §3 (to be extended in M3) |
| Data residency (tenant-pinned verification providers) | `MULTI_TENANCY.md` §9 |
| Right to erasure (verification data scrubbed) | `AUDIT_AND_COMPLIANCE.md` §4.2 |
| M1 provider-port pattern (the precedent for `VerificationProvider`) | `docs/PAYMENTS.md` §3 (PaymentProvider) |
