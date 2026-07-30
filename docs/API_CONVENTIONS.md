# Eks-Food — API Conventions

> **Audience:** Engineers building or consuming HTTP API endpoints. Read alongside `EVENT_CONVENTIONS.md` (the async contract) and `CODING_STANDARDS.md` (the code shape).
>
> **Status:** Milestone 1 endpoints live at `/api/*` (unversioned). Milestone 2 introduces `/api/v1/*` as the versioned surface described here. New endpoints MUST follow this spec from day one.

---

## 1. Versioning

### 1.1 URI versioning

All public endpoints live under `/api/v1/*`. The version segment is **mandatory** — there is no unversioned public surface.

```
GET    /api/v1/bookings
POST   /api/v1/bookings
GET    /api/v1/bookings/{code}
POST   /api/v1/bookings/{code}/cancel
POST   /api/v1/payswap/checkout
POST   /api/v1/payswap/confirm
POST   /api/v1/payswap/payouts
POST   /api/v1/payswap/webhook
GET    /api/v1/cooks
GET    /api/v1/cooks/{id}
GET    /api/v1/admin/config
GET    /api/v1/admin/flags
PUT    /api/v1/admin/flags/{key}
GET    /api/v1/analytics/demand
POST   /api/v1/ai-assistant
```

### 1.2 Breaking vs non-breaking changes

| Change | Breaking? | Action |
|---|---|---|
| Add an optional request field | No | Ship under v1 |
| Add a response field | No | Ship under v1 (consumers ignore unknowns) |
| Add a new endpoint | No | Ship under v1 |
| Remove or rename a field | Yes | New version (`/api/v2/...`) with a deprecation window ≥ 6 months |
| Change a field's type | Yes | New version |
| Change status code semantics | Yes | New version |
| Change auth requirements | Yes | New version (or in-place with notice) |

Old versions are supported for ≥ 6 months after the new version ships. Deprecation is signalled via the `Deprecation` and `Sunset` HTTP headers (RFC 8594 / RFC 7234).

### 1.3 Version negotiation

Version is in the URI, full stop. We do NOT support `Accept: application/vnd.eks.v1+json` content negotiation — it's harder to test, harder to cache, and offers no benefit over URI versioning for our use case.

---

## 2. Standard Response Envelope

### 2.1 The envelope

Every successful response is wrapped in a standard envelope. Errors use RFC 7807 problem+json (§5).

```jsonc
// Success — single resource
{
  "data": { /* the resource */ },
  "meta": {
    "requestId": "req_01J5ABCDEF",
    "correlationId": "corr_01J5ABCDEFG",
    "timestamp": "2025-07-30T12:34:56.789Z"
  }
}

// Success — collection (paginated, see §6)
{
  "data": [ /* resources */ ],
  "meta": {
    "requestId": "req_01J5ABCDEF",
    "correlationId": "corr_01J5ABCDEFG",
    "timestamp": "2025-07-30T12:34:56.789Z",
    "pagination": {
      "cursor": "eyJpZCI6ImNtO...",
      "hasMore": true,
      "count": 50,
      "totalCount": 1234
    }
  }
}
```

### 2.2 Rules

- `data` is always present on success (object or array).
- `meta.requestId` matches the response `X-Request-Id` header (§7).
- `meta.correlationId` matches `X-Correlation-Id` (§7).
- `meta.timestamp` is the server's response time, ISO 8601 UTC.
- `meta.pagination` is present only on collection responses.
- **MUST NOT** wrap errors in this envelope. Errors use `application/problem+json` (§5).

---

## 3. Naming

### 3.1 URLs — kebab-case

- URLs use `kebab-case` for path segments: `/api/v1/meal-categories`, `/api/v1/cook-availability`.
- Resource names are **plural nouns**: `/api/v1/bookings`, `/api/v1/cooks`, `/api/v1/payswap-payment-intents`.
- Sub-resources are nested one level deep max: `/api/v1/bookings/{code}/payments`. Deeper nesting is a smell — model it as a top-level resource with a filter.

