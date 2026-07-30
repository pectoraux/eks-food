# Eks-Food — Event Conventions

> **Audience:** Engineers adding domain events, integration events, or event consumers. Read alongside `ARCHITECTURE.md` §4 (CQRS & Event-Driven) and `OPERATIONS_RUNBOOK.md` (event replay, DLQ handling).
>
> **TL;DR:** Events are the **only** way bounded contexts communicate. Every state change emits a domain event; every cross-context communication goes through a published integration event. Delivery is at-least-once; consumers MUST be idempotent.

---

## 1. Three Kinds of Events

Eks-Food distinguishes three event categories. They have different lifecycles, different consumers, and different rules.

| Kind | Emitted By | Persisted In | Consumed By | May Contain PII | Versioning |
|---|---|---|---|---|---|
| **Domain event** | An aggregate, in-process | In-memory + outbox | Same-context handlers only | Yes (tenant-scoped) | Co-evolves with aggregate |
| **Integration event** | Outbox publisher | Outbox table + event log + message broker | Any context, external systems | Minimal — references, not PII | Strict semver |
| **Internal event** | Infrastructure (workers, schedulers) | Worker log + metrics | Observability stack only | Never | n/a |

### 1.1 Domain events

A domain event represents a fact that the domain model considers true: `BookingCreated`, `PaymentSucceeded`, `CookApproved`. It is emitted synchronously by the aggregate's method (which appends it to the aggregate's in-memory event list) and persisted to the outbox in the same DB transaction as the state change.

Domain events are **in-process by default**. They may be consumed synchronously by other aggregates in the same transaction (e.g. `BookingConfirmed` triggers `PaymentCaptured` on the same `Payment` aggregate), or asynchronously by the outbox publisher converting them to integration events.

### 1.2 Integration events

An integration event is a domain event that has been **published** to the outside world — across context boundaries, to message brokers, to external webhooks. It is the contract between bounded contexts.

Integration events are **versioned** (§4), **schema-registered** (§8), and **consumed idempotently** (§6). Once published, their shape is frozen; breaking changes require a new event name or a new major version.

### 1.3 Internal events

Internal events are operational signals — `WorkerStarted`, `OutboxBacklogHigh`, `DlqMessageMoved`. They never reach business logic; they drive dashboards, alerts, and autoscalers. They are emitted as structured logs and OpenTelemetry spans, not as broker messages.

---

## 2. Event Naming

### 2.1 The rule

Every domain and integration event is named `{Aggregate}.{PastTenseVerb}`.

| Aggregate | Verb (past tense) | Event name (wire) | TS class |
|---|---|---|---|
| Booking | Created | `Booking.Created` | `BookingCreated` |
| Booking | Assigned | `Booking.Assigned` | `BookingAssigned` |
| Booking | Confirmed | `Booking.Confirmed` | `BookingConfirmed` |
| Booking | Cancelled | `Booking.Cancelled` | `BookingCancelled` |
| Booking | Completed | `Booking.Completed` | `BookingCompleted` |
| Booking | Escalated | `Booking.Escalated` | `BookingEscalated` |
| Payment | Succeeded | `Payment.Succeeded` | `PaymentSucceeded` |
| Payment | Failed | `Payment.Failed` | `PaymentFailed` |
| Payment | Refunded | `Payment.Refunded` | `PaymentRefunded` |
| Transfer | Paid | `Transfer.Paid` | `TransferPaid` |
| Cook | Approved | `Cook.Approved` | `CookApproved` |
| Cook | Suspended | `Cook.Suspended` | `CookSuspended` |
| Inspection | Scheduled | `Inspection.Scheduled` | `InspectionScheduled` |
| Inspection | Passed | `Inspection.Passed` | `InspectionPassed` |
| FeatureFlag | Toggled | `FeatureFlag.Toggled` | `FeatureFlagToggled` |

### 2.2 Rules

- **MUST** use past tense — the event describes something that has already happened.
- **MUST** use the aggregate name (singular, PascalCase), not the entity type or the action.
  - ❌ `BookingCreated` is fine. ❌ `NewBooking` is not. ❌ `BookingCreationRequested` is not.
- **MUST NOT** name events after the trigger ("`PaymentWebhookReceived`") — name after the business fact ("`Payment.Succeeded`"). The trigger is irrelevant to the consumer; the fact is what matters.
- **MUST NOT** name events after the consumer's reaction ("`SendBookingEmail`") — the consumer decides what to do; the event states what happened.
- **SHOULD** keep aggregate names stable across versions. `Booking.Created.v1`, `Booking.Created.v2` — not `Booking.CreatedV2`.

