# Eks-Food Connector Webhook Guide

> **Audience:** Connector authors, integration architects, on-call maintainers. Read alongside `ARCHITECTURE.md` (Webhooks bounded context), `CONNECTOR_DEVELOPMENT.md` §3.6 (the `handleWebhook()` method), `AUTHENTICATION_GUIDE.md` §3.9 (signed requests), `SYNCHRONIZATION_GUIDE.md` (sync-vs-webhook trade-offs), and `OPERATIONS_RUNBOOK.md` (webhook delivery failure runbook).
>
> **Status:** M4. The webhook platform lives in `@eks/integration/webhooks.ts`. State is persisted in `WebhookEndpoint` (one row per registered endpoint) and `WebhookDelivery` (one row per delivered webhook). The platform supports both **inbound** webhooks (external system → Eks-Food) and **outbound** webhooks (Eks-Food → external system, e.g. notifying Acme when a booking is created).

---

## 1. Webhook Platform Overview

A webhook is an HTTP callback. The platform handles:

| Concern | Inbound | Outbound |
|---|---|---|
| Endpoint registration | `POST /api/v1/integrations/webhooks/endpoints` (per-connector) | `POST /api/v1/integrations/webhooks/endpoints` (per-connector or per-event) |
| Verification | Challenge-response (e.g. Stripe's `challenge` handshake) | n/a (we are the sender) |
| Signature validation | HMAC-SHA256 (configurable algorithm) | HMAC-SHA256 (we sign outgoing) |
| Replay protection | Timestamp window (±5 min) + nonce (eventId) | n/a (recipient's responsibility) |
| Idempotency | `eventId` dedupe via `WebhookDelivery.eventId` unique index | `eventId` sent in header for recipient dedupe |
| Delivery tracking | `WebhookDelivery` row per received webhook | `WebhookDelivery` row per sent webhook |
| Retries | `RetryPolicy` attached to `WebhookEndpoint` | `RetryPolicy` attached to `WebhookEndpoint` |
| Dead-letter queue | DLQ after `RetryPolicy.maxAttempts` failures | Same |
| Filtering | Event-type filter on `WebhookEndpoint` (regex) | Event-type filter on `WebhookEndpoint` (regex) |

The webhook subsystem is **separate from** the sync engine. A connector may use one or both: webhooks for low-latency event notifications (sub-second), sync for batch reconciliation (every few minutes). The two paths converge at the `EventOutbox` — both produce domain events that the M3 `@eks/domain` handlers apply to aggregates.

---

## 2. The `WebhookEndpoint` Model

```prisma
model WebhookEndpoint {
  id              String   @id @default(cuid())
  organizationId  String   // tenant scope
  // The connector that owns this endpoint (null for platform-owned endpoints)
  connectorConfigId String?
  // INBOUND (we receive) or OUTBOUND (we send)
  direction       String   // "INBOUND" | "OUTBOUND"
  // The slug used in the URL: /api/v1/integrations/webhooks/inbound/:slug
  // (for inbound) or the destination URL (for outbound)
  slug            String?
  url             String?
  // The list of event types this endpoint handles (JSON array; regex supported)
  eventTypes      String   @default("[]")
  // The signature configuration (JSON: algorithm, header, secretName, timestampHeader, nonceHeader)
  signatureConfig String   @default("{}")
  // The retry policy ID (→ RetryPolicy)
  retryPolicyId   String?
  // The verification config (JSON: kind, challengeField, responseField)
  verificationConfig String?
  // ACTIVE | PAUSED
  status          String   @default("ACTIVE")
  // Stats (rolled up every 5m by the health job)
  totalDelivered  Int      @default(0)
  totalFailed     Int      @default(0)
  lastDeliveryAt  DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  deliveries      WebhookDelivery[]

  @@unique([organizationId, direction, slug])  // for inbound
  @@unique([organizationId, direction, url, eventTypes])  // for outbound
  @@index([organizationId, status])
  @@index([connectorConfigId])
}
```

---

## 3. The `WebhookDelivery` Model

```prisma
model WebhookDelivery {
  id              String   @id @default(cuid())
  endpointId      String   // → WebhookEndpoint.id
  organizationId  String   // tenant scope (denormalised)
  // INBOUND or OUTBOUND
  direction       String
  // The event id from the webhook (X-Event-Id header) — used for idempotency
  eventId         String
  // The event type (e.g. "order.status.changed")
  eventType       String
  // The delivery status: RECEIVED | PROCESSING | DELIVERED | FAILED | DLQ
  status          String
  // The request (redacted JSON: headers, body)
  request         String   @default("{}")
  // The response (for outbound: status code, body excerpt)
  response        String   @default("{}")
  // The attempt number (1, 2, 3, ...)
  attempt         Int      @default(0)
  // The next attempt time (for retry scheduling)
  nextAttemptAt   DateTime?
  // The error message (set on FAILED)
  errorMessage    String?
  // The total duration (for outbound: time to send + receive)
  durationMs      Int      @default(0)
  receivedAt      DateTime @default(now())
  deliveredAt     DateTime?

  endpoint        WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@unique([endpointId, eventId])  // idempotency
  @@index([endpointId, status])
  @@index([organizationId, status, receivedAt])
  @@index([nextAttemptAt])  // for the retry worker
}
```

The `eventId` unique index is the **idempotency guarantee**: a webhook re-sent with the same `eventId` (e.g. because the upstream didn't receive our `200 OK`) is a no-op. The second delivery is recorded as `status=DELIVERED` with `response.duplicate=true` (and the original's response is echoed back).

---

## 4. Inbound Webhooks

### 4.1 Endpoint registration

A connector declares its inbound endpoint in the manifest:

```json5
{
  connector: {
    webhooks: [
      {
        slug: "acme-pos",  // → POST /api/v1/integrations/webhooks/inbound/acme-pos
        eventTypes: ["order.status.changed", "menu.updated"],
        signature: {
          algorithm: "hmac-sha256",
          header: "X-Acme-Signature",
          secretName: "ACME_WEBHOOK_SECRET",  // resolved via ConnectorCredential or SecretReference
          timestampHeader: "X-Acme-Timestamp",
          nonceHeader: "X-Acme-Event-Id",
        },
        verification: {
          kind: "challenge-response",
          challengeField: "challenge",
          responseField: "challenge_response",
        },
        retryPolicy: "aggressive",  // → RetryPolicy name
      },
    ],
  },
}
```

On activation, the runtime creates a `WebhookEndpoint` row (`direction=INBOUND`, `slug="acme-pos"`, `eventTypes=["order.status.changed","menu.updated"]`, ...). The endpoint URL is `https://api.eks-food.com/api/v1/integrations/webhooks/inbound/acme-pos` (or the tenant's regional endpoint).

### 4.2 Verification (challenge-response)

Some providers (notably Stripe) verify endpoint ownership by sending a `challenge` in a `GET` request and expecting a specific `challenge_response` in the response body. The platform handles this generically via the `verificationConfig` field:

```json5
{
  "kind": "challenge-response",
  "challengeField": "challenge",  // path in the request body
  "responseField": "challenge_response",  // path in the response body
}
```

The runtime intercepts `GET /api/v1/integrations/webhooks/inbound/:slug` with a `challenge` field in the query string or body, looks up the `WebhookEndpoint`, extracts the challenge, signs it with the endpoint's secret (HMAC-SHA256), and returns the response:

```json
{ "challenge_response": "<hmac>" }
```

This is a **platform-level** verification — the connector code is not involved. The connector's `handleWebhook()` is invoked only for `POST` requests after verification passes.

### 4.3 Signature validation (HMAC-SHA256)

For every inbound `POST`, the runtime verifies the signature before invoking `handleWebhook()`. The default algorithm is HMAC-SHA256:

```
expected = HMAC-SHA256(secret, timestamp + "." + body)
```

The runtime:
1. Reads `timestamp` from `X-Acme-Timestamp` (or whatever `signatureConfig.timestampHeader` declares).
2. Reads `signature` from `X-Acme-Signature` (or `signatureConfig.header`).
3. Reads `nonce` from `X-Acme-Event-Id` (or `signatureConfig.nonceHeader`).
4. **Replay protection** — checks `abs(now() - timestamp) < 5 minutes`. If outside the window, returns `401 Unauthorized` with `{"error":"timestamp_out_of_window"}`. (This prevents an attacker from replaying a captured webhook hours later.)
5. **Nonce check** — queries `WebhookDelivery` by `(endpointId, eventId=nonce)`. If a row exists with `status=DELIVERED`, returns `200 OK` with `{"status":"duplicate"}` (idempotent — the upstream already received our `200` for this event).
6. **Signature verification** — computes `HMAC-SHA256(secret, timestamp + "." + rawBody)` and compares with `signature` using `timingSafeEqual`. If mismatch, returns `401 Unauthorized` with `{"error":"invalid_signature"}`.
7. Creates a `WebhookDelivery` row (`status=RECEIVED`, `eventId=nonce`, `eventType=<from body or header>`, `request={headers, body}`).
8. Invokes `connector.handleWebhook(ctx, body, headers)`.

Other supported algorithms (via `signatureConfig.algorithm`):
- `hmac-sha256` (default)
- `hmac-sha1` (legacy; discouraged)
- `rsa-sha256` (e.g. GitHub's webhooks)
- `ed25519` (e.g. Slack's signed webhooks)

### 4.4 The connector's `handleWebhook()`

The connector receives the verified payload and produces domain events (see `CONNECTOR_DEVELOPMENT.md` §3.6). The runtime wraps the invocation in a `WebhookDelivery` lifecycle:

```
RECEIVED → (handleWebhook invoked) → PROCESSING
  → on success: DELIVERED (records the WebhookResult)
  → on failure: FAILED (records the error, schedules a retry per RetryPolicy)
  → on permanent failure: DLQ (after maxAttempts)
```

The connector returns:

```typescript
export interface WebhookResult {
  readonly processed: boolean;
  readonly records?: readonly unknown[];
  readonly error?: string;
}
```

- `processed: true` — the webhook was handled; the runtime transitions to `DELIVERED`.
- `processed: false, error: "..."` — the webhook was not handled (e.g. signature mismatch — though the runtime pre-checks this, the connector may double-check); the runtime transitions to `FAILED` and schedules a retry.
- Throwing — the runtime catches, transitions to `FAILED`, and schedules a retry with the error message.

### 4.5 Retries with backoff

A `RetryPolicy` template is attached to the `WebhookEndpoint`:

```prisma
model RetryPolicy {
  id              String   @id @default(cuid())
  organizationId  String?
  name            String   // e.g. "aggressive", "relaxed", "no-retry"
  // Exponential backoff parameters
  maxAttempts     Int      @default(5)
  baseDelayMs     Int      @default(1000)
  maxDelayMs      Int      @default(3600000)  // 1h cap
  // The retry condition (JSON: a JQ expression or "always" or "on_5xx")
  retryIf         String   @default("on_5xx")
  // Whether to add jitter (recommended)
  jitter          Boolean  @default(true)
  createdAt       DateTime @default(now())

  @@unique([organizationId, name])
}
```

The default policies shipped with the platform:

| Name | maxAttempts | baseDelayMs | retryIf | Use case |
|---|---|---|---|---|
| `aggressive` | 10 | 1000 | `on_5xx_or_timeout` | Critical webhooks (payments, orders) |
| `relaxed` | 5 | 5000 | `on_5xx` | Non-critical (menu updates) |
| `no-retry` | 1 | n/a | `never` | Idempotent operations already retried upstream |
| `exponential-1h` | 24 | 10000 | `on_5xx_or_timeout` | Long-running retries (e.g. recipient is down for hours) |

The retry worker (in `@eks/integration/webhooks.retry-worker.ts`) polls `WebhookDelivery WHERE nextAttemptAt <= now() AND status='FAILED'` every 5 seconds and re-attempts the delivery. The `nextAttemptAt` is computed as `now() + min(maxDelayMs, baseDelayMs * 2^attempt) + jitter(±10%)`.

If `Retry-After` header is present on a `429` response, the runtime honours it (overriding the computed delay).

### 4.6 Dead-letter queue

After `maxAttempts` failures, the `WebhookDelivery` is transitioned to `DLQ`. The platform:

1. Emits `Webhook.Dlqd` to the `EventOutbox` (consumed by `@eks/notifications` to alert the operator).
2. Moves the `WebhookDelivery` row to the DLQ partition (a separate logical partition of the same table, partitioned by `status='DLQ'` for archival efficiency).
3. The Integration Console shows the DLQ'd webhooks with a "Replay" button.

A DLQ'd webhook can be replayed:

```
POST /api/v1/integrations/webhooks/deliveries/dlv_abc/replay
```

This:
1. Resets the `WebhookDelivery` row (`status=RECEIVED`, `attempt=0`, `nextAttemptAt=now()`).
2. The retry worker picks it up on the next poll.
3. If the replay succeeds, the row transitions to `DELIVERED`; if it fails again, it goes back to `DLQ` with `attempt` incremented.

Replay is **idempotent** — the `eventId` is preserved, so if the original delivery eventually succeeded (e.g. the upstream was slow but eventually processed it), the replay is a no-op.

### 4.7 Filtering

The `WebhookEndpoint.eventTypes` field is a JSON array of event types (or regex patterns). The runtime checks `eventType` (from the webhook's body or header) against this list before invoking `handleWebhook()`. If the type is not in the list, the runtime returns `200 OK` with `{"status":"filtered"}` and creates a `WebhookDelivery` row with `status=DELIVERED` and `response.filtered=true` (so the operator can see what was filtered in the dashboard).

This is useful when a single endpoint receives many event types from the upstream (e.g. Acme sends order, menu, customer, and inventory events to the same URL) but the connector only handles a subset.

---

## 5. Outbound Webhooks

Outbound webhooks notify external systems of Eks-Food domain events. The platform handles signing, retries, and DLQ — the connector declares the subscription and the runtime does the rest.

### 5.1 Endpoint registration

```json5
{
  connector: {
    outboundWebhooks: [
      {
        url: "https://acme.test/api/v1/eks-food-webhook",
        eventTypes: ["booking.created.v1", "booking.updated.v1"],
        signature: {
          algorithm: "hmac-sha256",
          secretName: "ACME_OUTBOUND_SECRET",
          header: "X-Eks-Signature",
          timestampHeader: "X-Eks-Timestamp",
          nonceHeader: "X-Eks-Event-Id",
        },
        retryPolicy: "aggressive",
        filter: { "regionId": "r-accra" },  // optional: JQ filter on the event payload
      },
    ],
  },
}
```

On activation, the runtime:
1. Creates a `WebhookEndpoint` row (`direction=OUTBOUND`, `url=...`, `eventTypes=[...]`).
2. Subscribes to the M1 `EventBus` for the declared event types.
3. For each matching event, applies the filter (if declared) and creates a `WebhookDelivery` row (`status=RECEIVED`).

### 5.2 Delivery

The delivery worker (separate from the inbound retry worker) polls `WebhookDelivery WHERE direction='OUTBOUND' AND status='RECEIVED'` and:

1. Builds the outbound request:
   - Method: `POST`
   - URL: `WebhookEndpoint.url`
   - Body: the event payload (JSON)
   - Headers: `Content-Type: application/json`, `X-Eks-Event-Id: <uuid>`, `X-Eks-Event-Type: <type>`, `X-Eks-Timestamp: <unix>`, `X-Eks-Signature: <hmac>`
2. Sends the request via the M3 egress proxy (which enforces `allowedDomains` and rate limits).
3. On `2xx` response: transitions to `DELIVERED`.
4. On `4xx` (except `429`): transitions to `FAILED` with `errorMessage="http_4xx"`; **not retried** (the recipient rejected the webhook — retrying won't help).
5. On `429` or `5xx`: transitions to `FAILED` with `errorMessage="http_5xx_or_429"`; scheduled for retry per `RetryPolicy`.
6. On timeout: transitions to `FAILED` with `errorMessage="timeout"`; scheduled for retry.
7. After `maxAttempts`: transitions to `DLQ`.

### 5.3 Signature

The outbound signature is HMAC-SHA256 over `timestamp + "." + body`:

```typescript
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify(event);
const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "X-Eks-Event-Id": eventId,
    "X-Eks-Event-Type": eventType,
    "X-Eks-Timestamp": timestamp,
    "X-Eks-Signature": signature,
  },
  body,
});
```

The recipient verifies the signature using the shared secret (distributed out-of-band, typically via the recipient's connector on the Eks-Food side). The timestamp window and event-id nonce let the recipient apply the same replay-protection and idempotency rules the platform applies to inbound webhooks (see §4.3).

---

## 6. End-to-End Inbound Webhook Walkthrough

This section traces a single inbound webhook from Acme POS end-to-end.

### 6.1 The webhook arrives

```
POST /api/v1/integrations/webhooks/inbound/acme-pos HTTP/1.1
Host: api.eks-food.com
Content-Type: application/json
X-Acme-Signature: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
X-Acme-Timestamp: 1737000000
X-Acme-Event-Id: evt_abc123
X-Acme-Event-Type: order.status.changed

{ "type": "order.status.changed", "data": { "id": "o1", "status": "CONFIRMED", "updated_at": "2025-01-15T10:00:00Z" } }
```

### 6.2 The runtime verifies

1. Loads the `WebhookEndpoint` by `(organizationId=org_eks, direction=INBOUND, slug=acme-pos)`.
2. Reads `timestamp=1737000000` from `X-Acme-Timestamp`. Checks `abs(now() - 1737000000) < 300` — pass.
3. Reads `nonce=evt_abc123` from `X-Acme-Event-Id`. Queries `WebhookDelivery WHERE endpointId=... AND eventId='evt_abc123'` — no row, so this is a new event.
4. Reads `signature=9f86d...` from `X-Acme-Signature`. Computes `HMAC-SHA256(ACME_WEBHOOK_SECRET, "1737000000." + rawBody)` — matches.
5. Creates `WebhookDelivery` (`status=RECEIVED`, `eventId=evt_abc123`, `eventType=order.status.changed`, `request={headers, body}`).
6. Invokes `connector.handleWebhook(ctx, body, headers)`.

### 6.3 The connector handles

```typescript
const event = payload as { type: string; data: AcmeOrder };
await ctx.sdk.events.publish("acme.order.updated.v1", event.data, {
  dedupeKey: `acme-order-${event.data.id}-${event.data.updated_at}`,
});
return { processed: true, records: [event.data] };
```

### 6.4 The runtime finalises

1. Transitions `WebhookDelivery` to `DELIVERED` (sets `deliveredAt=now()`, `response={processed:true}`).
2. Increments `WebhookEndpoint.totalDelivered`.
3. Returns `200 OK` to Acme:
   ```json
   { "status": "processed", "eventId": "evt_abc123" }
   ```

### 6.5 Total wall-clock

- TLS handshake + routing: ~20ms
- Verification (signature + DB lookup): ~5ms
- `handleWebhook()` + event emit: ~10ms
- `WebhookDelivery` update: ~5ms
- **Total: ~40ms** — well within the upstream's typical 5-second timeout.

---

## 7. End-to-End Outbound Webhook Walkthrough

A `booking.created.v1` event fires in Eks-Food. The Acme connector has registered an outbound webhook subscription.

### 7.1 The event is emitted

```typescript
await ctx.sdk.events.publish("booking.created.v1", booking, {
  syncSource: "payswap",  // not "acme-pos", so the outbound filter passes
});
```

The M1 `EventBus` delivers the event to all subscribers, including the outbound-webhook router in `@eks/integration/event-routing.ts`.

### 7.2 The router matches

1. Queries `WebhookEndpoint WHERE direction='OUTBOUND' AND status='ACTIVE' AND eventTypes @> ARRAY['booking.created.v1']`.
2. For each match (in this case, Acme's outbound endpoint), applies the filter (`{ "regionId": "r-accra" }` against the event payload) — pass.
3. Creates `WebhookDelivery` (`direction=OUTBOUND`, `status=RECEIVED`, `eventId=<new uuid>`, `eventType=booking.created.v1`, `request={url, headers, body}`).

### 7.3 The delivery worker sends

1. Picks up the `WebhookDelivery` from the queue.
2. Builds the request (per §5.2).
3. Sends to `https://acme.test/api/v1/eks-food-webhook`.
4. Acme returns `200 OK`:
   ```json
   { "received": true }
   ```
5. Transitions to `DELIVERED`.

### 7.4 Failure and retry

If Acme returns `503 Service Unavailable`:
1. Transitions to `FAILED` with `errorMessage="http_503"`.
2. Schedules `nextAttemptAt = now() + 1000ms` (first retry, per `aggressive` policy).
3. The retry worker picks it up at `nextAttemptAt` and re-sends.
4. If 10 attempts fail, transitions to `DLQ` and emits `Webhook.Dlqd`.

---

## 8. Webhook API Reference

```
# Endpoint management
GET    /api/v1/integrations/webhooks/endpoints             — list (filter by direction, connectorCode)
POST   /api/v1/integrations/webhooks/endpoints             — register
GET    /api/v1/integrations/webhooks/endpoints/:id         — detail
PATCH  /api/v1/integrations/webhooks/endpoints/:id         — update (eventTypes, retryPolicy, status)
DELETE /api/v1/integrations/webhooks/endpoints/:id         — remove (must be PAUSED first)

# Inbound receiver
POST   /api/v1/integrations/webhooks/inbound/:slug         — inbound webhook receiver (external → Eks-Food)
GET    /api/v1/integrations/webhooks/inbound/:slug         — challenge-response verification

# Delivery tracking
GET    /api/v1/integrations/webhooks/deliveries            — paginated (filter by endpointId, status, direction)
GET    /api/v1/integrations/webhooks/deliveries/:id        — detail (request, response, attempts)
POST   /api/v1/integrations/webhooks/deliveries/:id/replay — replay a DLQ'd delivery
POST   /api/v1/integrations/webhooks/deliveries/:id/cancel — cancel a pending retry (admin only)

# DLQ
GET    /api/v1/integrations/webhooks/dlq                   — list DLQ'd deliveries (paginated)
POST   /api/v1/integrations/webhooks/dlq/replay-all        — bulk replay (admin only; max 100 at a time)

# Retry policy templates
GET    /api/v1/integrations/policies/retry                 — list
POST   /api/v1/integrations/policies/retry                 — create
```

---

## 9. Webhook vs. Sync — When to Use Which

| Criterion | Webhook | Sync |
|---|---|---|
| Latency | Sub-second to seconds | Minutes to hours |
| Cost (per event) | One HTTP call | One HTTP call per batch of records |
| Reliability | Upstream must retry; we add DLQ | We control the cadence; we retry |
| Source-side support | Upstream must send webhooks | Upstream must support polling/cursors |
| Ordering | No guarantee (retries may reorder) | Cursor-based ordering |
| Volume | High (one webhook per event) | Low (one sync per batch) |

**Use webhooks when:**
- The upstream supports them (Stripe, Acme, Twilio).
- Sub-minute latency matters (e.g. payment confirmations).
- The volume is manageable (<100 events/second per connector).

**Use sync when:**
- The upstream only supports polling (most legacy ERPs).
- Latency of minutes is acceptable.
- The volume is high (batching reduces upstream load).

**Use both** (the recommended pattern):
- Webhook for fast-path event notifications.
- Sync every 5 minutes for reconciliation (catches any missed webhooks, e.g. during a platform outage).

The Acme POS connector uses both: webhooks for `order.status.changed` (sub-second latency for booking status updates) and an incremental sync every 5 minutes for menu changes (lower volume, less latency-sensitive).

---

## 10. Common Webhook Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Verifying the signature over the parsed JSON instead of the raw body | Signature mismatch (JSON key ordering differs) | The runtime passes the raw body to the signature check; connector code should never re-serialize for verification |
| Using `Date.now()` instead of the upstream's timestamp | Replay protection window fails when clocks drift | Always use the upstream's timestamp header (e.g. `X-Acme-Timestamp`) |
| Processing the webhook synchronously in `handleWebhook()` | Upstream times out (5s default) waiting for `200 OK` | Emit the event and return `processed: true` quickly; the M3 `@eks/domain` handlers process asynchronously |
| Returning `200 OK` for an event type you don't handle | Upstream marks as delivered; the event is lost | Return `200 OK` with `{status: "filtered"}` — the runtime records it as filtered for visibility |
| Not declaring `eventTypes` on the endpoint | Connector receives every event type from the upstream | Always declare `eventTypes` — the runtime filters before invoking `handleWebhook()` |
| Replaying a DLQ'd webhook that has side effects | Side effects fire twice | Use `dedupeKey` on every `ctx.sdk.events.publish` call — duplicates are silently dropped at the outbox |
| Outbound webhook URL not in `allowedDomains` | `Egress denied` error | Add the URL's domain to `connector.allowedDomains` in the manifest |
| Outbound signature missing the timestamp | Recipient cannot verify replay protection | The runtime always adds `X-Eks-Timestamp` — never override it in connector code |

When in doubt, run `bunx @eks/dev-cli validate --webhooks` — it static-analyses the connector's webhook declaration and `handleWebhook()` for these pitfalls.