### 3.2 JSON — camelCase

- JSON field names are `camelCase`: `quotedPrice`, `bookingType`, `scheduledFor`, `payswapPaymentId`.
- Even when the underlying DB column is `snake_case` (Prisma convention), the API exposes `camelCase`.
- Booleans are adjectives prefixed `is`/`has`/`should`: `isAvailable`, `hasPayment`.
- Enums are `SCREAMING_SNAKE_CASE` strings on the wire (they match the domain union): `"IMMEDIATE"`, `"PENDING_MATCH"`, `"REQUIRES_ACTION"`.

### 3.3 IDs

- Public resource identifiers are cuid strings: `cm9k8j2k0h0001ab234cdef6`.
- Human-friendly codes (booking codes) follow `EKS-XXXXXX`: `EKS-6GKD02`.
- Payment references follow the provider's convention: `pi_...` (Payswap payment intent), `cs_...` (checkout session), `tr_...` (transfer).
- **MUST NOT** expose auto-increment integers as IDs.

### 3.4 Dates & money

- Dates and timestamps are ISO 8601 UTC strings: `"2025-07-30T12:34:56.789Z"`.
- Date-only fields (e.g. `DemandSignal.day`) are `YYYY-MM-DD`: `"2025-07-30"`.
- Money is always an object `{ "amount": 180.00, "currency": "GHS" }`. Never a bare number. Amounts are decimal strings or numbers with explicit precision; never `float` math on the client.

---

## 4. HTTP Methods & Status Codes

### 4.1 Method semantics

| Method | Idempotent? | Use |
|---|---|---|
| `GET` | Yes | Read resource(s); never mutate |
| `POST` | No (use Idempotency-Key) | Create resource, trigger action |
| `PUT` | Yes | Replace entire resource |
| `PATCH` | No (use Idempotency-Key) | Partial update (JSON Merge Patch, RFC 7396) |
| `DELETE` | Yes | Remove resource |

### 4.2 Status codes

| Code | When |
|---|---|
| `200 OK` | Successful GET, successful PUT/PATCH/DELETE |
| `201 Created` | Successful POST that created a resource; include `Location` header |
| `202 Accepted` | Asynchronous action accepted (e.g. webhook ingestion); processing continues out-of-band |
| `204 No Content` | Successful DELETE, or PUT/PATCH with no response body |
| `400 Bad Request` | Malformed request (invalid JSON, missing required field, schema violation) |
| `401 Unauthorized` | Missing or invalid credentials (M2) |
| `403 Forbidden` | Authenticated but lacks permission (RBAC deny) |
| `404 Not Found` | Resource doesn't exist OR caller lacks permission to know it exists (avoid leaking existence) |
| `409 Conflict` | Optimistic concurrency violation (`If-Match` failed) or duplicate idempotency key with different payload |
| `422 Unprocessable Entity` | Syntactically valid but semantically invalid (e.g. unknown service code, booking in wrong state for the action) |
| `429 Too Many Requests` | Rate limit exceeded (see §9) |
| `500 Internal Server Error` | Unexpected failure; ops is paged |
| `502 Bad Gateway` | Upstream provider (Payswap, AI) failed |
| `503 Service Unavailable` | Maintenance mode or dependency down; include `Retry-After` |
| `504 Gateway Timeout` | Upstream provider timed out |

### 4.3 Location header

`201 Created` responses MUST include a `Location` header pointing at the new resource:

```
HTTP/1.1 201 Created
Location: /api/v1/bookings/EKS-6GKD02
Content-Type: application/json
```

---

## 5. Error Responses — RFC 7807 Problem+JSON

All errors (4xx and 5xx) are returned as `application/problem+json` per [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807).

### 5.1 Shape