---

## 3. Event Envelope

Every integration event (the wire format) is wrapped in a standard envelope. Domain events in-process are plain typed objects; the publisher wraps them when writing to the outbox.

```jsonc
{
  "eventId": "evt_01J5ABCDEF0123456789GH",
  "eventType": "Booking.Created",
  "eventVersion": 1,
  "occurredAt": "2025-07-30T12:34:56.789Z",
  "tenantId": "eks-ghana",
  "organizationId": "cm9k8j2...",
  "aggregateId": "cm9k8j2...",
  "aggregateType": "Booking",
  "correlationId": "corr_01J5ABCDEFG",
  "causationId": "cmd_01J5ABCDEF",
  "idempotencyKey": "idmp_01J5ABCDEF0123",
  "source": "eks.bookings/1.4.2",
  "schemaUrl": "https://schemas.eks.food/Booking.Created.v1.json",
  "data": {
    "code": "EKS-6GKD02",
    "customerId": "cm9k8j2...",
    "serviceCode": "IN_HOME_COOKING",
    "quotedPrice": { "amount": 180.00, "currency": "GHS" },
    "scheduledFor": "2025-08-02T18:00:00Z",
    "status": "PENDING_MATCH"
  }
}
```

### 3.1 Envelope field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `eventId` | string (cuid) | yes | Globally unique. Generated by the publisher. Used for idempotent consumption. |
| `eventType` | string | yes | `{Aggregate}.{PastTenseVerb}` (§2). |
| `eventVersion` | integer | yes | Schema version of the `data` payload (§4). Starts at 1. |
| `occurredAt` | ISO 8601 UTC | yes | When the event *happened in the domain*, not when it was published. |
| `tenantId` | string | yes | Human-readable tenant slug, e.g. `eks-ghana`. |
| `organizationId` | string (cuid) | yes | Machine-readable tenant ID (FK to `Organization`). |
| `aggregateId` | string (cuid) | yes | The aggregate instance this event pertains to. |
| `aggregateType` | string | yes | Aggregate class name: `Booking`, `Payment`, `Cook`. |
| `correlationId` | string | yes | Propagates across the entire causal chain (§5). |
| `causationId` | string | no | The command or event that caused this one (§5). |
| `idempotencyKey` | string | yes | Stable hash of (aggregateId, eventType, eventVersion, occurredAt) — consumer-side dedup key. |
| `source` | string | yes | Emitting service + version: `eks.bookings/1.4.2`. |
| `schemaUrl` | URL | yes | Resolves to the JSON schema for this `eventType` + `eventVersion` (§8). |
| `data` | object | yes | The typed event payload. Schema-registered. |

---

## 4. Versioning

### 4.1 Schema

- Each `(eventType, eventVersion)` pair maps to exactly one JSON schema in the schema registry (§8).
- `eventVersion` is an integer, **monotonically increasing per `eventType`**.
- Versions are **non-breaking** by default: adding optional fields bumps the version. Removing fields, renaming fields, changing types, or making optional fields required are **breaking** and require a new `eventType` or a major version jump.

### 4.2 Backward-compat rules

A new minor/patch version (`Booking.Created.v1` → `Booking.Created.v2`) MUST:

- Add only optional fields with sensible defaults.
- Not remove existing fields (deprecate them; consumers should ignore unknowns).
- Not change a field's type to an incompatible one.

A consumer that understands `v1` MUST be able to consume `v2` without code changes. The publisher writes `v2`; consumers that haven't upgraded read the v1 projection (the registry projects down).

### 4.3 Breaking changes

Breaking changes require either:

1. **A new event type.** `Booking.Created` → `Booking.V2Created`. Consumers opt in by subscribing to the new type. The publisher emits both during a transition window.
2. **A major version.** `Booking.Created` v1, v2, v3 — where v2 may break v1 consumers. The registry serves both; consumers explicitly subscribe to the major they support. Old majors are deprecated and removed after two release cycles.

We prefer option 1 (new event type) for clarity; option 2 (major version) when the change is internal-only and consumers don't care about the wire shape.

---

## 5. Correlation & Causation IDs

### 5.1 Correlation ID

