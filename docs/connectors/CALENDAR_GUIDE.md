# Eks-Food Connector Ecosystem — Calendar Integration Guide

> **Audience:** Platform engineers building scheduling features, ops engineers monitoring calendar sync, integration partners adding a new calendar provider. Read alongside `PROVIDER_DEVELOPMENT.md`, `PROVIDER_SELECTION.md`, `CONNECTOR_OPERATIONS.md`, and `SYNCHRONIZATION_GUIDE.md` (the M4 sync engine).
>
> **Status:** Milestone 5. This document covers the **calendar** category of the `@eks/connectors` package (`src/packages/connectors/calendar/`), its three production adapters (Google Calendar, Microsoft Outlook/graph, CalDAV), the canonical schema, the incremental sync model, and the per-tenant connection model that backs the scheduling context.

---

## 1. Why Calendar Matters to Eks-Food

Calendar integration is the substrate for cook scheduling:

- **Cook availability** — a cook marks "available 9am-5pm Mon-Fri" in their Google Calendar; Eks-Food respects that.
- **Booking blocking** — when a booking is created, Eks-Food writes an event to the cook's calendar; when the booking is cancelled, the event is removed.
- **Customer reminders** — for catering events, the customer gets a calendar invite alongside the in-app notification.
- **Cross-platform sync** — cooks who use Outlook at their day job see Eks-Food bookings on their phone's Outlook app.
- **Corporate meals** — the corporate customer's meeting calendar drives the recurring meal schedule (every Tuesday 12:30 stand-up → meal drop-off 12:15).
- **Government inspections** — scheduled inspections block the cook's calendar automatically.

Each cook (and each corporate customer) has at most one calendar provider connected, modelled by the `CalendarConnection` table. The selection engine uses the `tenant-pinned` strategy for calendar — there's no failover between Google and Outlook for a single user.

---

## 2. The Three Providers

| Provider | Code | API | Auth | Use case |
|---|---|---|---|---|
| Google Calendar | `google-calendar` | Calendar API v3 | OAuth2 authorization-code (with refresh) | Cooks on Gmail / Google Workspace |
| Microsoft Outlook | `outlook` | Microsoft Graph (calendar endpoint) | OAuth2 authorization-code (MSAL) | Cooks on Microsoft 365 / Outlook.com |
| CalDAV | `caldav` | CalDAV (RFC 4791) + Apple Calendar Server | Basic auth / OAuth2 (where supported) | Self-hosted (Nextcloud, Baïkal, Radicale); Apple iCloud (app-specific password) |

Google and Outlook are the dominant providers for Eks-Food's user base; CalDAV covers the long tail of self-hosted and iCloud users.

---

## 3. The Prisma Model

The `CalendarConnection` model records the per-user calendar binding. One row per user, scoped to the user's organisation.

```prisma
model CalendarConnection {
  id              String   @id @default(cuid())
  organizationId  String
  userId          String   // → User.id
  providerConfigId String? // → ProviderConfiguration.id (null if user uses platform-default provider)
  providerCode    String   // "google-calendar" | "outlook" | "caldav"
  // The remote calendar ID (Google: primary email or calendarId; Outlook: calendar id;
  // CalDAV: calendar URL)
  remoteCalendarId String
  // Sync state — opaque to the engine; adapter-managed
  syncToken       String?  // Google: nextSyncToken; Outlook: deltaToken; CalDAV: sync-token
  lastSyncAt      DateTime?
  lastEventId     String?  // last event seen, for cursor resumption
  // Permissions granted by the user
  scopes          String   @default("[]") // JSON array: ["read", "write"]
  // Status
  status          String   @default("ACTIVE") // ACTIVE | PAUSED | REVOKED | ERROR
  lastError       String?
  connectedAt     DateTime @default(now())
  revokedAt       DateTime?
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, userId, providerCode])
  @@index([organizationId, status])
}
```

The `ProviderConfiguration` row referenced by `providerConfigId` carries the OAuth2 client ID / secret (encrypted, on `ProviderCredential`). For CalDAV, the `ProviderConfiguration` carries the server URL template; the user's credentials are on the `CalendarConnection`-linked `ProviderCredential` (encrypted).

---

## 4. The Canonical Schema

All three adapters normalise to `CanonicalCalendarEvent`:

```typescript
export const CanonicalCalendarEvent = z.object({
  schemaVersion: z.literal("1.2.0"),
  id: z.string(),                              // Eks-Food's internal ID (deterministic from provider+remoteId)
  remoteId: z.string(),                        // provider-specific event ID
  calendarId: z.string(),                      // remoteCalendarId from CalendarConnection
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  startUtc: z.string().datetime(),
  endUtc: z.string().datetime(),
  isAllDay: z.boolean().default(false),
  isRecurring: z.boolean().default(false),
  recurrenceRule: z.string().optional(),       // iCal RRULE (RFC 5545)
  recurrenceExceptions: z.array(z.string()).default([]), // RECURRENCE-ID list
  attendees: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional(),
    status: z.enum(["needs_action", "accepted", "declined", "tentative"]).default("needs_action"),
    isOrganizer: z.boolean().default(false),
  })).default([]),
  reminders: z.array(z.object({
    minutesBefore: z.number().int().min(0),
    method: z.enum(["email", "popup", "sms"]).default("popup"),
  })).default([]),
  status: z.enum(["confirmed", "tentative", "cancelled"]).default("confirmed"),
  visibility: z.enum(["default", "public", "private"]).default("default"),
  provider: z.string(),
  providerMetadata: z.record(z.unknown()).optional(),
  etag: z.string().optional(),                // for optimistic concurrency on writes
  updatedAt: z.string().datetime(),
});
```

The canonical form uses **iCal RRULE** for recurrence — the lingua franca of calendar data. Google's `recurrence[]` array, Outlook's `recurrence.pattern`, and CalDAV's native `RRULE` are all normalised to the iCal string.

### 4.1 Free/Busy

```typescript
export const CanonicalFreeBusy = z.object({
  calendarId: z.string(),
  ranges: z.array(z.object({
    startUtc: z.string().datetime(),
    endUtc: z.string().datetime(),
    busyType: z.enum(["busy", "tentative", "out-of-office"]).default("busy"),
  })),
  provider: z.string(),
});
```

### 4.2 Availability

```typescript
export const CanonicalAvailability = z.object({
  calendarId: z.string(),
  slots: z.array(z.object({
    startUtc: z.string().datetime(),
    endUtc: z.string().datetime(),
    available: z.boolean(),
  })),
  provider: z.string(),
});
```

---

## 5. The Service Surface

```typescript
export const calendar = {
  // Connection management
  connect(input: { userId: string; providerCode: string; authCode: string }): Promise<{ connectionId: string }>,
  disconnect(input: { connectionId: string }): Promise<void>,
  listConnections(input: { userId: string }): Promise<CalendarConnection[]>,
  // Calendar discovery
  listCalendars(input: { connectionId: string }): Promise<Array<{ id: string; label: string; isPrimary: boolean }>>,
  // Event read
  listEvents(input: { connectionId: string; from: Date; to: Date; includeCancelled?: boolean }): Promise<CanonicalCalendarEvent[]>,
  getEvent(input: { connectionId: string; remoteId: string }): Promise<CanonicalCalendarEvent>,
  // Event write (idempotent via client-supplied idempotencyKey)
  createEvent(input: { connectionId: string; event: Omit<CanonicalCalendarEvent, "id"|"remoteId"|"provider">; idempotencyKey: string }): Promise<CanonicalCalendarEvent>,
  updateEvent(input: { connectionId: string; remoteId: string; patch: Partial<CanonicalCalendarEvent>; etag: string }): Promise<CanonicalCalendarEvent>,
  deleteEvent(input: { connectionId: string; remoteId: string }): Promise<void>,
  // Free/busy + availability
  freeBusy(input: { connectionId: string; from: Date; to: Date }): Promise<CanonicalFreeBusy>,
  findAvailability(input: { connectionId: string; from: Date; to: Date; durationMin: number; bufferMin?: number }): Promise<CanonicalAvailability>,
  // Sync
  incrementalSync(input: { connectionId: string }): Promise<{ added: CanonicalCalendarEvent[]; updated: CanonicalCalendarEvent[]; removed: string[]; nextSyncToken: string }>,
  fullResync(input: { connectionId: string }): Promise<{ events: CanonicalCalendarEvent[]; nextSyncToken: string }>,
};
```

---

## 6. OAuth2 Connection Flow

Google and Outlook use OAuth2 authorization-code with PKCE. The flow:

1. **Initiate** — the cook clicks "Connect Google Calendar" in the Console. The frontend calls `POST /api/v1/providers/calendar/connect/initiate` with `{ providerCode: "google-calendar", userId }`. The route generates a PKCE verifier + challenge, stores them in the M2 `Session`, and returns the provider's auth URL.
2. **Redirect** — the cook is redirected to Google's consent screen. They approve the requested scopes (`calendar.events`, `calendar.readonly`).
3. **Callback** — Google redirects to `/api/v1/providers/calendar/connect/callback?code=...&state=...`. The route exchanges the auth code for an access + refresh token, encrypts them via `@eks/security`, writes a `ProviderCredential` row, and creates a `CalendarConnection` row with `status = ACTIVE`.
4. **Calendar discovery** — the route immediately calls `calendar.listCalendars` to populate the `remoteCalendarId` (default: the user's primary calendar).
5. **Initial sync** — the route enqueues a `fullResync` via the M4 `Scheduler` to backfill the cook's calendar into Eks-Food's cache.

The M4 `AuthProvider` (OAuth2 strategy) handles token refresh automatically: when an access token expires, the adapter's `authenticate` method refreshes it via the refresh token, updates `ProviderCredential.encryptedSecret`, and writes the new access token to `ConnectorCache` under `oauth:tokens`.

### 6.1 Scopes

| Provider | Scopes requested |
|---|---|
| Google Calendar | `https://www.googleapis.com/auth/calendar.events` (read/write events only — not calendar list) |
| Outlook | `Calendars.ReadWrite` (read/write user's calendars) |
| CalDAV | N/A — basic auth or per-server OAuth2 |

Scopes are minimal — Eks-Food never requests contact-list access or email read access via the calendar integration.

### 6.2 Revocation

The cook can disconnect at any time via the Console. The disconnect flow:

1. `POST /api/v1/providers/calendar/:connectionId/disconnect`
2. The route calls the provider's token-revocation endpoint (Google: `https://oauth2.googleapis.com/revoke`; Outlook: `https://graph.microsoft.com/v1.0/me/revokeSignInSessions`).
3. The route sets `CalendarConnection.status = REVOKED`, `revokedAt = now()`, and deletes the encrypted `ProviderCredential` row.
4. Cached events for that connection are flushed (`ConnectorCache` entries under `calendar:events:<connectionId>`).
5. The route publishes a `CalendarDisconnected` event on the M1 `EventOutbox`. The matching engine listens and stops considering the cook's calendar for new bookings.

If the user revokes access *at the provider* (e.g. via Google Account settings) without telling Eks-Food, the next `incrementalSync` will fail with `AUTH_FAILED`. The adapter marks the connection `status = ERROR`, `lastError = "auth_revoked"`, and the matching engine treats the cook's calendar as "unknown availability" (degrades to manual confirmation).

---

## 7. Incremental Synchronization

Calendar sync is incremental: each call returns only the events that changed since the last sync token. The flow per provider:

### 7.1 Google Calendar

Google's Calendar API supports `syncToken`-based incremental sync:

```
GET /calendars/{calendarId}/events?syncToken={lastSyncToken}
```

Returns events added/updated/deleted since the sync token was issued. The response includes a `nextSyncToken` for the next call. Adapters store `nextSyncToken` on `CalendarConnection.syncToken`.

If the sync token is expired (more than 1 week old, or the calendar has had > 25,000 changes), Google returns 410 Gone with `X-Sync-Token-Expired`. The adapter triggers a `fullResync` automatically.

### 7.2 Microsoft Outlook

Outlook's Microsoft Graph API supports delta queries:

```
GET /me/calendars/{calendarId}/calendarView/delta?startDateTime=...&endDateTime=...
```

The response includes a `@odata.deltaLink` for the next call. The adapter stores this on `CalendarConnection.syncToken`.

Outlook's delta tokens expire after 7 days. The adapter triggers a `fullResync` when this happens.

### 7.3 CalDAV

CalDAV supports `sync-token` (RFC 6578):

```
REPORT /calendars/{user}/{calendar}/ HTTP/1.1
Content-Type: application/xml
...
<sync-collection xmlns="DAV:">
  <sync-token>{lastSyncToken}</sync-token>
</sync-collection>
```

Server support varies: Apple Calendar Server, Nextcloud, and Baïkal support `sync-token`; Radicale supports it from v3. For servers that don't support `sync-token`, the adapter falls back to `CTag`-based polling: it fetches the calendar's `CTag` (a content hash), compares to the last seen, and if changed, fetches the full calendar with `If-None-Match` per-event.

### 7.4 Sync cadence

The M4 `Scheduler` runs `incrementalSync` for every `ACTIVE` `CalendarConnection` every 5 minutes. This is the right trade-off between freshness (cooks want their bookings to show up in Google Calendar within minutes) and quota (Google Calendar's free tier allows 1M queries/day; 5-min cadence is well within).

For cooks with a high booking volume, the calendar webhook (Google `watch` / Outlook `subscriptions`) provides push notifications, eliminating polling. When a webhook is registered, the scheduler skips the polling sync for that connection.

---

## 8. Recurring Events

Recurring events are the trickiest part of calendar integration. The canonical schema preserves the iCal RRULE string (e.g. `FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20251231T235959Z`) and the adapter handles expansion.

### 8.1 Reading

When the engine reads a recurring event from the provider:

- Google returns a `recurrence[]` array with the RRULE lines, plus optional `recurrenceException` IDs.
- Outlook returns a `recurrence.pattern` and `recurrence.range` object.
- CalDAV returns the native `RRULE` property.

All three are normalised to a single `recurrenceRule` string + `recurrenceExceptions[]` array. The canonical event's `startUtc`/`endUtc` is the *first occurrence*; downstream code expands the recurrence as needed.

Expansion is done via the `rrule` library (RFC 5545 compliant) on the Eks-Food side, not the provider. This keeps the canonical model provider-agnostic and lets the matching engine reason about future occurrences without per-provider API calls.

### 8.2 Writing

When the matching engine writes a recurring booking (e.g. corporate meals every Tuesday), it constructs the canonical event with `recurrenceRule` set. The adapter translates this to:

- Google: `recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=..."]`
- Outlook: `recurrence: { pattern: { type: "weekly", daysOfWeek: ["tuesday"] }, range: { type: "endDate", endDate: "..." } }`
- CalDAV: native `RRULE` property in the iCalendar payload

### 8.3 Exceptions

Modifying a single occurrence of a recurring event (e.g. skip next Tuesday's meal) creates an exception:

- The canonical event gets `recurrenceExceptions: ["2025-01-21T12:30:00Z"]` (the RECURRENCE-ID of the skipped occurrence).
- The adapter translates to: Google `recurrenceException` ID, Outlook single-event override, CalDAV `RECURRENCE-ID` property with `STATUS:CANCELLED`.

Cancellation of the entire series sets `status: "cancelled"` on the master event; the adapter translates to a delete on the provider.

---

## 9. Timezone Handling

All canonical timestamps are **UTC**. The local timezone is preserved as a separate field on the event (the iCal `VTIMEZONE` block is captured in `providerMetadata.timezone`).

When reading:
- Google returns `start.dateTime` (with offset) for timed events or `start.date` for all-day events. The adapter converts to UTC ISO-8601.
- Outlook returns `start.dateTime` + `start.timeZone` (IANA name). The adapter converts.
- CalDAV returns `DTSTART;TZID=...`. The adapter resolves the TZID to UTC.

When writing:
- The adapter converts UTC back to the calendar's local timezone (stored on `CalendarConnection` via the `listCalendars` response).
- For all-day events, the adapter uses `DTSTART;VALUE=DATE:20250115` (no time component).

---

## 10. Webhooks

Google Calendar and Outlook support push notifications (webhooks) for change detection:

### 10.1 Google Calendar watch

```
POST /calendars/{calendarId}/events/watch
{
  "id": "{uuid}",
  "type": "web_hook",
  "address": "https://eks-food.com/api/v1/providers/calendar/webhook/google-calendar"
}
```

Google sends a POST to the address with `X-Goog-Channel-ID`, `X-Goog-Resource-ID`, `X-Goog-Resource-State` (`exists`, `sync`, `update`) headers. The webhook handler verifies the channel ID, then triggers an `incrementalSync` for the affected `CalendarConnection`. The watch expires after 7 days (Google's max); the adapter renews it 1 day before expiry.

### 10.2 Outlook subscriptions

```
POST /subscriptions
{
  "changeType": "created,updated,deleted",
  "notificationUrl": "https://eks-food.com/api/v1/providers/calendar/webhook/outlook",
  "resource": "/me/calendars/{calendarId}/events",
  "expirationDateTime": "2025-01-22T00:00:00Z"
}
```

Outlook sends a validation challenge on registration (a POST with `validationToken` query param; the endpoint must echo it in the response body with `Content-Type: text/plain`). The adapter handles this automatically. Subscriptions expire after 3 days (Outlook's max); the adapter renews daily.

### 10.3 CalDAV

CalDAV doesn't have a standard push mechanism (some servers support `push-transports` but adoption is low). CalDAV connections rely on the 5-minute polling sync.

---

## 11. The Booking → Calendar Write Flow

When a customer books a cook:

```typescript
import { calendar } from "@eks/connectors/calendar";

async function onBookingCreated(booking: Booking): Promise<void> {
  const conn = await db.calendarConnection.findFirst({
    where: { userId: booking.cookUserId, status: "ACTIVE" },
  });
  if (!conn) return; // cook has no calendar connected; skip silently

  await calendar.createEvent({
    connectionId: conn.id,
    idempotencyKey: `booking:${booking.id}`,
    event: {
      schemaVersion: "1.2.0",
      calendarId: conn.remoteCalendarId,
      title: `Eks-Food booking: ${booking.customerName}`,
      description: `Booking code ${booking.code}. Menu: ${booking.menuSummary}`,
      location: booking.customerAddress,
      startUtc: booking.scheduledStart.toISOString(),
      endUtc: booking.scheduledEnd.toISOString(),
      isAllDay: false,
      isRecurring: false,
      attendees: [
        { email: booking.cookEmail, name: booking.cookName, isOrganizer: true, status: "accepted" },
        { email: booking.customerEmail, name: booking.customerName, status: "needs_action" },
      ],
      reminders: [
        { minutesBefore: 60, method: "popup" },
        { minutesBefore: 15, method: "popup" },
      ],
      status: "confirmed",
      visibility: "private",
      updatedAt: new Date().toISOString(),
    },
  });
}
```

The `idempotencyKey` ensures the event is created exactly once even if the booking creation is retried. The M4 `WebhookPlatform`'s unique `(endpointId, eventId)` index is reused at the calendar layer: the adapter derives a deterministic remote ID from the idempotency key.

If the cook later cancels the booking:

```typescript
async function onBookingCancelled(booking: Booking): Promise<void> {
  const conn = await db.calendarConnection.findFirst({
    where: { userId: booking.cookUserId, status: "ACTIVE" },
  });
  if (!conn) return;
  const remoteId = deriveRemoteId(`booking:${booking.id}`); // deterministic
  await calendar.deleteEvent({ connectionId: conn.id, remoteId });
}
```

The `deriveRemoteId` function hashes the idempotency key into a provider-compatible ID format. For Google, this is stored in the event's `extendedProperties.private.eksBookingId` for later lookup. For Outlook, in `singleValueExtendedProperties`. For CalDAV, in the `X-EKS-BOOKING-ID` property.

---

## 12. Free/Busy for Matching

The matching engine consults the cook's calendar free/busy before offering a booking:

```typescript
async function isCookAvailable(cookUserId: string, start: Date, end: Date): Promise<boolean> {
  const conn = await db.calendarConnection.findFirst({
    where: { userId: cookUserId, status: "ACTIVE" },
  });
  if (!conn) return true; // no calendar → assume available

  const freeBusy = await calendar.freeBusy({
    connectionId: conn.id,
    from: start,
    to: end,
  });
  return !freeBusy.ranges.some(r =>
    new Date(r.startUtc) < end && new Date(r.endUtc) > start
  );
}
```

The free/busy call is cached for 60 s (`freebusy:v1` namespace). For cooks with very high booking volume, the cache is invalidated on every booking write — but the matching engine reads it many times per minute, so the cache hit rate is high.

### 12.1 Google free/busy

Google's free/busy API (`POST /freeBusy`) accepts multiple calendar IDs and a time range. The adapter calls it once per `freeBusy` invocation with the cook's primary calendar ID.

### 12.2 Outlook free/busy

Outlook exposes free/busy via the `getSchedule` endpoint (`POST /me/getSchedule`). The adapter wraps it the same way.

### 12.3 CalDAV free/busy

CalDAV servers expose free/busy via `VFREEBUSY` requests or via the `calendar-availability` property. Support varies; the adapter falls back to fetching events and computing busy ranges client-side if `VFREEBUSY` isn't supported.

---

## 13. Caching Strategy

| Capability | Namespace | TTL | Notes |
|---|---|---|---|
| `list-calendars` | `cal-list:v1` | 24 h | Calendars rarely change; invalidate on disconnect |
| `list-events` | `cal-events:<connId>:v1` | 60 s | Short TTL — events change frequently; sync refreshes |
| `get-event` | `cal-event:<connId>:v1` | 60 s | Same |
| `free-busy` | `freebusy:<connId>:v1` | 60 s | Same |
| `availability` | `avail:<connId>:v1` | 5 min | Derived; can be cached longer |
| OAuth tokens | `oauth:tokens` | `expires_in - 60s` | Per-credential; encrypted |

The `list-events` cache is keyed by `(connectionId, from, to)`. A 60 s TTL is sufficient because the incremental sync refreshes the underlying data every 5 min and webhook deliveries trigger immediate invalidation.

---

## 14. Operations

### 14.1 Connection health

The M4 `HealthMonitor` checks each `CalendarConnection` every 5 min by calling `listCalendars`. If the call fails with `AUTH_FAILED`, the connection is marked `status = ERROR`, `lastError = "auth_revoked"`, and the matching engine treats the cook's calendar as "unknown availability".

If the call fails with a 5xx, the connection remains `ACTIVE` but `ProviderHealth.status = DEGRADED` for the underlying `ProviderConfiguration`.

### 14.2 Sync lag

`ProviderHealth.syncLagSec` for calendar is computed as `now - lastSyncAt`. A sync lag > 5 min (one missed sync cycle) is acceptable; > 15 min is `DEGRADED`; > 30 min is `UNHEALTHY` (page on-call).

### 14.3 Quota

Google Calendar's free tier is 1M queries/day per project; Outlook is 10k calls/10 min per app. Both are well above Eks-Food's per-tenant needs (a typical cook generates ~5 queries/min = 7,200/day).

Quota usage is tracked per `ProviderConfiguration` via `ProviderHealth.callsLastDay`. The dashboard surfaces burn-down; > 80% triggers a warning.

### 14.4 Webhook delivery failures

Calendar webhooks (Google watch, Outlook subscriptions) can fail silently if:

- The provider can't reach Eks-Food's webhook URL (DNS / TLS issue).
- The webhook URL was rotated and the subscription points to the old URL.
- The subscription expired (Google 7 days, Outlook 3 days) without being renewed.

The webhook monitor (see `CONNECTOR_OPERATIONS.md` §5) surfaces these. On a sustained delivery failure, the scheduler falls back to polling; the webhook registration is retried on the next sync.

---

## 15. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Persisting the remote event ID across providers | Cook switches from Google to Outlook; bookings can't be cancelled | Use the deterministic `idempotencyKey`-derived ID; re-derive on each call |
| Treating all-day events as UTC midnight | Cook in GMT sees all-day event shifted by 8 hours | Convert using the calendar's local timezone, not UTC |
| Forgetting to handle recurrence exceptions | Recurring booking shows the cancelled occurrence | Filter by `recurrenceExceptions[]` when expanding |
| Calling `free-busy` per booking attempt | Quota burn; cache miss every time | Cache 60 s; invalidate on booking write |
| Hardcoding Google's `primary` calendar ID | Cook with a custom primary calendar sees events on the wrong calendar | Always call `listCalendars` first and let the cook pick |
| Re-using OAuth refresh tokens past expiry | Auth failures on long-inactive connections | Refresh tokens expire after 6 months; surface in dashboard; re-auth on next login |
| CalDAV via Apple iCloud without app-specific password | Auth failures | Document the app-specific password flow in the connection UI |
| Polling every 30 seconds for a 5-min webhook-driven sync | Quota burn; provider-side rate limits | Use webhooks when available; fall back to 5-min polling |

---

## 16. Further Reading

- `PROVIDER_DEVELOPMENT.md` — the adapter authoring pattern.
- `PROVIDER_SELECTION.md` — the `tenant-pinned` strategy used for calendar.
- `CONNECTOR_OPERATIONS.md` — webhook monitor, sync dashboard, cache inspector.
- `DISASTER_RECOVERY.md` — calendar-specific DR (sync token corruption, OAuth revocation, webhook failure cascade).
- `docs/integration/SYNCHRONIZATION_GUIDE.md` — the M4 sync engine (underlying incremental sync model).
- `docs/integration/AUTHENTICATION_GUIDE.md` — OAuth2 strategies, refresh-token handling.
- `docs/integration/WEBHOOK_GUIDE.md` — webhook delivery, signatures, retries (M4 foundation).
