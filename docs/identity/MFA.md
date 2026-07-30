# Eks-Food IAM — Multi-Factor Authentication

> **Audience:** Identity engineers, security reviewers, support engineers handling MFA-reset requests. Read alongside `AUTHENTICATION_FLOWS.md` (§6 login-with-MFA flow, §12 account recovery), `SESSION_SECURITY.md` (§4 risk scoring drives step-up), and `SECURITY_HARDENING.md` (OWASP A07 mapping).
>
> **Status:** M2 target architecture. The M1 `@eks/security/crypto` (AES-256-GCM, PBKDF2 150 000 iterations) provides the encryption primitive used to store TOTP secrets at rest. M2 adds the `MFAConfiguration` and `RecoveryCode` Prisma models, the TOTP service, the WebAuthn-as-MFA-factor integration, and the adaptive step-up policy.

---

## 1. MFA Factor Catalogue

Eks-Food supports five MFA factors, ranked by trust level:

| Factor | Trust | Storage | Used as primary? | Used as step-up? | Used as recovery? |
|---|:---:|---|:---:|:---:|:---:|
| **Passkey (WebAuthn)** | High | `Identity(type=webauthn)` | ✓ | ✓ | ✓ |
| **TOTP (authenticator app)** | High | `MFAConfiguration.totpSecret` (encrypted at rest) | ✗ (it's a second factor) | ✓ | ✓ |
| **Recovery codes** | High | `RecoveryCode` (hashed, one-time use) | ✗ | ✗ | ✓ |
| **Email OTP** | Medium | Cache (5 min TTL, single-use) | ✗ | ✓ | ✓ |
| **SMS OTP** | Low | Cache (5 min TTL, single-use) | ✗ | ✓ (only when no other option) | ✓ (only via SUPPORT) |

The trust ranking drives two policies:
1. **Adaptive step-up** (§4) — when the risk score crosses 70, the user must complete a step-up with a **high-trust** factor (passkey or TOTP). Email/SMS are insufficient for high-risk step-up.
2. **MFA enrolment** — users enrolling in MFA for the first time must register at least one **high-trust** factor. Email/SMS alone do not satisfy the `MFA_REQUIRED_ROLES` policy.

SMS is treated as low-trust because of SIM-swap attacks; it is offered only as a fallback for users without a smartphone authenticator or passkey, and only when the tenant's `TenantConfiguration.smsMfaAllowed=true`.

---

## 2. MFA Configuration Model

```prisma
model MFAConfiguration {
  id              String   @id @default(cuid())
  userId          String   @unique
  organizationId  String
  // Status
  status          String   @default("ACTIVE") // ACTIVE | RESET_PENDING | DISABLED
  resetAt         DateTime?   // when admin reset was performed
  resetReason     String?
  // Enrolled factors
  totpEnrolled    Boolean  @default(false)
  totpSecret      String?  // AES-256-GCM encrypted
  totpEnrolledAt  DateTime?
  webauthnEnrolledCount Int @default(0)  // count of Identity(type=webauthn) rows
  emailOtpEnrolled Boolean @default(false)
  emailOtpEnrolledAt DateTime?
  smsOtpEnrolled  Boolean  @default(false)
  smsOtpEnrolledAt DateTime?
  smsPhoneNumber  String?  // E.164 format
  // Backup factor — which factor the user trusts for recovery
  backupFactor    String?  // "totp" | "webauthn" | "email" | "sms"
  // Audit
  enrolledAt      DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([organizationId, status])
}
```

A user is "MFA-protected" when `MFAConfiguration` exists with `status=ACTIVE` and at least one of `totpEnrolled`, `webauthnEnrolledCount > 0`, `emailOtpEnrolled`, `smsOtpEnrolled` is true. The `Identity(type=password)` credential has an `mfaEnabled` flag (mirroring `CredentialAggregate.mfaEnabled` in the domain skeleton) that gates whether the login flow demands a second factor.

---

## 3. Recovery Codes

Recovery codes are the **last-resort** factor: if a user loses their authenticator device and cannot receive email/SMS, a recovery code unlocks the account.

### 3.1 Generation
Ten codes of the form `XXXX-XXXX-XXXX-XXXX` (16 base32 chars, hyphenated for readability). Generated with `crypto.getRandomValues` (CSPRNG).

```
codeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"  // RFC 4648 base32 (no 0/1/O/I)
code = pick 16 random chars from codeAlphabet
formatted = `${code[0..3]}-${code[4..7]}-${code[8..11]}-${code[12..15]}`
```

### 3.2 Storage
Each code is hashed with SHA-256 (single-pass, no salt — the codes are 80 bits of entropy, sufficient against rainbow tables) and stored:

```prisma
model RecoveryCode {
  id              String   @id @default(cuid())
  userId          String
  organizationId  String
  codeHash        String   @unique  // SHA-256(code)
  usedAt          DateTime?
  usedFromIpHash  String?  // for forensic audit
  usedAtSessionId String?
  createdAt       DateTime @default(now())

  @@index([userId, usedAt])
  @@index([organizationId])
}
```

The plaintext code is shown to the user **once** at generation time, with a clear instruction: "Save these somewhere safe. They will never be shown again." The UI offers a download button (`.txt` file) and a print button.

### 3.3 Use
On the MFA verification step (login flow §6, step ⑨), the user may enter a recovery code instead of a TOTP code:

```
1. User enters recovery code in the MFA challenge field.
2. @eks/auth computes SHA-256(code), looks up RecoveryCode by codeHash + userId.
3. If found and usedAt IS NULL:
     BEGIN TX
       UPDATE RecoveryCode SET usedAt=now, usedFromIpHash=…, usedAtSessionId=…
       UPDATE MFAConfiguration SET backupFactor="recovery_code" (if not set)
       stage identity.recovery_code.used.v1
       audit(MFA_RECOVERY_CODE_USED)
     COMMIT
     delete the MFA challenge (success)
     proceed to session creation
4. If found but usedAt IS NOT NULL → 401 AUTH_MFA_INVALID_CODE
   (do not reveal "already used" — same error code prevents enumeration)
5. If not found → 401 AUTH_MFA_INVALID_CODE
```

### 3.4 Rotation
Recovery codes can be regenerated via `POST /api/v1/mfa/recovery-codes/regenerate` (requires the user to re-verify their TOTP / passkey first — recovery codes alone cannot regenerate recovery codes). Regeneration:
1. Marks all existing `RecoveryCode` rows `usedAt=now` (effectively invalidating them).
2. Generates 10 fresh codes.
3. Inserts the new `RecoveryCode` rows.
4. Returns the plaintext codes to the user (one-time display).

A daily worker emails users whose recovery codes are older than 365 days, prompting rotation. The audit log records every regeneration.

### 3.5 Recovery-code refill
After using 5 of 10 codes, the UI nudges: "You have 5 recovery codes left. Consider regenerating a fresh set." This is informational only — the user can keep using codes until they run out.

---

## 4. TOTP Enrolment Flow

TOTP (RFC 6238) is the standard authenticator-app factor (Google Authenticator, Authy, 1Password).

```
Browser (auth'd)       @eks/auth               Cache              Notifications
   │                       │                       │                    │
   │  POST /api/v1/mfa/enroll-totp                                                                   │
   ├──────────────────────▶│                       │                    │
   │                       │ ① Verify identity is authenticated       │                    │
   │                       │ ② Check MFAConfiguration.totpEnrolled    │                    │
   │                       │    → if true, return 409 MFA_ALREADY_    │                    │
   │                       │      ENROLLED                           │                    │
   │                       │ ③ Generate TOTP secret = randomBytes(20) │                    │
   │                       │ ④ Encrypt secret with AES-256-GCM       │                    │
   │                       │    (key = EKS_AUTH_MFA_ENCRYPTION_KEY)   │                    │
   │                       │ ⑤ Cache the encrypted secret temporarily │                    │
   │                       │    (key enroll:{sessionId}, TTL 5 min)   │                    │
   │                       ├──────────────────────▶│                    │
   │                       │ ⑥ Build otpauth:// URL:                 │                    │
   │                       │    otpauth://totp/Eks-Food:amara@eks.food│                    │
   │                       │      ?secret=<base32>                   │                    │
   │                       │      &issuer=Eks-Food                   │                    │
   │                       │      &algorithm=SHA1                    │                    │
   │                       │      &digits=6                          │                    │
   │                       │      &period=30                         │                    │
   │                       │ ⑦ Return URL + QR code data URL         │                    │
   │  200 { secret, otpauthUrl, qrDataUrl }                          │                    │
   │◀──────────────────────┤                       │                    │
   │                       │                       │                    │
   │  [User scans QR with authenticator app]                                                          │
   │  [App displays 6-digit code that rotates every 30 s]                                              │
   │                       │                       │                    │
   │  POST /api/v1/mfa/enroll-totp/verify                                                            │
   │  { code }                                                                                        │
   ├──────────────────────▶│                       │                    │
   │                       │ ① Lookup cached encrypted secret         │                    │
   │                       │ ② Decrypt → TOTP secret                  │                    │
   │                       │ ③ Verify code against TOTP(±1 window):  │                    │
   │                       │    expected = TOTP(secret, now, 30s)    │                    │
   │                       │    prev    = TOTP(secret, now-30s, 30s) │                    │
   │                       │    next    = TOTP(secret, now+30s, 30s) │                    │
   │                       │    if code in {prev, expected, next} → ok│                    │
   │                       │ ④ If invalid:                            │                    │
   │                       │    challenge.attempts++ (max 3)          │                    │
   │                       │    return 401 AUTH_MFA_INVALID_CODE      │                    │
   │                       │ ⑤ BEGIN TX                               │                    │
   │                       │    UPDATE MFAConfiguration               │                    │
   │                       │      totpEnrolled=true                  │                    │
   │                       │      totpSecret=<encrypted secret>      │                    │
   │                       │      totpEnrolledAt=now                  │                    │
   │                       │      backupFactor="totp" (if not set)    │                    │
   │                       │    UPDATE Identity(type=password)        │                    │
   │                       │      mfaEnabled=true                     │                    │
   │                       │    INSERT 10 RecoveryCode rows           │                    │
   │                       │      (hashed)                            │                    │
   │                       │    stage identity.mfa.enabled.v1         │                    │
   │                       │    audit(MFA_TOTP_ENROLLED)              │                    │
   │                       │  COMMIT                                  │                    │
   │                       │ ⑥ Delete cache entry (single-use)        │                    │
   │                       │ ⑦ Return recovery codes (one-time        │                    │
   │                       │    display) + send recovery-codes email  │                    │
   │                       ├───────────────────────────────────────────▶│                    │
   │  200 { recoveryCodes: [...], message: "Save these — they will    │                    │
   │         never be shown again" }                                  │                    │
   │◀──────────────────────┤                       │                    │
   │                       │                       │                    │
   │  [@eks/notifications subscriber: identity.mfa.enabled.v1]                                        │
   │                       │                       │                    │ queue recovery-codes email
   │                       │                       │                    │   "Your MFA is now active.
   │                       │                       │                    │    Save your recovery codes."
```

### 4.1 TOTP parameters
| Parameter | Value | Why |
|---|---|---|
| Hash algorithm | SHA-1 | RFC 6238 default; authenticator apps universally support it. |
| Digits | 6 | Universal support. 8 digits is rarer. |
| Period | 30 s | RFC 6238 default; balances security with user convenience. |
| Window | ±1 step | Tolerates 30 s of clock drift; tight enough to prevent brute-force. |
| Secret length | 160 bits (20 bytes) | OWASP-recommended minimum. |

### 4.2 Verification limits
- Each `mfaChallengeId` allows at most 3 verification attempts.
- On the 3rd failure, the challenge is deleted and the user must restart the login flow (which re-triggers the rate limiter).
- A failed verification does **not** increment the password `Identity.failedAttempts` counter (a user who typed their password correctly should not be locked out because they mistyped their TOTP code).

---

## 5. Passkey as MFA Factor

A passkey (WebAuthn credential) can serve as either a primary login method (§8 of `AUTHENTICATION_FLOWS.md`) **or** an MFA factor. The two are not mutually exclusive — the same `Identity(type=webauthn)` row serves both purposes.

### 5.1 Passkey-as-step-up
When the risk score crosses 70 and the user has a passkey enrolled, the step-up flow can challenge the passkey instead of a TOTP code:

```
Risk score ≥ 70 on a request that already has an active session
   │
   ▼
Return 401 AUTH_MFA_REQUIRED
  { mfaChallengeId, allowedFactors: ["webauthn", "totp"] }
   │
   ▼
[Browser presents a WebAuthn assertion prompt]
   │
   ▼
POST /api/v1/mfa/verify
  { mfaChallengeId, factor: "webauthn",
    credentialId, authenticatorData, signature, clientDataJSON }
   │
   ▼
@eks/auth verifies the assertion against any of the user's
Identity(type=webauthn) rows (sign-count check, clone detection)
   │
   ▼
Delete the challenge, bump the session's risk score down by 30
(the step-up has been satisfied), proceed with the original request.
```

Passkey step-up is preferred over TOTP step-up because:
- It is phishing-resistant (origin-bound).
- It does not require typing (better UX).
- It can be silent if the device supports it (Touch ID, Face ID, Windows Hello).

### 5.2 Passkey as recovery factor
If the user loses their TOTP device, they can authenticate with their passkey (which is also a primary login method) and re-enrol a fresh TOTP without going through the SUPPORT-gated recovery flow (§7 of `AUTHENTICATION_FLOWS.md`). This is a major UX win: a user with both factors has self-service recovery.

---

## 6. Email and SMS OTP

Email and SMS OTP are lower-trust factors, used when:
- The user has not enrolled a high-trust factor (initial setup grace period).
- The user has lost their high-trust factor and is waiting on SUPPORT recovery.
- The tenant's `TenantConfiguration` requires email verification for low-risk step-ups.

### 6.1 Email OTP
1. `POST /api/v1/mfa/send-otp { channel: "email" }` — generates a 6-digit code, stores `otp:email:{userIdHash}` in cache (TTL 5 min, attempts: 0), emails the code via `@eks/notifications`.
2. `POST /api/v1/mfa/verify { factor: "email", code }` — looks up the cached entry, verifies the code, deletes the cache entry (single-use).

The email subject is locale-aware (see `NOTIFICATIONS.md`): "Your Eks-Food verification code" in English, "Votre code de vérification Eks-Food" in French.

### 6.2 SMS OTP
Same flow, channel `sms`. The phone number is the `MFAConfiguration.smsPhoneNumber` (E.164 format, verified at enrolment). SMS is offered only when `TenantConfiguration.smsMfaAllowed=true`; otherwise the user must use email or a high-trust factor.

### 6.3 Brute-force protection
- 5-minute TTL.
- Maximum 3 verification attempts per code.
- Maximum 5 code-sends per hour per user (rate-limited).
- After 3 failed verifies, the user must request a fresh code.

---

## 7. Adaptive Authentication Policy

The risk score (computed by `RiskScoringService`, see `SESSION_SECURITY.md` §4) drives when MFA is demanded. The policy is in `@eks/auth/adaptive-policy.ts`:

| Scenario | Risk score | Policy |
|---|:---:|---|
| Initial login, MFA enrolled | 0–69 | Demand TOTP / passkey as usual (MFA is always-on for enrolled users). |
| Initial login, MFA enrolled | 70–89 | Demand TOTP / passkey as usual; on success, log the elevated risk. |
| Initial login, MFA enrolled | 90–100 | Block the login (`AUTH_DEVICE_UNTRUSTED`); the user must re-authenticate from a known device. |
| Initial login, MFA NOT enrolled | 0–69 | Allow (MFA enrolment is encouraged but not forced, unless the role requires it). |
| Initial login, MFA NOT enrolled | 70–89 | Block (`AUTH_DEVICE_UNTRUSTED`); step-up demands enrolment. The user must enrol a high-trust factor before they can log in. |
| Mid-session request (already auth'd) | 70–89 | Demand step-up MFA via `401 AUTH_MFA_REQUIRED`; trusted devices skip this. |
| Mid-session request (already auth'd) | 90–100 | Revoke the session; the user must re-authenticate. |
| Privileged action (e.g. `org.transfer_ownership`, `policy.write`, `mfa.reset`) | any | Always demand step-up MFA, even on trusted devices, even with low risk. The step-up is fresh (must have been completed in the last 5 minutes). |
| Password change | any | Demand the current password + step-up MFA. |
| MFA disable | any | Demand step-up MFA + a 24-hour cooldown (the disable takes effect the next day). |
| Tenant switch to an unfamiliar org | any | Demand step-up MFA before the switch completes (see `MULTI_TENANCY.md` §8). |

### 7.1 Privileged-action re-authentication
For the highest-risk actions (`org.transfer_ownership`, `org.delete`, `mfa.reset` as admin, `auth.impersonate`), the platform requires a **fresh** step-up — meaning the user must complete MFA **within the last 5 minutes**. If the last step-up was older, the request returns `401 AUTH_MFA_REQUIRED` with `details.requiredFreshness="5m"`. This is enforced via a `lastStepUpAt` timestamp on the session.

### 7.2 MFA-required roles
Roles listed in `EKS_AUTH_MFA_REQUIRED_ROLES` (default: `SUPER_ADMIN,SUPPORT,ADMIN`) **must** have MFA enrolled. If a user is granted such a role without MFA:
1. The role grant proceeds (the audit log notes the MFA gap).
2. The user's sessions are revoked.
3. On next login, the login flow returns `401 AUTH_MFA_REQUIRED` with `details.reason="role_requires_mfa"` and the user is forced into the enrolment flow before they can complete login.

---

## 8. Backup-Factor Handling

The `MFAConfiguration.backupFactor` records the user's preferred recovery factor. When the user fails their primary MFA twice in a row, the UI offers: "Use your backup factor instead?" — showing the user's chosen backup factor (e.g. "Send a code to your recovery email" or "Use a recovery code").

If the user loses access to **all** their factors (lost phone + lost recovery codes + lost passkey), the only path is the SUPPORT-gated account-recovery flow (`AUTHENTICATION_FLOWS.md` §12), which requires two-appover approval and a full audit trail.

### 8.1 Recommended setup
The platform's MFA-setup wizard guides users to:
1. Enrol TOTP (primary second factor).
2. Generate and save recovery codes (backup factor).
3. Optionally enrol a passkey (which becomes a self-service recovery path).
4. Optionally add email OTP (low-trust fallback).

The wizard refuses to mark the user "MFA-protected" until at least TOTP + recovery codes are set up. Email/SMS alone do not count.

---

## 9. Disabling MFA

MFA disable is a high-risk action. The flow:

```
1. POST /api/v1/mfa/disable (auth'd, requires step-up MFA in the last 5 min)
2. @eks/auth verifies the step-up freshness.
3. BEGIN TX
     UPDATE MFAConfiguration SET status=DISABLED
     UPDATE Identity(type=password) SET mfaEnabled=false
     stage identity.mfa.disabled.v1
     audit(MFA_DISABLED)
   COMMIT
4. Schedule a 24-hour cooldown worker:
     - if user re-enables within 24h, cancel the disable
     - else, after 24h, DELETE MFAConfiguration.totpSecret (already
       marked DISABLED, now scrubbed)
5. @eks/notifications → email the user:
   "MFA was disabled on your account. If this was not you, [re-enable now]."
6. Sessions are NOT revoked (the user is still authenticated; only
   future logins skip MFA). But every session's risk score is bumped
   to ≥ 50 (no MFA = higher baseline risk).
```

The cooldown allows a user who was socially-engineered into disabling MFA to re-enable it within 24 hours before the secret is scrubbed.

### 9.1 Admin-initiated MFA reset
For users locked out of all factors, `SUPPORT` (with second-approver `SUPER_ADMIN`) can call `POST /api/v1/admin/users/{id}/mfa-reset`:

1. Two-approver rule enforced (`SUPER_ADMIN` approver must be a different user from the requester).
2. `MFAConfiguration.status=RESET_PENDING`, `resetAt=+24h`.
3. All sessions revoked.
4. A one-time recovery link is emailed to the user's verified email (24h TTL).
5. The user clicks the link, sets a new password, and re-enrols MFA.
6. Audit `MFA_RESET_ADMIN` records both the requester and the approver.

---

## 10. Audit Events

Every MFA action stages a domain event to the outbox and writes an audit log row:

| Action | Domain event | Audit action |
|---|---|---|
| TOTP enrolled | `identity.mfa.enabled.v1` | `MFA_TOTP_ENROLLED` |
| TOTP verified at login | (none — session.started covers it) | `MFA_VERIFIED` (with `details.factor="totp"`) |
| TOTP verification failed | `identity.mfa.verify_failed.v1` | `MFA_VERIFY_FAILED` |
| WebAuthn registered | `identity.webauthn.registered.v1` | `MFA_WEBAUTHN_REGISTERED` |
| WebAuthn clone suspected | `identity.webauthn.clone_suspected.v1` | `MFA_WEBAUTHN_CLONE_SUSPECTED` |
| Recovery code used | `identity.recovery_code.used.v1` | `MFA_RECOVERY_CODE_USED` |
| Recovery codes regenerated | `identity.recovery_code.regenerated.v1` | `MFA_RECOVERY_CODE_REGENERATED` |
| MFA disabled | `identity.mfa.disabled.v1` | `MFA_DISABLED` |
| MFA admin reset | `identity.mfa.reset.v1` | `MFA_RESET_ADMIN` |
| Adaptive step-up triggered | `identity.mfa.stepup_required.v1` | `MFA_STEPUP_REQUIRED` |
| Email/SMS OTP sent | `identity.otp.sent.v1` | `OTP_SENT` |

Every event carries `userId`, `organizationId`, `factor`, `ipHash`, and `riskScore` in its payload, so the SOC can correlate MFA events with the risk score at the time.

---

## 11. Cross-References

| Topic | Document |
|---|---|
| Login-with-MFA sequence diagram, account recovery, lockout | `AUTHENTICATION_FLOWS.md` |
| Session risk scoring algorithm (drives step-up) | `SESSION_SECURITY.md` |
| WebAuthn registration + login flows (passkey as primary) | `AUTHENTICATION_FLOWS.md` §8 |
| MFA REST API (enroll-totp, verify, disable, recovery-codes) | `API_REFERENCE.md` |
| OWASP A07 mapping, password policy | `SECURITY_HARDENING.md` |