- Every inbound HTTP request gets a `correlationId` (header `X-Correlation-Id`, generated if absent — see `API_CONVENTIONS.md`).
- Every event emitted as a result of that request carries the same `correlationId`.
- Every downstream event carries it forward. The correlation ID is the trace that ties a customer click to every side effect.

### 5.2 Causation ID

- Every command has a `commandId` (cuid, generated at the API boundary).
- Every event caused by that command has `causationId = commandId`.
- Every event caused by another event has `causationId = parentEvent.eventId`.
- This forms a DAG: from any event, you can walk `causationId` back to the originating command and the originating HTTP request (via `correlationId`).

### 5.3 Worked example

```
POST /api/v1/bookings  (correlationId: corr_AAA, commandId: cmd_AAA)
  → emits Booking.Created  (eventId: evt_001, causationId: cmd_AAA, correlationId: corr_AAA)

Matching consumer reads evt_001
  → emits Booking.Assigned  (eventId: evt_002, causationId: evt_001, correlationId: corr_AAA)

Payment consumer reads evt_002
  → calls Payswap.createPaymentIntent
  → emits Payment.IntentCreated  (eventId: evt_003, causationId: evt_002, correlationId: corr_AAA)

Customer confirms checkout
POST /api/v1/payswap/confirm  (correlationId: corr_BBB, commandId: cmd_BBB)
  → emits Payment.Succeeded  (eventId: evt_004, causationId: cmd_BBB, correlationId: corr_BBB)
  → emits Booking.Confirmed  (eventId: evt_005, causationId: evt_004, correlationId: corr_BBB)
```

From `evt_005`, you can walk back: `evt_005 → evt_004 → cmd_BBB` (the checkout click) and sideways to `corr_AAA` (the original booking creation). Full audit trail, no manual stitching.

---

## 6. Idempotency

### 6.1 The rule

Delivery is **at-least-once**. Consumers MUST be idempotent. There is no exactly-once delivery; there is exactly-once *processing*, achieved by consumer-side dedup.

### 6.2 Consumer-side dedup

Every consumer maintains an idempotency store (Redis, keyed by `eventId`):

```ts
async function handleBookingCreated(event: BookingCreated): Promise<void> {
  const seen = await redis.set(`idmp:${event.eventId}`, "1", "NX", "EX", 7 * 24 * 3600);
  if (!seen) {
    // Already processed. Ack and move on.
    return;
  }
  // Process the event. If processing fails, roll back the idempotency marker
  // (or use a two-phase ack — see §6.3).
  await applyBookingCreated(event);
}
```

### 6.3 Two-phase ack (recommended)

The idempotency marker is written *before* processing and confirmed *after*:

1. `SET idmp:{eventId} processing NX EX 604800` — claim. If `nil`, the event was already processed (or is being processed); ack and skip.
2. Process the event.
3. On success: `SET idmp:{eventId} done EX 604800` — confirm.
4. On failure: `DEL idmp:{eventId}` — release the claim so a retry can pick it up.

This prevents the "process once, crash, redeliver, but the marker says done" race.

### 6.4 Business-level idempotency

Even with `eventId` dedup, business operations should be idempotent on their natural key. The matching consumer, for example, only assigns a cook to a booking if the booking's status is still `PENDING_MATCH` — a duplicate `Booking.Created` event has no effect because the status has already moved on. This is defence in depth; both layers are required.

### 6.5 Idempotency on commands (API surface)

See `API_CONVENTIONS.md` § Idempotency-Key. The `Idempotency-Key` header deduplicates the *command* (HTTP request); the `eventId` deduplicates the *event* (async processing). They are separate concerns.

---

## 7. Outbox Pattern

### 7.1 The rule

State changes and event publication MUST be in the same DB transaction. We achieve this with a transactional outbox.

### 7.2 Schema

```prisma
model OutboxEvent {
  id             String   @id @default(cuid())
  organizationId String
  eventType      String   // "Booking.Created"
  eventVersion   Int      // 1
  aggregateId    String
  aggregateType  String
  correlationId  String
  causationId    String?
  payload        String   // JSON envelope (§3)
  status         String   @default("PENDING") // PENDING | PUBLISHED | FAILED
  attempts       Int      @default(0)
  lastError      String?
  availableAt    DateTime @default(now())  // for backoff scheduling
  publishedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([organizationId, status, availableAt])
  @@index([correlationId])
}
```