```jsonc
{
  "type": "https://docs.eks.food/errors/booking.not_found",
  "title": "Booking not found",
  "status": 404,
  "detail": "No booking exists with code EKS-XXXXXX in tenant eks-ghana.",
  "instance": "/api/v1/bookings/EKS-XXXXXX",
  "code": "booking.not_found",
  "errors": [
    {
      "field": "code",
      "message": "Booking with code 'EKS-XXXXXX' not found"
    }
  ],
  "requestId": "req_01J5ABCDEF",
  "correlationId": "corr_01J5ABCDEFG",
  "timestamp": "2025-07-30T12:34:56.789Z"
}
```

### 5.2 Field reference

| Field | Required | Description |
|---|---|---|
| `type` | yes | URI identifying the error class. Resolves to a human-readable doc page. |
| `title` | yes | Short, human-readable summary. Stable per `type`. |
| `status` | yes | HTTP status code echoed in the body. |
| `detail` | yes | Specific, human-readable explanation. May vary per occurrence. |
| `instance` | yes | The request path that errored. |
| `code` | yes | Machine-readable error code, dot-notation: `booking.not_found`, `payment.failed`, `auth.forbidden`. |
| `errors` | no | Array of field-level validation errors (for 400/422). |
| `requestId` | yes | Matches `X-Request-Id` header. |
| `correlationId` | yes | Matches `X-Correlation-Id` header. |
| `timestamp` | yes | ISO 8601 UTC of the error. |

### 5.3 Error code conventions

- `code` is dot-notation, all lowercase, domain-then-reason: `<aggregate>.<reason>`.
- Stable: once a code is shipped, its meaning never changes. New meanings get new codes.
- Catalogued in `docs/errors/registry.md` (auto-generated from the `DomainError` hierarchy in `@eks/shared-kernel`).

### 5.4 Common error codes

| Code | Status | When |
|---|---|---|
| `request.malformed_json` | 400 | Body is not valid JSON |
| `request.validation_failed` | 422 | Body fails Zod schema |
| `auth.unauthorized` | 401 | Missing credentials (M2) |
| `auth.forbidden` | 403 | RBAC deny |
| `booking.not_found` | 404 | Booking code unknown |
| `booking.invalid_state_transition` | 409 | e.g. cancelling an already-completed booking |
| `payment.failed` | 402 | Payswap returned failure |
| `payment.provider_error` | 502 | Payswap 5xx |
| `payment.idempotency_conflict` | 409 | Same key, different payload |
| `tenant.not_seeded` | 422 | Organization not provisioned |
| `rate_limited` | 429 | Rate limit exceeded |
| `internal.unexpected` | 500 | Unhandled exception |

---

## 6. Pagination

### 6.1 Two modes

Eks-Food supports both cursor-based and offset-based pagination. Cursor is preferred for high-volume, append-mostly collections (bookings, audit logs). Offset is acceptable for admin/config listings with small total counts.

### 6.2 Cursor pagination (default)

**Request:**
```
GET /api/v1/bookings?cursor=eyJpZCI6ImNtO...&limit=50
```

- `cursor` — opaque, base64-encoded token. Clients treat it as a black box.
- `limit` — page size, 1–100, default 50.

**Response (`meta.pagination`):**
```jsonc
"pagination": {
  "cursor": "eyJpZCI6ImNtOTRo...",  // next page cursor; null when done
  "hasMore": true,
  "count": 50,                       // items in this page
  "totalCount": 1234                 // optional; expensive, omit on hot paths
}
```

The cursor encodes the sort key of the last item; the server queries `WHERE (sortKey) > (cursor.sortKey) ORDER BY sortKey LIMIT N+1`. The `+1` lets the server know if there's a next page without a separate count.

### 6.3 Offset pagination

**Request:**
```
GET /api/v1/admin/services?offset=0&limit=50
```

**Response:**
```jsonc
"pagination": {
  "offset": 0,
  "limit": 50,
  "count": 50,
  "totalCount": 123
}
```

Offset pagination is only for low-volume admin endpoints. Never use it on bookings, audit logs, or demand signals.

### 6.4 Default ordering

