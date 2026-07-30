# Eks-Food IAM — Notifications

> **Audience:** Identity engineers, frontend engineers wiring up notification preferences, ops engineers configuring providers. Read alongside `AUTHENTICATION_FLOWS.md` (which identity events trigger which notifications), `MFA.md` (MFA-related notifications), and `API_REFERENCE.md` (no notification endpoints exposed in M2 — notifications are internal).
>
> **Status:** M2 target architecture. The M1 domain skeleton (`src/packages/domain/contexts/notifications/`) declares the `NotificationAggregate`, `ChannelAggregate`, `TemplateAggregate`, and three service interfaces (`TemplateRenderer`, `NotificationPolicyService`, `NotificationComposer`). M2 publishes `@eks/notifications` with the provider implementations, the template registry, the identity-event subscribers, and the localization layer.

---

## 1. Notification Architecture

```
   Identity / Org event (outbox)
              │
              ▼
   ┌────────────────────────────────────────────────────────────┐
   │  @eks/events EventBus                                       │
   │  • identity.user.registered.v1                              │
   │  • identity.session.started.v1                              │
   │  • identity.password.changed.v1                             │
   │  • identity.mfa.enabled.v1                                  │
   │  • organization.member.added.v1                             │
   │  • organization.ownership.transferred.v1                    │
   │  • …                                                        │
   └──────────────┬─────────────────────────────────────────────┘
                  │ subscriber: @eks/notifications/composer
                  ▼
   ┌────────────────────────────────────────────────────────────┐
   │  NotificationComposer                                       │
   │  1. Map event → template key (see §3)                       │
   │  2. Resolve recipient (User → email, phone, deviceTokens,   │
   │     preferredLocale)                                        │
   │  3. Look up NotificationPolicyService.shouldSend            │
   │     (checks preferences, quiet hours, rate limits)          │
   │  4. TemplateRenderer.render(templateKey, channel, locale,   │
   │     variables) → RenderedNotification                       │
   │  5. Build NotificationAggregate (PENDING)                   │
   │  6. Save to Notification table (in same tx as outbox ack)   │
   │  7. Queue to channel dispatcher                            │
   └──────────────┬─────────────────────────────────────────────┘
                  │
                  ▼
   ┌────────────────────────────────────────────────────────────┐
   │  ChannelDispatcher (worker)                                 │
   │  • picks provider for channel (EmailProvider, SMSProvider,  │
   │    PushProvider, InAppProvider)                             │
   │  • calls provider.send(rendered)                            │
   │  • on success → Notification.status=DISPATCHED, then        │
   │    DELIVERED (when provider webhook confirms)               │
   │  • on failure → retry with exponential backoff (max 5)      │
   │  • on 5th failure → Notification.status=FAILED, audit       │
   └──────────────┬─────────────────────────────────────────────┘
                  │
                  ▼
   ┌────────────────────────────────────────────────────────────┐
   │  Providers                                                  │
   │  EmailProvider:  SmtpEmailProvider | SesEmailProvider       │
   │  SMSProvider:    TwilioSmsProvider | MsmSmsProvider         │
   │  PushProvider:   FcmPushProvider                            │
   │  InAppProvider:  DatabaseInAppProvider                      │
   └────────────────────────────────────────────────────────────┘
```

---

## 2. Provider Interfaces

The four provider interfaces are in `@eks/notifications/providers.ts`. Each is a port — concrete implementations are swappable without application-code changes.

### 2.1 EmailProvider

```ts
export interface EmailProvider {
  readonly name: string;  // "smtp" | "ses" | "postmark" | …

  send(message: EmailMessage): Promise<EmailSendResult>;
}

export interface EmailMessage {
  to: string;             // email address
  cc?: readonly string[];
  bcc?: readonly string[];
  from: string;           // configured per-tenant
  replyTo?: string;
  subject: string;
  htmlBody: string;
  textBody: string;       // plain-text alternative (always provided)
  attachments?: readonly EmailAttachment[];
  headers?: Readonly<Record<string, string>>;
  // Provider-specific tags (for SES, Postmark, etc.)
  tags?: readonly string[];
}

export interface EmailSendResult {
  providerMessageId: string;
  accepted: boolean;
  queuedAt: ISODateString;
}

export interface EmailProvider {
  // Webhook handler for delivery status (provider calls this on events)
  handleWebhook(payload: unknown, signature: string): Promise<void>;
}
```

M2 ships `SmtpEmailProvider` (via nodemailer, configured by `EKS_NOTIFICATIONS_SMTP_*` env vars). M3 will add `SesEmailProvider` (AWS SES, with webhook-based delivery tracking).