### 7.3 Publishing flow

1. Application use case opens a DB transaction.
2. Updates the aggregate (e.g. `Booking` row).
3. Inserts an `OutboxEvent` row with `status = "PENDING"` and the full envelope as `payload`.
4. Commits the transaction.
5. The **Outbox Publisher** worker (separate process) polls:
   ```sql
   SELECT * FROM OutboxEvent
   WHERE status = 'PENDING' AND availableAt <= NOW()
   ORDER BY createdAt ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 100;
   ```
6. For each row, publishes to the message broker (Redis Stream / NATS JetStream), then marks `status = "PUBLISHED"`.
7. On publish failure: increments `attempts`, sets `lastError`, schedules `availableAt` with exponential backoff (`availableAt = NOW() + min(60s * 2^attempts, 1h)`).
8. After `EKS_OUTBOX_MAX_ATTEMPTS` (default 10) failures: marks `status = "FAILED"` and moves the row to the DLQ (§9).

### 7.4 Why not just publish to the broker directly?

Because the broker write and the DB write would not be atomic. If the broker is down but the DB commit succeeds, the event is lost. If the broker write succeeds but the DB commit fails, the event is phantom — consumers react to a state change that never happened. The outbox eliminates both by making publication a background, retryable operation on a persisted row.

---

## 8. Schema Registry

### 8.1 The rule

Every `(eventType, eventVersion)` pair MUST have a JSON schema registered before any event of that type is published. The schema URL is included in the envelope (`schemaUrl`), so any consumer can fetch and validate.

### 8.2 Storage

Schemas live in `docs/events/schemas/<EventType>.v<Version>.json` and are also published to the registry service at `https://schemas.eks.food/<EventType>.v<Version>.json` (a static S3 + CloudFront site, M2 target).

### 8.3 Workflow

1. Engineer defines the event payload as a Zod schema in `@eks/<context>/src/domain/events/<event-name>.ts`.
2. CI generates the JSON schema from the Zod schema (`scripts/export-event-schemas.ts`).
3. The generated JSON schema is committed to `docs/events/schemas/`.
4. A PR that adds a new event MUST include the generated schema and a consumer stub.
5. The schema is immutable once merged. A new version means a new file.

### 8.4 Consumer validation

Consumers MUST validate every event against its schema before processing. If validation fails, the consumer NACKs the message (it goes to the DLQ) and alerts. Never process an unvalidatable event.

```ts
const result = BookingCreatedSchema.safeParse(event.data);
if (!result.success) {
  await dlq.report({ event, error: result.error, reason: "schema_validation_failed" });
  return; // ack the message; don't retry — a bad schema won't fix itself
}
```

---

## 9. Dead-Letter Queue (DLQ)

### 9.1 When a message goes to DLQ

- **Schema validation fails.** The payload doesn't match the registered schema. (Never retried.)
- **Processing fails after `EKS_EVENT_MAX_ATTEMPTS`** (default 5) with a non-transient error (e.g. business rule violation).
- **TTL exceeded.** The message has been in the queue longer than `EKS_EVENT_TTL` (default 24h) without successful processing.

### 9.2 DLQ structure

Each consumer has its own DLQ topic: `eks.dlq.<consumer-name>`. DLQ messages retain the full original envelope plus:

```jsonc
{
  "originalEvent": { /* the envelope from §3 */ },
  "consumerName": "eks.bookings.matching",
  "firstAttemptAt": "2025-07-30T12:34:56Z",
  "lastAttemptAt": "2025-07-30T13:21:09Z",
  "attempts": 5,
  "lastError": "DatabaseError: connection refused",
  "dlqReason": "max_attempts_exceeded",
  "dlqAt": "2025-07-30T13:21:10Z"
}
```

### 9.3 DLQ operational rules

- The DLQ MUST be drained daily. Anything sitting > 24h triggers a PagerDuty alert (see `OPERATIONS_RUNBOOK.md`).
- DLQ messages are NOT automatically retried. They require human review (replay or discard).
- Discarding a DLQ message requires a JIRA ticket and a comment in the DLQ viewer explaining why.

---

## 10. Replay Semantics

### 10.1 When to replay

- After a consumer bug fix: re-process events the buggy consumer mishandled.
- After a new consumer is added: back-fill its state from historical events.
- After a data corruption incident: rebuild a read model from the event log.

### 10.2 What replay is