Every list endpoint has a default ordering. `GET /api/v1/bookings` defaults to `createdAt DESC`. Clients can override with `?sort=` (§7).

---

## 7. Filtering & Sorting

### 7.1 Filter grammar

Query params filter the collection. Each filter is `?field=value`. Multiple values for the same field are OR-ed; multiple different fields are AND-ed.

```
GET /api/v1/bookings?status=CONFIRMED&status=ASSIGNED&region=greater-accra
```

→ `WHERE status IN ('CONFIRMED','ASSIGNED') AND region = 'greater-accra'`

### 7.2 Operators

For non-equality, use a suffix on the field name:

| Suffix | Meaning | Example |
|---|---|---|
| (none) | equals | `?status=CONFIRMED` |
| `__ne` | not equals | `?status__ne=CANCELLED` |
| `__in` | in (comma-separated) | `?status__in=CONFIRMED,ASSIGNED,COMPLETED` |
| `__nin` | not in | `?status__nin=CANCELLED,FAILED` |
| `__gt` | greater than | `?quotedPrice__gt=100` |
| `__gte` | greater than or equal | `?quotedPrice__gte=100` |
| `__lt` | less than | `?quotedPrice__lt=200` |
| `__lte` | less than or equal | `?quotedPrice__lte=200` |
| `__between` | range (comma-separated) | `?quotedPrice__between=100,200` |
| `__like` | substring (case-insensitive) | `?customerName__like=ama` |
| `__null` | is null (`true`/`false`) | `?cookId__null=true` |

### 7.3 Date/time filters

Date filters accept ISO 8601 strings, with two convenience suffixes:

- `__since` — alias for `__gte` on date fields
- `__until` — alias for `__lte` on date fields

```
GET /api/v1/bookings?createdAt__since=2025-07-01T00:00:00Z&createdAt__until=2025-07-31T23:59:59Z
```

### 7.4 Sorting

- `?sort=field` — ascending
- `?sort=-field` — descending (leading `-`)
- Multiple: `?sort=-createdAt,status`

```
GET /api/v1/bookings?status=CONFIRMED&sort=-scheduledFor&limit=20
```

### 7.5 Field selection (sparse fieldsets)

Clients MAY request only specific fields:

```
GET /api/v1/bookings?fields=code,status,quotedPrice,scheduledFor
```

The server honours this for performance-sensitive endpoints (e.g. the cook workspace). It's optional to implement per endpoint; the default is to return the full resource.

### 7.6 Validation

All query params are validated by a Zod schema at the route boundary. Unknown params return `400 request.unknown_query_param`. This catches typos early and keeps the API surface explicit.

---

## 8. Idempotency-Key Header

### 8.1 The rule

Every `POST`, `PUT`, `PATCH`, and `DELETE` that is not naturally idempotent SHOULD send an `Idempotency-Key` header. The server enforces idempotency on these methods when the header is present.

```
POST /api/v1/bookings HTTP/1.1
Idempotency-Key: idmp_01J5ABCDEF0123
Content-Type: application/json
```

### 8.2 Server behaviour

1. Compute `key = sha256(method + path + tenantId + idempotencyKey)`.
2. `SET eks:idmp:{key} <pending> NX EX 86400` in Redis.
   - If `nil`: a request with this key is in-flight or recently completed. Look up the stored response and replay it (§8.3).
3. Process the request.
4. `SET eks:idmp:{key} <response> EX 86400` — store the full response (status, headers, body) for 24h.
5. Return the response.

### 8.3 Replay semantics

- Same `Idempotency-Key` + same path + same method → server returns the **stored response** (status, headers, body), even if the original request failed.
- Same `Idempotency-Key` + **different** path or method → `409 payment.idempotency_conflict`. The key is bound to a specific endpoint.
- Same `Idempotency-Key` + same path + **different body** → `409 payment.idempotency_conflict`. The key is bound to a specific request shape. (Hash the body into the key, or compare stored hash on replay.)

### 8.4 Key format