### 2.2 SMSProvider

```ts
export interface SMSProvider {
  readonly name: string;  // "twilio" | "msm" | "africastalking" | …

  send(message: SmsMessage): Promise<SmsSendResult>;
  handleWebhook(payload: unknown, signature: string): Promise<void>;
}

export interface SmsMessage {
  to: string;             // E.164 phone number
  from: string;           // configured per-tenant (sender ID)
  body: string;           // max 160 chars (GSM-7) or 70 chars (UCS-2)
  locale: string;         // for provider-side compliance (e.g. DND rules)
}

export interface SmsSendResult {
  providerMessageId: string;
  accepted: boolean;
  queuedAt: ISODateString;
}
```

M2 ships `TwilioSmsProvider` (via the Twilio SDK) and a `MockSmsProvider` for tests. SMS providers are region-aware: a Ghana-pinned tenant uses an Africa's-Talking sender ID; a Nigeria-pinned tenant uses a Termii sender ID. The provider is chosen per-tenant via `TenantConfiguration.smsProvider`.

### 2.3 PushProvider

```ts
export interface PushProvider {
  readonly name: string;  // "fcm" | "apns" | "expo" | …

  send(message: PushMessage): Promise<PushSendResult>;
}

export interface PushMessage {
  deviceTokens: readonly string[];  // FCM tokens, APNS tokens, etc.
  title: string;
  body: string;
  data?: Readonly<Record<string, string>>;
  badge?: number;
  sound?: string;
  actionUrl?: string;
}
```

M2 ships `FcmPushProvider` (via Firebase Admin SDK). Push notifications are used for session alerts ("New sign-in from Chrome on macOS") and invitation notifications.

### 2.4 InAppProvider

```ts
export interface InAppProvider {
  readonly name: string;  // "database"

  deliver(notification: InAppNotification): Promise<void>;
  list(userId: string, page: Page): Promise<PagedResult<InAppNotification>>;
  markRead(userId: string, notificationId: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
}

export interface InAppNotification {
  id: string;
  userId: string;
  organizationId: string;
  title: string;
  body: string;
  actionUrl?: string;
  iconUrl?: string;
  read: boolean;
  createdAt: ISODateString;
}
```

M2 ships `DatabaseInAppProvider` (stores in the `InAppNotification` Prisma table). In-app notifications are surfaced in the user's notification dropdown and the mobile app's notification center.

---

## 3. NotificationTemplate Registry

The `TemplateAggregate` (in the M1 domain skeleton, `src/packages/domain/contexts/notifications/aggregates.ts`) carries: `key` (stable, versioned), `templateVersion`, `status`, `channel`, `locale`, `subject`, `body`, `variableSchema`, `publishedAt`.

The template registry is a database table seeded by migration. Each entry is keyed by `(key, channel, locale, templateVersion)` and looked up at composition time. Adding a template is a data migration, not a code change.

### 3.1 Identity-event → template-key mapping

| Event | Template key | Channel | Default locale | Purpose |
|---|---|---|---|---|
| `identity.user.registered.v1` | `user.welcome.v1` | email | en | Welcome + email verification link |
| `identity.user.activated.v1` | `user.activated.v1` | email | en | Account activated confirmation |
| `identity.session.started.v1` (new device) | `session.new_device.v1` | email + push | en | New-device alert |
| `identity.session.revoked.v1` (reuse) | `session.reuse_detected.v1` | email + push | en | Suspicious activity alert |
| `identity.password.changed.v1` | `password.changed.v1` | email | en | Password-changed alert |
| `identity.password.reset.v1` | `password.reset.v1` | email | en | Password-reset confirmation |
| `identity.mfa.enabled.v1` | `mfa.enabled.v1` | email | en | MFA enabled + recovery codes |
| `identity.mfa.disabled.v1` | `mfa.disabled.v1` | email | en | MFA disabled alert |
| `identity.mfa.reset.v1` | `mfa.reset.v1` | email | en | MFA admin-reset link |
| `identity.identity.locked.v1` | `identity.locked.v1` | email | en | Account lockout alert |
| `identity.webauthn.registered.v1` | `webauthn.registered.v1` | email | en | Passkey registered confirmation |
| `identity.webauthn.clone_suspected.v1` | `webauthn.clone_suspected.v1` | email | en | Passkey clone alert |
| `identity.recovery_code.regenerated.v1` | `recovery_code.regenerated.v1` | email | en | Recovery codes regenerated |
| `organization.provisioned.v1` | `org.welcome.v1` | email | en | Org welcome |
| `organization.activated.v1` | `org.activated.v1` | email | en | Org activated |
| `organization.suspended.v1` | `org.suspended.v1` | email | en | Org suspended (to owner) |
| `organization.ownership.transferred.v1` | `org.ownership.transferred.v1` | email | en | Ownership transfer (to both users) |
| `organization.member.added.v1` | `org.member_added.v1` | email | en | Membership-accepted confirmation |
| `organization.invitation.sent.v1` | `org.invitation.v1` | email | en | Invitation to join |
| `organization.invitation.expired.v1` | `org.invitation_expired.v1` | email | en | Invitation expired (to inviter) |
| `audit.export_ready.v1` | `audit.export_ready.v1` | email + in_app | en | Audit export download link |
| `data_subject.export_ready.v1` | `data_subject.export_ready.v1` | email | en | Data-export download link |
| `data_subject.deletion_request_acknowledged.v1` | `data_subject.deletion_acknowledged.v1` | email | en | Deletion request received |
| `data_subject.deletion_completed.v1` | `data_subject.deletion_completed.v1` | email | en | Deletion completed |
| `breach.notification.v1` | `breach.notification.v1` | email | en | Breach notification (sent en masse during §5 of DR) |

