# Eks-Food Customer Platform — Privacy & Permissions Guide

> **Audience:** Platform engineers, security reviewers, privacy officers, DPOs (Data Protection Officers), legal counsel. Read alongside `PLATFORM_ARCHITECTURE.md`, `HOUSEHOLD_MODEL_GUIDE.md`, and the M2 `docs/identity/MULTI_TENANCY.md`, `docs/identity/AUTHORIZATION_POLICIES.md`, `docs/identity/AUDIT_AND_COMPLIANCE.md`.
>
> **Status:** Milestone 8 (Customer Platform). This document specifies the privacy model, permission matrix, child-safety gating, review moderation, audit history, secure media access, and GDPR-ready data subject rights (export, deletion, portability) for the Eks-Food Customer Platform.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- **Five household member roles** with distinct, auditable permission envelopes: `ADMIN`, `GUARDIAN`, `DEPENDENT`, `GUEST`, `CAREGIVER` (see `HOUSEHOLD_MODEL_GUIDE.md` §4).
- **Child privacy protections** for `DEPENDENT` members under the tenant's age of consent (13 in US-aligned tenants, 16 in EU-aligned tenants, configurable per `TenantConfiguration.childAgeOfConsent`). Protections include: restricted data collection, no direct marketing, no public reviews, guardian co-sign on preference writes, restricted data export.
- **Tenant isolation** — every customer data row carries `organizationId` as the first index column; queries never leak across tenant boundaries. Inherited from M2 `MULTI_TENANCY.md` §2.
- **Review moderation** — all `Review` rows pass through a moderation queue with `PENDING` → `APPROVED`/`REJECTED`/`REMOVED`/`DISPUTED` states. Minors' reviews never reach the public queue.
- **Auditable access** — every privileged read or write on customer data writes an `AuditLog` row with a `CUSTOMER_*` action code (see `PLATFORM_ARCHITECTURE.md` §8). Audit entries are retained per the §7 retention schedule.
- **Secure media access** — all customer-uploaded media (profile photos, meal photos, review photos) stored in tenant-isolated object storage with signed URLs (15-minute TTL) and access logged.
- **GDPR-ready data subject rights** — three endpoints under `/api/v1/customer/privacy/*` covering: data export (right to access / portability), deletion (right to erasure), and audit log access (right to be informed). All three are async (return a `jobId`) with status polling.

### 1.2 Non-Goals

- **PCI-DSS compliance** — payment data lives in the M1 Payswap port, not in the Customer Platform. The Customer Platform never sees card numbers.
- **HIPAA compliance** — `AllergyRecord` and `NutritionGoal` are customer-stated, not medical records (no doctor-patient relationship). If a tenant enables medical-record integration (M10+), that's a separate compliance track.
- **Cross-border data transfer management** — handled by M2 `TenantConfiguration.dataResidencyRegion` and M5 connector routing. M8 inherits the configured region.
- **Identity verification (KYC)** — handled by M2 `VerificationRequest`. M8 consumes the verification status, doesn't perform verification itself.

---

## 2. Permission Matrix

The full permission matrix is in `HOUSEHOLD_MODEL_GUIDE.md` §4.2. This section explains the **privacy-relevant** permissions in detail.

### 2.1 Read permissions on sensitive data