Replay = re-publishing a window of outbox rows to a specific consumer, with `causationId = "replay:<batchId>"` so the original causal chain is preserved and the replay is auditable.

### 10.3 Replay rules

- **MUST** be scoped to a single consumer. Replay does not re-publish to all consumers — only to the one named in the replay command.
- **MUST** be scoped to a time window and (optionally) an `organizationId`. Never replay the entire history blindly.
- **MUST** preserve `eventId`. Consumers MUST already be idempotent on `eventId` (§6), so a replay of an already-processed event is a no-op for consumers that have already seen it.
- **MUST** set a replay-specific `correlationId` (`replay_<batchId>`) so consumers can opt out of side effects they don't want to repeat (e.g. sending a duplicate SMS). Consumers check `if (event.correlationId.startsWith("replay_")) skipNotifications();` — the business state is still updated, but external side effects are suppressed.

### 10.4 Replay command

```bash
bun run scripts/event-replay.ts \
  --consumer eks.bookings.matching \
  --event-type Booking.Created \
  --from 2025-07-29T00:00:00Z \
  --to 2025-07-30T00:00:00Z \
  --organization-id cm9k8j2... \
  --batch-id 2025-07-30-replay-matching-bug
```

The script writes a `Replay` audit record, iterates the outbox, and re-publishes each matching row with the replay `correlationId`. See `OPERATIONS_RUNBOOK.md` § Event Replay Runbook for the full procedure.

---

## 11. Exactly-Once Processing Strategy

There is no exactly-once *delivery*. There is exactly-once *processing*, achieved by the combination of:

1. **Transactional outbox** — state change + event record commit atomically. (§7)
2. **At-least-once delivery** — broker redelivers unacked messages. (§7)
3. **Consumer-side idempotency** — `eventId` dedup with two-phase ack. (§6)
4. **Business-level idempotency** — operations check natural state ("only assign if status = PENDING_MATCH"). (§6.4)
5. **Schema validation** — malformed messages go to DLQ, never to processing. (§8.4)

With all five layers, the *effect* of any event on system state is exactly once, even though the message may be delivered multiple times. This is the only honest "exactly once" — and it's the one that matters.

---

## 12. Sample Event Payload — Full Walkthrough

### 12.1 The wire envelope

```json
{
  "eventId": "evt_01J5ABCDEF0123456789GH",
  "eventType": "Booking.Confirmed",
  "eventVersion": 1,
  "occurredAt": "2025-07-30T12:34:56.789Z",
  "tenantId": "eks-ghana",
  "organizationId": "cm9k8j2k0h0001ab234cdef6",
  "aggregateId": "cm9k8j2k0h0002cd567efab9",
  "aggregateType": "Booking",
  "correlationId": "corr_01J5ABCDEFG",
  "causationId": "evt_01J5PAYMENTSUCCEEDED",
  "idempotencyKey": "idmp_01J5ABCDEF0123",
  "source": "eks.bookings/1.4.2",
  "schemaUrl": "https://schemas.eks.food/Booking.Confirmed.v1.json",
  "data": {
    "code": "EKS-6GKD02",
    "customerId": "cm9k8j2k0h0003ef789abcd0",
    "cookId": "cm9k8j2k0h0004ab123cd45",
    "serviceCode": "IN_HOME_COOKING",
    "bookingType": "IMMEDIATE",
    "scheduledFor": "2025-08-02T18:00:00Z",
    "durationMins": 120,
    "partySize": 4,
    "quotedPrice": { "amount": 180.00, "currency": "GHS" },
    "address": {
      "line1": "12 Osu Lane",
      "city": "Accra",
      "region": "Greater Accra"
    },
    "matchScore": 0.94,
    "payswapPaymentId": "pi_01J5PAYMENTID123",
    "previousStatus": "ASSIGNED",
    "currentStatus": "CONFIRMED"
  }
}
```

### 12.2 The JSON schema (excerpt)

```jsonc
// docs/events/schemas/Booking.Confirmed.v1.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.eks.food/Booking.Confirmed.v1.json",
  "title": "Booking.Confirmed v1",
  "type": "object",
  "required": ["code", "customerId", "cookId", "serviceCode", "quotedPrice", "currentStatus"],
  "properties": {
    "code":         { "type": "string", "pattern": "^EKS-[A-Z0-9]{5,8}$" },
    "customerId":   { "type": "string" },
    "cookId":       { "type": "string" },
    "serviceCode":  { "type": "string" },
    "quotedPrice":  {
      "type": "object",
      "required": ["amount", "currency"],
      "properties": {
        "amount":   { "type": "number", "minimum": 0 },
        "currency": { "type": "string", "pattern": "^[A-Z]{3}$" }
      }
    },
    "currentStatus":{ "type": "string", "const": "CONFIRMED" }
    // ... etc
  }
}
```