Every template carries a `variableSchema` (JSON schema) that the `TemplateRenderer` validates against before rendering. A mismatch (e.g. calling `password.changed.v1` without `changedAt`) is a programmer error and is caught at composition time.

### 3.2 Template example — `password.changed.v1` (en, email)

```
Subject: Your Eks-Food password was changed

Body (HTML):
<p>Hi {{displayName}},</p>
<p>Your Eks-Food account password was changed on {{changedAt}} from a
{{platform}} device in {{ipRegion}}, {{ipCountry}}.</p>
<p>If this was you, no action is needed.</p>
<p>If you did not make this change, please:
  <ol>
    <li>Reset your password immediately:
        <a href="{{resetUrl}}">{{resetUrl}}</a></li>
    <li>Revoke all active sessions from your account settings.</li>
    <li>Contact Eks-Food support if you need help.</li>
  </ol>
</p>
<p>— The Eks-Food team</p>

Body (text):
Hi {{displayName}},

Your Eks-Food account password was changed on {{changedAt}} from a
{{platform}} device in {{ipRegion}}, {{ipCountry}}.

If this was you, no action is needed.

If you did not make this change, please:
  1. Reset your password immediately: {{resetUrl}}
  2. Revoke all active sessions from your account settings.
  3. Contact Eks-Food support if you need help.

— The Eks-Food team
```

`variableSchema`:
```json
{
  "type": "object",
  "required": ["displayName", "changedAt", "platform", "ipRegion", "ipCountry", "resetUrl"],
  "properties": {
    "displayName": { "type": "string" },
    "changedAt": { "type": "string" },
    "platform": { "type": "string" },
    "ipRegion": { "type": "string" },
    "ipCountry": { "type": "string" },
    "resetUrl": { "type": "string" }
  }
}
```

---

## 4. Identity-Event Triggers

The `@eks/notifications/composer` subscribes to the M1 `EventBus` (via `eventBus().subscribe(eventType, handler)`) for every identity event. The handler:

```
async function handleIdentityEvent(event: DomainEvent): Promise<void> {
  // 1. Resolve the template key from the event type.
  const mapping = TEMPLATE_EVENT_MAP[event.eventType];
  if (!mapping) return;  // no notification for this event

  // 2. Resolve the recipient from the event payload.
  const recipient = await resolveRecipient(event);
  if (!recipient) return;  // e.g. user already deleted

  // 3. Check NotificationPolicyService.shouldSend.
  const decision = await policy.shouldSend(
    recipient, mapping.templateKey, mapping.channel, new Date()
  );
  if (!decision.send) {
    // Record a SUPPRESSED notification for audit
    await saveSuppressed(recipient, mapping.templateKey, decision.reason);
    return;
  }

  // 4. Render the template.
  const variables = extractVariables(event, recipient);
  const rendered = await renderer.render(
    mapping.templateKey, mapping.channel, recipient.preferredLocale, variables
  );

  // 5. Compose + save the NotificationAggregate.
  const notification = await composer.compose(
    recipient.tenantId, recipient, mapping.templateKey, variables, event.correlationId
  );

  // 6. Queue to the channel dispatcher.
  await dispatcher.enqueue(notification.id);
}
```