| Permission | ADMIN | GUARDIAN | DEPENDENT | GUEST | CAREGIVER | Notes |
|---|:---:|:---:|:---:|:---:|:---:|---|
| `household.preferences.read.self` | ✓ | ✓ | ✓ | ✓ | ✓ | Everyone can read their own preferences |
| `household.preferences.read.others` | ✓ | ✓ (dependents only) | ✗ | ✗ | ✗ | Only admin and guardian can read others' preferences, and guardian only for their dependents |
| `household.allergies.read.others` | ✓ | ✓ (dependents only) | ✗ | ✗ | ✓ (cared-for only) | Caregivers need allergies to plan safe meals |
| `household.nutrition_goals.read.others` | ✓ | ✓ (dependents only) | ✗ | ✗ | ✗ | Nutrition goals are personal; caregivers don't need them |
| `household.meal_history.read.others` | ✓ | ✓ (dependents only) | ✗ | ✗ | ✓ (cared-for only, last 7 days) | Caregivers need recent meal history to plan |
| `household.pantry.read` | ✓ | ✓ | ✓ | ✗ | ✓ | Pantry is shared by default; personal stashes are owner-only |
| `household.audit.read` | ✓ | ✓ (their dependents') | ✓ (own only) | ✗ | ✗ | Audit trail access is the right-to-be-informed implementation |

### 2.2 Write permissions with child-safety gating

| Permission | ADMIN | GUARDIAN | DEPENDENT (minor) | DEPENDENT (adult) | GUEST | CAREGIVER |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `household.preferences.write.self` | ✓ | ✓ | ✓ (gated) | ✓ | ✗ | ✗ |
| `household.preferences.write.others` | ✓ | ✓ (dependents) | ✗ | ✗ | ✗ | ✗ |
| `household.review.write` | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| `household.meal_plan.write` | ✓ | ✓ | ✓ (gated) | ✓ | ✗ | ✓ (limited) |
| `household.pantry.write` | ✓ | ✓ | ✓ (gated) | ✓ | ✗ | ✓ (consumption only) |
| `household.shopping_list.write` | ✓ | ✓ | ✓ (gated) | ✓ | ✗ | ✓ |
| `household.privacy.export` | ✓ | ✓ (dependents) | ✗ | ✓ (self) | ✗ | ✗ |
| `household.privacy.delete` | ✓ | ✓ (dependents) | ✗ | ✓ (self, requires ADMIN co-sign) | ✗ | ✗ |

The "(gated)" annotation means the write succeeds but is recorded with `metadata.cosignedBy = guardianMemberId` and may require co-sign at the UI layer (the API doesn't block — it records the gating for audit). Some writes (like publishing a public review) are blocked outright for minors — see §4.

---

## 3. Child Privacy Protections

### 3.1 Age of consent

`TenantConfiguration.childAgeOfConsent` (M2 model) sets the threshold:

| Tenant region | Default age | Legal basis |
|---|:---:|---|
| `US` | 13 | COPPA |
| `EU` | 16 | GDPR Article 8 (member states may lower to 13; default 16 unless overridden) |
| `UK` | 13 | UK GDPR Article 8 (UK set 13) |
| `GH` (Ghana) | 18 | Children's Act 1998 (no digital-specific threshold; conservative default) |
| `NG` (Nigeria) | 18 | Child Rights Act 2003 |
| `*` (other) | 18 | Conservative default |

The threshold is evaluated at write time: a `DEPENDENT` with `CustomerProfile.isMinor = true` (computed from `dateOfBirth` vs. `TenantConfiguration.childAgeOfConsent`) triggers the gated path.

### 3.2 Data collection restrictions for minors

For `DEPENDENT` members where `isMinor = true`:

| Data category | Collection allowed? | Notes |
|---|:---:|---|
| Name, age (month/year only — not full DOB in public views) | ✓ | Required for household membership |
| Email, phone | ✗ (unless guardian-provided for service delivery) | Cannot be used for direct marketing |
| Address | ✓ (household-level, not minor-specific) | Inherited from household |
| Dietary preferences, allergies | ✓ (guardian-stated or co-signed) | Required for safe meal planning |
| Nutrition goals | ✓ (guardian-stated) | Required for specialized diets |
| Meal history | ✓ (recorded when meal served) | Used for preference derivation; not for marketing |
| Pantry data | ✓ (household-level) | Shared pantry is fine; personal stashes allowed for minors ≥ 13 with guardian opt-in |
| Shopping list activity | ✓ (gated — minors cannot purchase age-restricted items) | Alcohol, tobacco, etc. blocked at item-add time |
| Reviews (public) | ✗ | Minors cannot submit public reviews |
| Ratings (anonymous, aggregated) | ✓ (if `analyticsOptIn = true` and guardian consented) | Only anonymous, k-anonymous (k≥50) aggregations |
| Marketing communications | ✗ | No marketing emails/SMS to minors |
| Location data | ✗ (unless real-time delivery tracking, ephemeral) | Not stored beyond delivery completion |

### 3.3 Guardian co-sign flow

When a minor attempts a gated write (e.g. setting a cuisine preference), the API:

1. Validates the minor's `HouseholdMember.role = DEPENDENT` and `CustomerProfile.isMinor = true`.
2. Writes the row with `metadata.cosignRequired = true`, `metadata.cosignedBy = NULL`, `metadata.cosignStatus = 'PENDING'`.
3. Sends a notification (via M5 `NotificationConnector`) to the minor's guardian (the `HouseholdMember` with `role = GUARDIAN` linked via `GUARDIAN_OF` relationship).
4. The guardian sees a "Co-sign request" in their app; on approval, `PATCH /api/v1/customer/preferences/...` updates the row's `metadata.cosignedBy` and `metadata.cosignStatus = 'APPROVED'`.
5. Until co-signed, the preference is stored but excluded from the `resolve` endpoint (the M9+ recommendation engine won't act on it).

If the guardian rejects, the row's `metadata.cosignStatus = 'REJECTED'` and the minor is notified. The minor can edit and re-submit, or accept the rejection.

### 3.4 Minor's right to access their data

A minor (especially ages 13–17 in EU/UK tenants) has the right to request their data export via `POST /api/v1/customer/privacy/export`. The export is sent to the guardian's email (not the minor's, if any) for review. The minor can read their audit log via `GET /api/v1/customer/privacy/audit-log` (their own audit entries only, no other household members').

A minor cannot request deletion of their own data — that requires guardian action via `POST /api/v1/customer/privacy/delete` (guardian-initiated).

---

## 4. Review Moderation

### 4.1 The moderation queue

`Review` rows flow through a moderation queue:

```
                       ┌─────────────────────────────┐
   submit review       │  PENDING                    │
  ────────────────────▶│  (in moderation queue)      │
                       └──────────────┬──────────────┘
                                      │
                   ┌──────────────────┼──────────────────┐
                   │                  │                  │
                   ▼                  ▼                  ▼
        ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
        │  APPROVED       │  │  REJECTED       │  │  FLAGGED        │
        │  (public)       │  │  (author notif.)│  │  (manual review)│
        └────────┬────────┘  └─────────────────┘  └────────┬────────┘
                 │                                          │
                 │ dispute                                  │ moderator action
                 ▼                                          ▼
        ┌─────────────────┐                       ┌─────────────────┐
        │  DISPUTED       │                       │  APPROVED or    │
        │  (re-queue)     │                       │  REJECTED or    │
        └─────────────────┘                       │  REMOVED        │
                                                  └─────────────────┘

  From APPROVED: customer or moderator can REMOVED (with reason)
```

### 4.2 Moderation roles

| Role | Can submit? | Can moderate? | Can dispute own? |
|---|:---:|:---:|:---:|
| ADMIN (household) | ✓ | ✗ (only org-level admin can moderate) | ✓ |
| GUARDIAN | ✓ | ✗ | ✓ |
| DEPENDENT (minor) | ✗ (blocked at submit time) | ✗ | n/a |
| DEPENDENT (adult) | ✓ | ✗ | ✓ |
| GUEST | ✗ | ✗ | n/a |
| CAREGIVER | ✗ (caregivers don't review households they serve) | ✗ | n/a |

Organization-level `admin` and `owner` roles (M2) can moderate any review in their org. The moderation UI is at `/admin/reviews` in the Eks-Food Console (M1).

### 4.3 Auto-flagging

The nightly `ReviewAutoFlagJob` (M1 cron) scans newly-submitted reviews and flags them for manual review if:

- Sentiment score (NLP, M9+ feature) is below -0.5 (very negative).
- The review contains profanity (M3 `@eks/registry` profanity filter, tenant-configurable).
- The review mentions a competitor by name (tenant-configurable blocklist).
- The review mentions an allergen incident ("I had an allergic reaction") — these are routed to the food safety team for follow-up (M7 `FoodSafetyIncident` linkage).
- The review is the customer's first review (new accounts are auto-flagged for the first 30 days).

Auto-flagged reviews enter the `FLAGGED` state and surface in the moderation queue with the flag reason. Moderators can approve, reject, or remove.

### 4.4 Dispute flow

A customer whose review was `REJECTED` or `REMOVED` can dispute via `POST /api/v1/customer/reviews/:id/dispute` with a reason. The dispute:

1. Transitions the review to `DISPUTED` state.
2. Routes to a senior moderator (org `owner` or a designated dispute-resolution team).
3. The senior moderator reviews the dispute and either restores the review (`APPROVED` with `disputeResolvedBy`) or upholds the rejection (`REJECTED` with `disputeUpheldReason`).
4. The customer is notified of the resolution via the M5 `NotificationConnector`.

Disputes are limited to one per review (no back-and-forth) to prevent abuse. If the customer disagrees with the senior moderator's decision, they can submit a GDPR data subject request for manual review by the DPO.

---

## 5. Audit History

### 5.1 What's audited

Every privileged read or write on customer data writes an `AuditLog` row (M1 model) with a `CUSTOMER_*` action code (see `PLATFORM_ARCHITECTURE.md` §8). The audited operations include:

| Category | Audited actions |
|---|---|
| Profile reads | `CUSTOMER_PROFILE_READ` (only if reading another member's profile, not own) |
| Profile writes | `CUSTOMER_PROFILE_CREATED`, `_UPDATED`, `_DELETED` |
| Household operations | `CUSTOMER_HOUSEHOLD_CREATED`, `_MEMBER_INVITED`, `_MEMBER_JOINED`, `_MEMBER_ROLE_CHANGED`, `_MEMBER_REMOVED`, `_DISSOLVED` |
| Preference writes | `CUSTOMER_PREFERENCE_RECORDED`, `_OVERRIDDEN`, `_REMOVED` |
| Allergy writes | `CUSTOMER_ALLERGY_RECORDED`, `_UPDATED`, `_REMOVED` |
| Meal plan operations | `CUSTOMER_MEAL_PLAN_CREATED`, `_COMMITTED`, `_ACTIVATED`, `_COMPLETED`, `_CANCELLED` |
| Pantry operations | `CUSTOMER_PANTRY_ITEM_ADDED`, `_CONSUMED`, `_EXPIRED`, `_REMOVED` |
| Shopping list operations | `CUSTOMER_SHOPPING_LIST_CREATED`, `_ITEM_ADDED`, `_ITEM_PURCHASED`, `_COMPLETED` |
| Review operations | `CUSTOMER_REVIEW_SUBMITTED`, `_MODERATED`, `_REMOVED`, `_DISPUTED` |
| Address operations | `CUSTOMER_ADDRESS_VERIFIED`, `_UPDATED`, `_REMOVED` |
| Notification preferences | `CUSTOMER_NOTIFICATION_PREFERENCE_UPDATED` |
| Privacy operations | `CUSTOMER_PRIVACY_EXPORT_REQUESTED`, `_EXPORT_READY`, `_DELETE_REQUESTED`, `_DELETE_COMPLETED` |
| Child safety | `CUSTOMER_CHILD_SAFETY_CHECK_PASSED`, `_FAILED`, `_COSIGN_REQUESTED`, `_COSIGN_APPROVED`, `_COSIGN_REJECTED` |

### 5.2 Audit log access

`GET /api/v1/customer/privacy/audit-log?from=YYYY-MM-DD&to=YYYY-MM-DD&actionCode=CUSTOMER_*` returns the audit entries for the caller's own profile (or their dependents, if guardian). Pagination is cursor-based (`?cursor=...&limit=100`). Results are sorted by `createdAt DESC`.

Each audit entry includes:
- `id`, `createdAt`, `actionCode`
- `actorUserId`, `actorMemberId` (who performed the action)
- `targetProfileId`, `targetMemberId` (whose data was affected)
- `entityType`, `entityId` (what specific row was touched)
- `changes` (JSON diff: `{ before, after }`)
- `reason` (human-readable explanation)
- `requestContext` (correlationId, traceId, IP, userAgent)

### 5.3 Audit retention

| Audit category | Retention | Legal basis |
|---|---|---|
| Review moderation actions | 7 years | Platform integrity / dispute resolution |
| Child-safety actions (cosign, gating) | 6 years after the child turns 18 | COPPA / GDPR-K record-keeping |
| Privacy operations (export, delete) | 6 years | GDPR Article 30 (records of processing) |
| Routine preference updates | 2 years | Operational debugging |
| Routine meal plan / pantry / shopping operations | 1 year | Operational debugging |
| Household membership changes | 6 years after dissolution | Dispute resolution |

The nightly `AuditRetentionJob` (M1 cron) hard-deletes audit entries past their retention window. Entries related to open disputes or legal holds are excluded from automatic deletion.

---

## 6. GDPR Data Subject Rights

### 6.1 Right to access / portability — `POST /api/v1/customer/privacy/export`

The export endpoint:

1. Validates the caller's identity (M2 session + step-up MFA if not done in last 15 min).
2. Creates a `PrivacyExportJob` row (new M8 model, not in the canonical 21 but a supporting model) with `status=QUEUED`, `requestedBy=caller.userId`, `profileId=target.profileId`.
3. Emits `Privacy.ExportRequested` event.
4. Returns `{ jobId, estimatedCompletionMinutes: 15 }`.
5. The M1 `@eks/workers` consumer processes the job:
   - Queries all customer data for the target profile across all 21 models + supporting models.
   - Bundles into a JSON archive (with optional CSV alternative for tabular data).
   - Encrypts the archive with a one-time AES-256 key.
   - Uploads to tenant-isolated object storage with a signed URL (24-hour TTL).
   - Sends the signed URL to the caller's email via M5 `NotificationConnector`.
   - Updates `PrivacyExportJob.status=READY`, `completedAt=now`.
   - Emits `Privacy.ExportReady` event.
6. The caller polls `GET /api/v1/customer/privacy/export/:jobId` until `status=READY`, then downloads.

The export includes:
- All `CustomerProfile` fields (including JSON columns).
- All `HouseholdMember` rows (across all households the profile belongs to).
- All `HouseholdRelationship` rows involving the profile.
- All `CustomerPreference`, `CuisinePreference`, `IngredientPreference`, `DietaryProfileAssignment`, `AllergyRecord`, `NutritionGoal` rows.
- All `MealHistory`, `MealPlan`, `MealCalendar` rows.
- All `PantryItem`, `ShoppingList`, `ShoppingListItem` rows.
- All `Favorite`, `Review`, `Rating` rows.
- All `Address`, `DeliveryInstruction`, `CustomerNotificationPreference` rows.
- The complete audit history for the profile (per §5 retention windows).

The export does NOT include other household members' data unless the caller is the guardian of a dependent (in which case the dependent's data is exported as a separate section, not interleaved).

### 6.2 Right to erasure — `POST /api/v1/customer/privacy/delete`

The deletion endpoint:

1. Validates the caller's identity (M2 session + step-up MFA + ADMIN co-sign if the caller is a `DEPENDENT`).
2. Creates a `PrivacyDeletionJob` row with `status=QUEUED`, `scheduledPurgeAt = NOW() + 30 days` (the GDPR cooling-off period).
3. Emits `Privacy.DeleteRequested` event.
4. Returns `{ jobId, scheduledPurgeAt }`.
5. The customer can cancel the deletion within 30 days via `POST /api/v1/customer/privacy/delete/:jobId/cancel`.
6. If not cancelled, the M1 `@eks/workers` consumer processes the deletion at `scheduledPurgeAt`:
   - Soft-deletes (sets `deletedAt=NOW()`) all 21 model rows for the profile.
   - Anonymizes `Review` rows (replaces author name with "Deleted User", preserves review text for moderation history).
   - Removes `Favorite`, `Rating` rows.
   - Ends all `HouseholdRelationship` rows with `validTo=NOW()`, `endedReason='DELETED'`.
   - Transitions all `HouseholdMember` rows to `status=DEPARTED`, `departedReason='PRIVACY_DELETION'`.
   - If the profile was the last `ADMIN` of a household, triggers `HouseholdService.handleLastAdminDeparture` (which either dissolves the household or transfers admin to another member).
   - Hard-deletes the M2 `User` row (the security principal) — this is the irreversible step.
   - Updates `PrivacyDeletionJob.status=COMPLETED`, `completedAt=now`.
   - Emits `Privacy.DeleteCompleted` event.
7. The audit log entries for the profile are retained per §5 (they're anonymized — `actorUserId` is replaced with the hashed `User.id` for traceability without identification).

### 6.3 Right to be informed — `GET /api/v1/customer/privacy/audit-log`

See §5.2. The audit log is the customer's "right to be informed" implementation — they can see every privileged action taken on their data, by whom, and when.

### 6.4 Right to rectification — `PATCH /api/v1/customer/profiles/:id`

Customers can update their own profile data (name, email, phone, preferences, allergies, etc.) at any time via the standard PATCH endpoints. The audit log records every change. There's no separate "rectification" endpoint — it's the normal update flow with audit.

### 6.5 Right to object — `PATCH /api/v1/customer/notifications/preferences`

Customers can opt out of marketing communications (and any non-essential notifications) via the notification preferences endpoint. The `CustomerNotificationPreference.marketingOptIn` flag defaults to `false` (opt-in model per GDPR).

### 6.6 Right to restrict processing — `POST /api/v1/customer/profiles/:id/restrict`

A new M8 endpoint that sets `CustomerProfile.status=RESTRICTED`. While restricted:
- The profile's data is not included in any aggregate analytics.
- The M9+ recommendation engine does not process the profile.
- The profile's reviews remain public (per GDPR Article 17 — restriction doesn't require public-content removal) but their author attribution is anonymized.
- The profile can still receive bookings and use the platform normally — restriction affects background processing, not foreground service.

Restriction can be lifted via `POST /api/v1/customer/profiles/:id/unrestrict`.

---

## 7. Data Retention Schedule

| Data category | Retention after deletion | Notes |
|---|---|---|
| `CustomerProfile` (soft-deleted) | 30 days (GDPR cooling-off) | Then hard-purge |
| `CustomerProfile` (after deletion completion) | 0 (immediate hard-purge) | Audit log retains anonymized summary |
| `HouseholdMember` (departed) | 6 years after dissolution | For dispute resolution |
| `HouseholdRelationship` (ended) | 6 years after ending | For family-history reconstruction |
| `CustomerPreference` (removed) | 30 days | Then hard-purge |
| `AllergyRecord` (resolved) | 6 years | Medical safety — long retention in case of recurrence |
| `MealHistory` | 2 years | Then aggregate (k-anonymized) and hard-purge individual records |
| `MealPlan`, `MealCalendar` (archived) | 2 years | Then hard-purge |
| `PantryItem` (removed) | 90 days | Then hard-purge |
| `ShoppingList`, `ShoppingListItem` (archived) | 1 year | Then hard-purge |
| `Review` (removed) | 7 years | For moderation dispute resolution |
| `Rating` (removed) | 1 year | Then hard-purge |
| `Address` (removed) | 90 days | Then hard-purge |
| `AuditLog` entries | Per §5.3 | Category-specific |
| `CustomerNotificationPreference` (after profile deletion) | 0 (immediate) | No longer needed |
| Media (photos, etc.) | 90 days after profile deletion | Then hard-purge from object storage |

The nightly `CustomerDataRetentionJob` (M1 cron) enforces this schedule. The job runs at 02:00 UTC and processes deletions in batches of 1000 rows to avoid lock contention.

---

## 8. Secure Media Access

### 8.1 Storage layout

Customer-uploaded media (profile photos, meal photos in `MealHistory`, review photos) is stored in tenant-isolated object storage:

```
s3://eks-food-customer-media-{region}/{organizationId}/{profileId}/{entityType}/{entityId}/{mediaId}.{ext}
```

Examples:
- `s3://eks-food-customer-media-eu-west-1/org-accra-01/prof-kwame/profile_photo/photo-001.jpg`
- `s3://eks-food-customer-media-eu-west-1/org-accra-01/prof-kwame/meal_history/mh-jollof-jan15-001/photo-001.jpg`
- `s3://eks-food-customer-media-eu-west-1/org-accra-01/prof-kwame/review/rv-cook-001/photo-001.jpg`

### 8.2 Signed URLs

All media access is via signed URLs with a 15-minute TTL. The `MediaService.signUrl(mediaId, requestingMemberId)` method:

1. Loads the `MediaAsset` row (M8 supporting model) to get the S3 key.
2. Checks the requesting member's permission to view the asset (e.g. a meal photo is visible to the household's active members; a review photo is public once the review is APPROVED).
3. Generates a presigned S3 URL with `expiresIn=900` (15 min).
4. Logs the access: `CUSTOMER_MEDIA_ACCESS_LOG` audit action with `mediaId`, `requestingMemberId`, `signedAt`, `expiresAt`.
5. Returns the URL.

The URL is cached on the client for a maximum of 14 minutes (1 minute safety margin); on expiry, the client requests a fresh URL.

### 8.3 Upload flow

Media uploads use a presigned PUT URL flow:

1. Client requests a presigned upload URL: `POST /api/v1/customer/media/upload-url` with `{ entityType, entityId, contentType, sizeBytes }`.
2. Server validates the request (entity exists, caller has write permission, content type is in the allowed list, size ≤ 10 MB).
3. Server generates a presigned S3 PUT URL with `expiresIn=300` (5 min) and a unique `mediaId`.
4. Client uploads the file directly to S3 via PUT.
5. Client calls `POST /api/v1/customer/media` with `{ mediaId, entityType, entityId }` to confirm.
6. Server creates the `MediaAsset` row, links it to the entity, and emits a `Media.Uploaded` event.

### 8.4 Virus scanning

All uploaded media is scanned by the M1 `@eks/security` ClamAV integration (Lambda-triggered on S3 PUT). Infected files are quarantined (`MediaAsset.status=QUARANTINED`), the upload is rejected, and a `CUSTOMER_MEDIA_QUARANTINED` audit action is written. The customer is notified that their upload was rejected for security reasons (without disclosing the specific threat).

### 8.5 EXIF stripping

Image uploads have their EXIF data stripped server-side (via the M1 `@eks/security` sanitization pipeline) to prevent accidental leakage of GPS coordinates or device identifiers. The stripped metadata is logged to the audit trail for transparency.

---

## 9. API Examples

### 9.1 Request a data export

```http
POST /api/v1/customer/privacy/export
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
Authorization: Bearer <session-token>

{
  "profileId": "prof-kwame",
  "format": "JSON",
  "includeAuditLog": true
}
```

Response `202 Accepted`:
```json
{
  "jobId": "pej-kwame-001",
  "status": "QUEUED",
  "estimatedCompletionMinutes": 15,
  "requestedAt": "2025-01-15T20:00:00Z"
}
```

### 9.2 Poll export status

```http
GET /api/v1/customer/privacy/export/pej-kwame-001
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
```

Response `200 OK` (when ready):
```json
{
  "jobId": "pej-kwame-001",
  "status": "READY",
  "completedAt": "2025-01-15T20:12:00Z",
  "downloadUrl": "https://eks-food-customer-media-eu-west-1.s3.amazonaws.com/exports/...",
  "downloadUrlExpiresAt": "2025-01-16T20:12:00Z",
  "archiveSizeBytes": 458752,
  "archiveSha256": "..."
}
```

### 9.3 Request data deletion

```http
POST /api/v1/customer/privacy/delete
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
Authorization: Bearer <session-token>  // step-up MFA required

{
  "profileId": "prof-kwame",
  "reason": "GDPR right to erasure"
}
```

Response `202 Accepted`:
```json
{
  "jobId": "pdj-kwame-001",
  "status": "QUEUED",
  "scheduledPurgeAt": "2025-02-14T20:00:00Z",
  "cancelUrl": "/api/v1/customer/privacy/delete/pdj-kwame-001/cancel"
}
```

### 9.4 Read own audit log

```http
GET /api/v1/customer/privacy/audit-log?from=2025-01-01&to=2025-01-31&limit=50
x-eks-org: org-accra-01
x-eks-user: user-kwame
x-eks-role: member
```

Response `200 OK`:
```json
{
  "entries": [
    {
      "id": "al-001",
      "createdAt": "2025-01-15T19:30:00Z",
      "actionCode": "CUSTOMER_PREFERENCE_RECORDED",
      "actorUserId": "user-kwame",
      "actorMemberId": "hm-kwame",
      "targetProfileId": "prof-kwame",
      "entityType": "CustomerPreference",
      "entityId": "cp-kwame-ghanaian-001",
      "changes": {
        "before": null,
        "after": { "cuisineCode": "ghanaian", "preferenceScore": 90 }
      },
      "reason": "User added Ghanaian cuisine preference via UI",
      "requestContext": {
        "correlationId": "req-001",
        "ip": "196.216.1.1",
        "userAgent": "EksFoodApp/1.0 iOS/17.2"
      }
    }
  ],
  "nextCursor": "eyJpZCI6ImFsLTA1MSJ9"
}
```

---

## 10. Cross-References

- `PLATFORM_ARCHITECTURE.md` §8 — `CUSTOMER_*` audit action registry.
- `PLATFORM_ARCHITECTURE.md` §9 — CustomerProfile lifecycle including DELETED state.
- `HOUSEHOLD_MODEL_GUIDE.md` §4 — full permission matrix with role definitions.
- `HOUSEHOLD_MODEL_GUIDE.md` §9 — `HouseholdPermissionResolver` algorithm.
- M2 `docs/identity/MULTI_TENANCY.md` — `organizationId` isolation invariant.
- M2 `docs/identity/AUTHORIZATION_POLICIES.md` — RBAC+ABAC layers M8 household permissions extend.
- M2 `docs/identity/AUDIT_AND_COMPLIANCE.md` — audit log conventions, retention policies.
- M2 `docs/identity/SECURITY_HARDENING.md` — step-up MFA for sensitive operations.
- M2 `docs/identity/SESSION_SECURITY.md` — session token handling for SSE and signed URLs.
- M5 `docs/connectors/NOTIFICATIONS_GUIDE.md` — export-ready and deletion-completed notifications.
- M1 `docs/SECURITY.md` — ClamAV virus scanning, EXIF stripping, signed URL conventions.
- M1 `docs/OPERATIONS_RUNBOOK.md` — incident response for privacy breaches.