- Client-generated, opaque to the server.
- MUST be unique per logical operation (a "create booking" click), reused across retries of that same operation.
- Recommended format: `idmp_<cuid>` or a UUIDv7. Length 16–128 chars.
- **MUST NOT** be reused for distinct logical operations. If in doubt, generate a new one.

### 8.5 What's idempotent by design

`GET`, `DELETE`, `PUT` (full replace) are idempotent by HTTP semantics. They don't require `Idempotency-Key`. Clients MAY still send one to deduplicate retries; the server honours it.

`POST` and `PATCH` are NOT idempotent by HTTP semantics. Clients MUST send `Idempotency-Key` for these.

---

## 9. Rate Limiting

### 9.1 Headers

Every response includes rate-limit headers (RFC draft: <https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/>):

| Header | Description |
|---|---|
| `RateLimit-Limit` | The request quota per window (e.g. `1000`) |
| `RateLimit-Remaining` | Requests remaining in the current window |
| `RateLimit-Reset` | Seconds until the window resets |
| `X-RateLimit-Policy` | Human-readable policy: `1000;w=3600` (1000 per hour) |

### 9.2 429 response

When the limit is exceeded:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 47
RateLimit-Limit: 1000
RateLimit-Remaining: 0
RateLimit-Reset: 47
Content-Type: application/problem+json

{
  "type": "https://docs.eks.food/errors/rate_limited",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "You have exceeded 1000 requests per hour. Retry after 47 seconds.",
  "code": "rate_limited",
  "requestId": "req_01J5ABCDEF",
  "correlationId": "corr_01J5ABCDEFG",
  "timestamp": "2025-07-30T12:34:56.789Z"
}
```

### 9.3 Limits

| Tier | Limit | Scope |
|---|---|---|
| Anonymous | 60 req/hour | per IP |
| Customer | 600 req/hour | per principal |
| Cook | 600 req/hour | per principal |
| Manager / Inspector | 1200 req/hour | per principal |
| Admin / Super Admin | 3000 req/hour | per principal |
| Service account | 6000 req/hour | per credential |
| AI Assistant | 100 req/hour | per principal (LLM cost control) |
| Payswap webhook | unlimited | per source IP (verified by signature) |

Limits are configurable per tenant via `FeatureFlag` rows; enterprise tenants can negotiate higher limits.

### 9.4 Burst

A token-bucket burst of 2× the steady-state limit is allowed per window. Headers reflect the bucket state.

---

## 10. Request Headers

### 10.1 Required / standard headers

| Header | Required | Description |
|---|---|---|
| `Content-Type: application/json` | On request bodies | All write bodies are JSON |
| `Accept: application/json` | Recommended | All responses are JSON (or `application/problem+json` on error) |
| `Authorization: Bearer <jwt>` | M2 | JWT bearer token (M1 uses `x-eks-*` headers) |
| `X-Request-Id` | Optional, generated if absent | Client-supplied request ID (cuid or UUID). Echoed in response. |
| `X-Correlation-Id` | Optional, = `X-Request-Id` if absent | Cross-service trace ID. Propagated to events. |
| `Idempotency-Key` | For POST/PATCH (§8) | Client-generated, reused on retry |
| `X-Tenant` | Optional | Override tenant for super-admin cross-tenant ops |
| `Accept-Language` | Optional | `en`, `sw`, `fr`, `ha` — drives response locale (M2) |

### 10.2 Response headers

| Header | Always? | Description |
|---|---|---|
| `Content-Type` | yes | `application/json` or `application/problem+json` |
| `X-Request-Id` | yes | Echoes the request's `X-Request-Id` (or a generated one) |
| `X-Correlation-Id` | yes | Echoes / generates the correlation ID |
| `X-Response-Time-ms` | yes | Server processing time in ms |
| `X-EKS-Version` | yes | Server version, e.g. `1.4.2` |
| `RateLimit-*` | yes | See §9 |
| `Location` | on 201 | URI of created resource |
| `Retry-After` | on 429/503 | Seconds to wait |
| `Deprecation` | on deprecated endpoints | RFC 8594 deprecation marker |
| `Sunset` | on sunsetting endpoints | RFC 8594 sunset date |

---

## 11. OpenAPI Generation

### 11.1 Source of truth — Zod

Every request body, query string, and response payload is defined as a Zod schema in `@eks/<context>/src/application/<use-case>.schemas.ts`. The OpenAPI spec is **generated** from these schemas — never hand-written.

### 11.2 Generation

```bash
bun run scripts/export-openapi.ts
```

The script:
1. Walks `src/app/api/v1/**/route.ts`.
2. Reads each route's `openapi` export (a static declaration object).
3. Converts Zod schemas → JSON Schema → OpenAPI 3.1 components.
4. Emits `openapi.json` and `openapi.yaml` to `docs/api/`.

### 11.3 Route declaration

Each route handler exports an `openapi` declaration alongside `GET`/`POST`/etc.:

```ts
// src/app/api/v1/bookings/route.ts
export const openapi = {
  post: {
    summary: "Create a booking",
    operationId: "createBooking",
    tags: ["bookings"],
    requestBody: CreateBookingSchema,
    responses: {
      201: { schema: BookingCreatedResponseSchema, description: "Booking created" },
      422: { schema: ProblemJsonSchema, description: "Validation failed" },
      409: { schema: ProblemJsonSchema, description: "Idempotency conflict" },
    },
    idempotent: true,
    rateLimit: { tier: "customer" },
  },
};
```

### 11.4 Publication

- `openapi.json` is served at `/api/openapi.json` and `https://api.eks.food/openapi.json`.
- A Swagger UI instance is mounted at `/api/docs` (M2).
- The spec is versioned and changelog'd alongside code; breaking changes bump the spec's `info.version` major.