### 4.1 Recipient resolution
The `resolveRecipient(event)` function:
1. Reads `userId` from the event payload (or `toUserId` for ownership-transfer events).
2. Loads the `User` + `UserPreference` + `ChannelEndpoint[]` rows.
3. Builds a `NotificationRecipient` (matching the M1 domain skeleton, `src/packages/domain/contexts/notifications/value-objects.ts`):
   ```ts
   {
     recipientId: userId,
     email: user.email,
     phone: userPreference.phone,
     deviceTokens: channelEndpoints.filter(c => c.type === "push").map(c => c.target),
     preferredLocale: userPreference.locale ?? tenantConfig.defaultLocale ?? "en",
   }
   ```
4. If the user has no `email` and the channel is `email`, returns `null` (no notification can be sent; the suppression is recorded for audit).

### 4.2 Variable extraction
Variables come from two sources:
1. **Event payload** — fields like `userId`, `organizationId`, `methodName`, `riskScore` (depending on the event).
2. **Contextual lookup** — fields like `displayName`, `ipRegion`, `ipCountry`, `platform`, `resetUrl` are resolved from the database (the `User`, the `LoginHistory` for the session, etc.).

The `extractVariables` function centralizes this so the template registry is the single consumer.

---

## 5. Localization

Templates are localized per-locale. The lookup logic:

1. Look up `(key, channel, locale, version=published)`.
2. If not found, fall back to the locale's language prefix (e.g. `fr-CA` → `fr`).
3. If not found, fall back to the tenant's `defaultLocale` (from `TenantConfiguration`).
4. If not found, fall back to `en` (the always-present default).
5. If still not found, log an error and suppress the notification (a missing template is a programmer error).

### 5.1 Supported locales in M2