### 12.3 The Zod schema (source of truth)

```ts
// @eks/bookings/src/domain/events/booking-confirmed.ts
import { z } from "zod";

export const BookingConfirmedSchema = z.object({
  code: z.string().regex(/^EKS-[A-Z0-9]{5,8}$/),
  customerId: z.string(),
  cookId: z.string(),
  serviceCode: z.string(),
  bookingType: z.enum(["IMMEDIATE", "SCHEDULED", "RECURRING", "EVENT", "CORPORATE", "SUBSCRIPTION"]),
  scheduledFor: z.string().datetime(),
  durationMins: z.number().int().min(30).max(600),
  partySize: z.number().int().min(1).max(200),
  quotedPrice: z.object({
    amount: z.number().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  address: z.object({
    line1: z.string(),
    city: z.string(),
    region: z.string(),
  }),
  matchScore: z.number().min(0).max(1).nullable(),
  payswapPaymentId: z.string(),
  previousStatus: z.string(),
  currentStatus: z.literal("CONFIRMED"),
});

export type BookingConfirmed = z.infer<typeof BookingConfirmedSchema>;
```

### 12.4 The consumer

```ts
// @eks/notifications/src/consumers/booking-confirmed-consumer.ts
import type { BookingConfirmed } from "@eks/bookings/events";
import { BookingConfirmedSchema } from "@eks/bookings/events";
import { defineConsumer } from "@eks/events";

export const bookingConfirmedConsumer = defineConsumer({
  name: "eks.notifications.booking-confirmed",
  eventType: "Booking.Confirmed",
  minVersion: 1,
  maxVersion: 1,
  async handle(event, ctx) {
    const parsed = BookingConfirmedSchema.safeParse(event.data);
    if (!parsed.success) {
      await ctx.dlq({ reason: "schema_validation_failed", error: parsed.error });
      return;
    }
    const payload: BookingConfirmed = parsed.data;

    // Suppress notifications on replay
    if (event.correlationId.startsWith("replay_")) {
      ctx.log.info("suppressed notification on replay", { code: payload.code });
      return;
    }

    // Idempotent: skip if already processed
    const claimed = await ctx.idempotency.claim(event.eventId);
    if (!claimed) return;

    try {
      await sendBookingConfirmedSms(payload);
      await ctx.idempotency.confirm(event.eventId);
    } catch (error) {
      await ctx.idempotency.release(event.eventId);
      throw error; // triggers broker redelivery
    }
  },
});
```

---

## 13. Event Discovery

Engineers MUST be able to answer "what events does Eks-Food emit?" and "who consumes `Booking.Confirmed`?" without grepping.

- `docs/events/registry.md` (auto-generated from Zod schemas) lists every event, its versions, its emitting context, and its known consumers.
- Each event's schema file (`docs/events/schemas/<EventType>.v<Version>.json`) carries a `$comment` field naming the emitting context and the ticket that introduced it.
- CI fails if a new event is added without a registry entry.

---

## 14. Anti-Patterns to Reject in Review

| ❌ Anti-pattern | ✅ Fix |
|---|---|
| Emitting an event outside the outbox transaction | Move the emit into the same TX as the state change |
| Naming an event after the trigger (`WebhookReceived`) | Name after the business fact (`Payment.Succeeded`) |
| Consumer without idempotency check | Add `eventId` dedup (§6) |
| Publishing a new event version that breaks consumers | Either add a new event type, or only add optional fields (§4.2) |
| Consumer that throws on schema validation failure | DLQ the message; don't retry (§8.4) |
| Hardcoding event type strings in consumers | Use the exported constant: `BOOKING_CONFIRMED_TYPE` |
| Emitting an event without `correlationId` | The publisher derives it from the command context; never null |
| Consumer that does external side effects (SMS, email) on replay | Check `correlationId.startsWith("replay_")` and suppress (§10.3) |
| Two events with the same `eventType` but different payloads | Bump `eventVersion` and register a new schema |