---

## 12. CORS

- Allowed origins: `https://app.eks.food`, `https://console.eks.food`, plus tenant-branded subdomains (`https://*.eks.food`).
- Allowed methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`.
- Allowed headers: `Authorization, Content-Type, X-Request-Id, X-Correlation-Id, Idempotency-Key, X-Tenant`.
- Exposed headers: `X-Request-Id, X-Correlation-Id, RateLimit-*, Location, Retry-After`.
- Credentials: `true` (cookie-based session for the web app, M2).
- Max age: `600` (10 min preflight cache).

CORS is enforced at the Caddy layer (see `Caddyfile`) and reinforced by Next.js middleware.

---

## 13. Security Headers

Set by Caddy + Next.js middleware on every response:

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `default-src 'self'; ...` (full policy in `SECURITY.md`) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(self), camera=(), microphone=()` |
| `Cache-Control` | `no-store` on authenticated responses; `public, max-age=300` on static |

See `SECURITY.md` for the full CSP and rationale.

---

## 14. Webhooks

### 14.1 Inbound (Payswap → Eks-Food)

`POST /api/v1/payswap/webhook` is the inbound endpoint. Payswap signs every webhook with `Payswap-Signature: t=<timestamp>,v1=<hmac-sha256-hex>`. The server:

1. Reads the raw body (never the parsed JSON — the signature is over the raw bytes).
2. Computes `HMAC-SHA256(rawBody, EKS_PAYSWAP_WEBHOOK_SECRET)`.
3. Compares against `v1=` in constant time.
4. Rejects if timestamp is > 5 minutes old (replay protection).
5. Idempotently processes the event (key = Payswap event ID).
6. Returns `200` within 5s (Payswap retries on timeout). Heavy work goes to the event bus.

See `PAYMENTS.md` § Webhooks for the full contract.

### 14.2 Outbound (Eks-Food → external systems)

Eks-Food may publish webhooks to tenant-configured endpoints for partner integrations (M3). Outbound webhooks:

- Are signed with HMAC-SHA256, same envelope as inbound.
- Include `X-EKS-Event-Id`, `X-EKS-Event-Type`, `X-EKS-Timestamp`.
- Retry with exponential backoff for 24h, then DLQ.
- Require the partner to return `2xx` to ack.