| Locale | Display name | Templates translated |
|---|---|---|
| `en` | English | All (canonical) |
| `fr` | French | Welcome, password-changed, MFA-enabled, invitation (minimum set for Côte d'Ivoire) |
| `ha` | Hausa | Welcome, invitation (minimum set for Northern Nigeria) |
| `sw` | Swahili | (M3 — placeholder for East Africa expansion) |

Adding a locale is a data migration (insert `TemplateAggregate` rows with the new locale). The lookup logic is unchanged.

### 5.2 Locale resolution
The user's preferred locale comes from `UserPreference.locale`, set at registration (auto-detected from the `Accept-Language` header) and user-editable in settings. If unset, the tenant's `defaultLocale` is used. If the tenant's default is unsupported for a given template, the lookup falls back to `en`.

### 5.3 Date / time formatting
Dates are formatted per-locale using `Intl.DateTimeFormat`:
```
new Intl.DateTimeFormat(locale, {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: userPreference.timezone ?? tenantConfig.timezone,
}).format(new Date(changedAt))
```

This ensures a Ghanaian user sees "Wednesday, 15 January 2025 at 14:30 GMT" while a French user sees "mercredi 15 janvier 2025 à 14:30 GMT".

---

## 6. Provider-Swap Path (No Lock-In)

Swapping a provider is a 5-step path that mirrors the M1 payment-provider swap (`docs/PAYMENTS.md` §6):

1. **Implement the provider interface.** E.g. a new `PostmarkEmailProvider` implements `EmailProvider` (the four methods: `send`, `handleWebhook`, plus the readonly `name`).
2. **Add a feature flag.** `notifications.email_provider` with values `smtp` | `ses` | `postmark`. Default `smtp` (M2). Per-tenant override via `FeatureFlagAssignment`.
3. **Dual-write (M3).** During the swap window, send via both providers; compare delivery rates. (Skipped in M2 if the swap is low-risk.)
4. **Cut over.** Flip the flag for one tenant (canary), monitor for a day, then flip for all tenants.
5. **What does NOT change.** The `NotificationAggregate` schema, the template registry, the event subscribers, the audit log. The provider swap is invisible to the application.

The same path applies to `SMSProvider` (Twilio → Africa's Talking for Ghana), `PushProvider` (FCM → APNS for iOS-only tenants), and `InAppProvider` (database → Redis for higher throughput, M3).

---

## 7. Notification Policy

The `NotificationPolicyService` (declared in the M1 domain skeleton, `src/packages/domain/contexts/notifications/services.ts`) gates every notification:

### 7.1 User preferences
Each user has a `UserPreference` row with per-channel and per-category preferences:

```prisma
model UserPreference {
  userId           String   @id
  organizationId   String
  preferredLocale  String   @default("en")
  timezone         String   @default("Africa/Accra")
  // Per-channel master switches
  emailEnabled     Boolean  @default(true)
  smsEnabled       Boolean  @default(false)
  pushEnabled      Boolean  @default(true)
  inAppEnabled     Boolean  @default(true)
  // Per-category overrides (JSON: { "security": true, "marketing": false, "transactional": true })
  categoryOverrides String @default("{}")
  // Quiet hours (user's local time)
  quietHoursStart  String?  // "22:00"
  quietHoursEnd    String?  // "07:00"
  quietHoursTimezone String? // defaults to UserPreference.timezone
}
```

Categories: `security` (login alerts, MFA events), `transactional` (booking confirmations, payment receipts), `marketing` (product updates — M3), `compliance` (audit exports, breach notifications — always on, cannot be suppressed).

### 7.2 Quiet hours
Notifications of category `marketing` and `transactional` are suppressed during quiet hours (deferred to the next allowed slot). `security` and `compliance` notifications bypass quiet hours (a 3 AM login alert must reach the user immediately).

### 7.3 Rate limits
Per-recipient per-channel rate limits prevent notification fatigue:
- Email: max 10/hour, max 50/day (per recipient).
- SMS: max 5/hour, max 20/day (SMS costs money and is intrusive).
- Push: max 20/hour, max 100/day.
- In-app: no rate limit (cheap, user-controlled).

When a rate limit is hit, the notification is deferred (queued for the next slot) — not dropped. The `nextAllowedSlot` method on `NotificationPolicyService` returns the earliest allowed time.

### 7.4 Suppression audit
Every suppressed notification is recorded (status `SUPPRESSED`, `failureReason` = the policy reason) for audit. This is important for compliance: if a user complains "I was not notified of the breach", the audit log shows whether the breach notification was sent, suppressed (quiet hours + low-priority category — but breach notifications are `compliance` and bypass quiet hours), or failed.

---

## 8. Channel Dispatch

The `ChannelDispatcher` worker runs continuously (M1 `@eks/workers` `JobQueue`):

1. Polls the `Notification` table for `status=PENDING` rows, ordered by `createdAt`.
2. For each, loads the rendered template and the recipient's channel endpoints.
3. Selects the provider for the channel (per-tenant override via `FeatureFlagAssignment`, fallback to the global default).
4. Calls `provider.send(message)`.
5. On success → `Notification.status=DISPATCHED`, `dispatchedAt=now`, store `providerMessageId`.
6. On failure → increment `attempts`; if `attempts < 5`, retry with exponential backoff (1 min, 5 min, 30 min, 2 h, 8 h); if `attempts == 5`, `Notification.status=FAILED`, audit `NOTIFICATION_FAILED`.
7. Webhook callbacks (from SES, Twilio, FCM) update `Notification.status=DELIVERED` and store the provider's delivery timestamp.

### 8.1 Provider failover
If the primary provider returns a hard failure (5xx, network error), the dispatcher retries with the secondary provider (if configured per-tenant). If both fail, the notification is marked `FAILED` and the on-call is paged for sustained failure rates > 5 %.

---

## 9. Audit

Every notification lifecycle transition stages a domain event and writes an audit log row:

| Transition | Audit action | Notes |
|---|---|---|
| Composed (PENDING) | `NOTIFICATION_COMPOSED` | Template key, channel, recipient. |
| Dispatched | `NOTIFICATION_DISPATCHED` | Provider, providerMessageId. |
| Delivered | `NOTIFICATION_DELIVERED` | Confirmed by provider webhook. |
| Failed | `NOTIFICATION_FAILED` | Failure reason, attempts. |
| Suppressed | `NOTIFICATION_SUPPRESSED` | Policy reason (quiet hours, rate limit, user preference). |
| Opened (email) | `NOTIFICATION_OPENED` | From email tracking pixel (M3). |
| Clicked (email) | `NOTIFICATION_CLICKED` | From link wrapping (M3). |

The audit log lets the support team answer "did Amara receive her password-changed email?" definitively: the audit row shows composed → dispatched → delivered with timestamps.

---

## 10. Cross-References

| Topic | Document |
|---|---|
| Identity events that trigger notifications | `AUTHENTICATION_FLOWS.md` (every flow's last step) |
| MFA-related notifications (recovery codes, clone alerts) | `MFA.md` §10 |
| Breach notification (mass-send to affected users) | `DISASTER_RECOVERY.md` §5.6.4 |
| M1 notifications domain skeleton | `src/packages/domain/contexts/notifications/` |
| M1 events / outbox (the source of identity events) | `docs/EVENT_CONVENTIONS.md` |
| M1 platform-wide notifications design (broader scope) | `docs/ARCHITECTURE.md` §4 (bounded context: notifications) |