---

## 15. Worked Example — Create Booking

### Request

```http
POST /api/v1/bookings HTTP/1.1
Host: api.eks.food
Authorization: Bearer eyJhbGc...
Content-Type: application/json
Accept: application/json
X-Request-Id: req_01J5ABCDEF
X-Correlation-Id: corr_01J5ABCDEFG
Idempotency-Key: idmp_01J5ABCDEF0123

{
  "serviceCode": "IN_HOME_COOKING",
  "bookingType": "IMMEDIATE",
  "scheduledFor": "2025-08-02T18:00:00Z",
  "durationMins": 120,
  "partySize": 4,
  "addressLine1": "12 Osu Lane",
  "city": "Accra",
  "region": "Greater Accra",
  "lat": 5.6037,
  "lng": -0.1870,
  "cuisines": ["ghanaian"],
  "languages": ["en"],
  "autoAssign": true
}
```

### Response (success)

```http
HTTP/1.1 201 Created
Location: /api/v1/bookings/EKS-6GKD02
Content-Type: application/json
X-Request-Id: req_01J5ABCDEF
X-Correlation-Id: corr_01J5ABCDEFG
X-Response-Time-ms: 142
X-EKS-Version: 1.4.2
RateLimit-Limit: 600
RateLimit-Remaining: 599
RateLimit-Reset: 3599

{
  "data": {
    "code": "EKS-6GKD02",
    "status": "ASSIGNED",
    "bookingType": "IMMEDIATE",
    "scheduledFor": "2025-08-02T18:00:00Z",
    "durationMins": 120,
    "partySize": 4,
    "quotedPrice": { "amount": 180.00, "currency": "GHS" },
    "service": { "code": "IN_HOME_COOKING", "name": "In-Home Cooking" },
    "assignment": {
      "assigned": true,
      "cookId": "cm9k8j2k0h0004ab123cd45",
      "matchScore": 0.94,
      "reason": "AUTO_ASSIGNED"
    },
    "payment": {
      "payswapId": "pi_01J5PAYMENTID123",
      "clientSecret": "pi_01J5PAYMENTID123_secret",
      "status": "REQUIRES_ACTION"
    }
  },
  "meta": {
    "requestId": "req_01J5ABCDEF",
    "correlationId": "corr_01J5ABCDEFG",
    "timestamp": "2025-07-30T12:34:56.789Z"
  }
}
```

### Response (validation error)

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json

{
  "type": "https://docs.eks.food/errors/request.validation_failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request body failed schema validation.",
  "instance": "/api/v1/bookings",
  "code": "request.validation_failed",
  "errors": [
    { "field": "durationMins", "message": "Number must be ≥ 30" },
    { "field": "scheduledFor", "message": "Must be a valid ISO 8601 date" }
  ],
  "requestId": "req_01J5ABCDEF",
  "correlationId": "corr_01J5ABCDEFG",
  "timestamp": "2025-07-30T12:34:56.789Z"
}
```

---

## 16. API Anti-Patterns to Reject in Review

| ❌ Anti-pattern | ✅ Fix |
|---|---|
| Returning a bare array as the response body | Wrap in `{ "data": [...] }` |
| `200 OK` with `{ "success": false, "error": "..." }` | Use the right status code + problem+json |
| Snake_case JSON fields | camelCase |
| `POST /api/v1/createBooking` | `POST /api/v1/bookings` (verb in method, noun in path) |
| Returning `id` as an integer | cuid string |
| Returning money as a bare number | `{ amount, currency }` |
| Pagination via `page` + `pageSize` on hot paths | Cursor pagination |
| Unknown query params silently ignored | 400 `request.unknown_query_param` |
| Error message with stack trace | problem+json, no internals leaked |
| Webhook handler that returns 200 after 30s of work | 200 within 5s; work goes to the bus |
| Hand-written OpenAPI spec | Generate from Zod (§11) |
