# Eks-Food — System Architecture

> **Audience:** All engineers, SREs, and architects. Read this before `FOLDER_STRUCTURE.md`, `CODING_STANDARDS.md`, or `PAYMENTS.md`.
>
> **Status:** Milestone 1 — Platform Foundation. The patterns described here are the target architecture for the modular monolith; the `@eks/*` packages under `src/packages/` are the evolutionary home for code that today lives in `src/lib/` and `src/app/api/`.

---

## 1. Design Philosophy

Eks-Food is a **global, AI-native Food Services Operating System** that orchestrates home cooks, professional chefs, food inspectors, riders, restaurants, and suppliers across multiple countries and currencies. The architecture is driven by four forces:

1. **Global, multi-region, multi-currency** — a booking in Accra and a booking in Lagos must not block each other; a Ghana Cedi payment and a Nigerian Naira payout must never cross-currency.
2. **Multi-tenant by construction** — every Organization (`Organization` row) is a hard isolation boundary. All data, configuration, feature flags, and pricing rules are tenant-scoped.
3. **Money movement is delegated** — Eks-Food never touches card numbers, mobile-money PINs, or bank credentials. All money flows through the Payswap abstraction (`@eks/payments`, see `PAYMENTS.md`).
4. **AI-native** — every module ships with a role-aware copilot grounded in live tenant data via `z-ai-web-dev-sdk`.

The architectural style is a **modular monolith with a microservice extraction path**. We ship one deployable today, but enforce module boundaries — bounded contexts, hexagonal layering, internal package perimeters — so that any single bounded context can be lifted into a separate process when load, regulatory, or team-scale demands it.

---

## 2. Bounded Contexts (DDD)

Eks-Food is partitioned into the following bounded contexts. Each owns its own aggregates, persistence, and `@eks/*` package; contexts communicate only through published integration events and well-defined application ports.

| Bounded Context | Aggregate Roots | `@eks/*` Package | Today's Home |
|---|---|---|---|
| **Identity & Access** | `User`, `Organization`, `Role` | `@eks/auth` | `src/lib/auth.ts`, `prisma/schema.prisma` (`User`, `Organization`) |
| **Customer Platform** | `Customer`, `Address`, `Favorite` | `@eks/customers` | `prisma/schema.prisma` (`Customer`, `Address`, `Favorite`) |
| **Cook Platform** | `Cook`, `Certification`, `CookAvailability` | `@eks/cooks` | `src/lib/` (cook queries), `prisma/schema.prisma` |
| **Catalog & Config** | `Service`, `MealCategory`, `Region`, `PricingRule`, `FeatureFlag` | `@eks/catalog` | `src/app/api/admin/*` |
| **Booking & Dispatch** | `Booking`, `MatchRequest` | `@eks/bookings` | `src/app/api/bookings/*`, `src/lib/matching.ts` |
| **Payments (Payswap)** | `PayswapPayment`, `PayswapTransfer` | `@eks/payments` | `src/lib/payswap.ts`, `src/app/api/payswap/*` |
| **Food Inspection** | `Inspection` | `@eks/inspections` | `prisma/schema.prisma` (`Inspection`) |
| **Food Intelligence** | `DemandSignal` | `@eks/intelligence` | `src/app/api/analytics/`, `src/components/modules/food-intelligence-module.tsx` |
| **AI Copilots** | n/a (stateless orchestrator) | `@eks/ai` | `src/app/api/ai-assistant/` |
| **Audit & Observability** | `AuditLog` | `@eks/audit` | `prisma/schema.prisma` (`AuditLog`) |

**Rules:**
- A context may **read** another context's data only through its application service (never direct Prisma access across boundaries).
- A context may **mutate** another context's state only by publishing an integration event that the owning context consumes.
- Cross-context queries for UI composition go through a read model / query service in the interface layer — never through joins across context boundaries.

---

## 3. Hexagonal / Clean Architecture Layers

Inside every `@eks/*` package, code is organised in four concentric layers. Dependencies always point **inward** — the domain knows nothing about HTTP, Prisma, or React.

```
                            ┌─────────────────────────────────────────────┐
                            │            Interface (driving)              │
                            │  Next.js Route Handlers, React Server       │
                            │  Components, tRPC/RPC adapters, CLI tools   │
                            └───────────────────────┬─────────────────────┘
                                                    │ depends on (down)
                            ┌───────────────────────▼─────────────────────┐
                            │              Application                    │
                            │  Use Cases (commands + queries),            │
                            │  Command/Query Handlers (CQRS), DTOs,       │
                            │  Ports (interfaces), Authorization          │
                            └───────────────────────┬─────────────────────┘
                                                    │ depends on (down)
                            ┌───────────────────────▼─────────────────────┐
                            │                Domain                       │
                            │  Aggregates, Entities, Value Objects,       │
                            │  Domain Events, Domain Services,            │
                            │  Invariants — pure TypeScript, no I/O        │
                            └───────────────────────▲─────────────────────┘
                                                    │ implemented by (up)
                            ┌───────────────────────┴─────────────────────┐
                            │             Infrastructure                  │
                            │  Prisma Repositories, Payswap adapter,      │
                            │  Redis cache, Outbox publisher,             │
                            │  z-ai-web-dev-sdk adapter, Email/SMS gateways│
                            └─────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | May Import | May NOT Import | Persistence | I/O |
|---|---|---|---|---|
| **Domain** | only TS stdlib + `@eks/*` shared kernel | Prisma, Next, fetch, fs | none | none |
| **Application** | Domain + Ports (interfaces) | Prisma, fetch, concrete adapters | none (uses Repository ports) | none (uses Port interfaces) |
| **Infrastructure** | Application ports + 3rd-party SDKs | Domain internals (only via ports) | Prisma, Redis, S3 | HTTPS, fs, queues |
| **Interface** | Application + framework (Next, React) | Infrastructure internals | none | HTTP, JSX |

**Hard rules enforced by review and lint (`eslint-plugin-boundaries`, planned):**
- ❌ A Next.js route handler (`src/app/api/**/route.ts`) MUST NOT import Prisma directly. It must call an Application use case.
- ❌ A Domain aggregate MUST NOT import `@prisma/client`.
- ❌ A Repository MUST NOT return Prisma model types; it maps to domain entities at the boundary.
- ✅ The Application layer defines `BookingRepository` (port). The Infrastructure layer provides `PrismaBookingRepository` (adapter). The Interface layer wires them via a DI container.

> **Current state note:** Milestone 1's `src/app/api/bookings/route.ts` still calls Prisma directly through `src/lib/db`. This is documented technical debt. The migration to `@eks/bookings` with proper port/adapter separation is the first refactor in Milestone 2.

---

## 4. CQRS & Event-Driven Architecture

### 4.1 CQRS

Eks-Food applies **CQRS where the read/write asymmetry pays for itself** — primarily in Booking, Cook, and Food Intelligence contexts. Not every context needs full CQRS; trivial CRUD contexts (Catalog config) stay on a single model.

- **Commands** mutate state, are named `CreateBookingCommand`, `ConfirmBookingCommand`, etc., return `Result<T, E>` (see `CODING_STANDARDS.md`), and emit domain events.
- **Queries** are read-only projections, named `GetBookingByCodeQuery`, `ListCooksForMatchQuery`, etc. They hit read models that may be denormalised for UI performance.
- Commands and queries have **separate handlers** but share the same database in Milestone 1. Read models are tables in the same Postgres; in Milestone 3 they may move to a separate read replica or Redis materialised view.

### 4.2 Event-Driven

State changes inside an aggregate produce **domain events**. Domain events are persisted to the **transactional outbox** in the same DB transaction as the state change, then published asynchronously by the Outbox Publisher worker.

```
   POST /api/v1/bookings                ┌──────────────────────────────────┐
  ────────────────────────►  Application │ 1. Begin TX                       │
                            use case     │ 2. Insert Booking (PENDING_MATCH) │
                                         │ 3. Insert Outbox row              │
                                         │    {type:"Booking.Created", v:1}  │
                                         │ 4. Commit TX                      │
                                         └──────────────┬───────────────────┘
                                                        │
                                     ┌──────────────────▼──────────────────┐
                                     │ Outbox Publisher (worker, polls)    │
                                     │  • SELECT FOR UPDATE SKIP LOCKED    │
                                     │  • Publish to Redis Stream / NATS   │
                                     │  • Mark row PUBLISHED               │
                                     └──────────────────┬──────────────────┘
                                                        │
                ┌───────────────────────────────────────┼───────────────────────────────┐
                ▼                                       ▼                               ▼
   Matching consumer                    Notification consumer             Audit consumer
   (Booking → Cook assignment)          (Booking.Created → email/SMS)     (every event → AuditLog)
```

**Why this matters for Eks-Food:**
- Booking creation is latency-sensitive for customers. We return `201` as soon as the booking + outbox row are committed, before cook assignment runs.
- Cook assignment, payout initiation, demand-signal aggregation, and audit logging all run as **event consumers**, independently scalable.
- The outbox gives us **at-least-once delivery** with **transactional consistency** between state and event — no distributed two-phase commit needed.

See `EVENT_CONVENTIONS.md` for the full eventing contract (naming, versioning, idempotency, replay, DLQ).

---

## 5. Technology Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | **Bun** (dev + scripts) / **Node.js 20+** (production) | `bun install`, `bun run dev`, `bun run test`. Production runs the Next.js standalone server. |
| Language | **TypeScript 5** (`strict: true`) | See `CODING_STANDARDS.md`. |
| Web framework | **Next.js 16 (App Router)** | RSC where possible; route handlers for the API. |
| ORM | **Prisma 6** | Schema as source of truth in `prisma/schema.prisma`. |
| Database | **PostgreSQL 16** (target) | SQLite for the Milestone-1 sandbox; schema is Postgres-ready (no SQLite-only types used). |
| Cache / Streams | **Redis 7** (ready) | Outbox publisher target, rate-limit counters, idempotency-key store. |
| Frontend state | **TanStack Query 5** (server), **Zustand 5** (UI) | See `src/lib/store.ts`, `src/components/providers.tsx`. |
| Forms & validation | **React Hook Form + Zod 4** | Schemas shared between client and server. |
| UI | **Tailwind 4 + shadcn/ui + Radix** | Brand theme in `src/app/globals.css`. |
| Charts | **Recharts** (today), **ECharts** (planned for Intel dashboards) | |
| AI | **z-ai-web-dev-sdk** | Role-aware copilots grounded in tenant data. |
| Payments | **Payswap** (Stripe-compatible) | See `PAYMENTS.md`. |
| Testing | **Vitest 4** + `@vitest/coverage-v8` + React Testing Library | See `TESTING_GUIDE.md`. |
| API contract | **OpenAPI 3.1** (generated from Zod) | See `API_CONVENTIONS.md`. |
| Container | **Docker multi-stage** + **Caddy** reverse proxy | See `DEPLOYMENT_GUIDE.md`, `Caddyfile`. |

---

## 6. `@eks/*` Package Map

Internal packages live under `src/packages/<name>/` and are imported as `@eks/<name>` (configured via `tsconfig.json` `paths` in Milestone 2; today they are aliased conceptually to `src/lib/*`).

| Package | Layer | Responsibility | Key Public Exports |
|---|---|---|---|
| `@eks/shared-kernel` | Domain | Cross-context primitives: `Result<T,E>`, `EntityId`, `Money`, `Cuid`, `Clock`, branded types. | `Result`, `ok`, `err`, `Money`, `EntityId` |
| `@eks/auth` | Domain+App+Infra | RBAC permission matrix, `Principal` resolution, `authorize()` guard, session foundation (deferred to M2). | `Principal`, `Role`, `PERMISSIONS`, `authorize`, `resolvePrincipal` |
| `@eks/customers` | All layers | Customer profile, addresses, favorites, dietary preferences. | `CustomerRepository`, `CreateCustomerCommand` |
| `@eks/cooks` | All layers | Cook profile, certifications, availability windows, verification workflow. | `CookRepository`, `ApproveCookCommand`, `CookAvailabilityService` |
| `@eks/catalog` | All layers | Tenant-scoped config: services, meal categories, regions, pricing rules, feature flags. | `ServiceRepository`, `FeatureFlagService`, `PricingCalculator` |
| `@eks/bookings` | All layers | Booking lifecycle, matching engine, auto-assign, escalation. | `BookingRepository`, `matchCooks`, `autoAssign`, `CreateBookingCommand` |
| `@eks/payments` | All layers | Provider-agnostic `PaymentProvider` port + Payswap adapter. **No card/MoMo data stored.** | `PaymentProvider`, `PayswapProvider`, `createIntent`, `confirm`, `transfer`, `refund`, `handleWebhook` |
| `@eks/inspections` | All layers | Inspector scheduling, checklist, scoring, certification issuance. | `InspectionRepository`, `ScheduleInspectionCommand` |
| `@eks/intelligence` | All layers | Anonymised demand signals, heatmaps, trend computation (no PII). | `DemandSignalRepository`, `DemandAggregator` |
| `@eks/ai` | Application+Infra | Role-aware copilots; prompt assembly; `z-ai-web-dev-sdk` adapter; grounding queries. | `askAssistant`, `buildCopilotContext` |
| `@eks/audit` | All layers | Append-only `AuditLog` writer + query; consumes every integration event. | `writeAudit`, `AuditRepository` |
| `@eks/events` | Infra | Outbox table, publisher worker, consumer framework, schema registry client. | `OutboxPublisher`, `defineConsumer`, `EventSchemaRegistry` |
| `@eks/http` | Interface | Shared HTTP helpers: problem+json, envelope, pagination, request-id, Zod→OpenAPI. | `problemJson`, `paginate`, `withCorrelation` |
| `@eks/ui` | Interface | Shared React primitives, theme, AppShell, toast/sonner wiring. | `AppShell`, `Button`, `Card`, `useToast` |

---

## 7. Multi-Tenant, Multi-Region, Horizontal Scalability

### 7.1 Multi-Tenant Isolation

- Every tenant-scoped table in `prisma/schema.prisma` carries `organizationId` and an index on it (e.g. `@@index([organizationId])`).
- Every Prisma query in the Application layer is filtered by `organizationId` derived from the resolved `Principal` (`@eks/auth`).
- Tenant isolation is enforced by a **repository base class** that injects `organizationId` into every `where` clause; developers cannot write a tenant-scoped query without it.
- Row-level security is planned for Postgres in Milestone 3 as defence-in-depth.

### 7.2 Multi-Region

Eks-Food is designed to run in **multiple regions** (e.g. `aws-af-west-1` Accra, `aws-af-south-1` Cape Town) with the following principles:

- **Data residency:** a tenant's data lives in the region where the tenant was provisioned. `Organization.region` records the home region; a routing layer in Caddy + Next.js middleware steers requests.
- **No cross-region writes:** booking, payment, and audit writes stay in the tenant's home region. Cross-region reads (e.g. global analytics) go through an async replication + aggregation pipeline, never synchronously.
- **Latency-sensitive reads (cook availability, demand heatmaps):** served from a regional Redis read-through cache with a 30s–5m TTL.
- **Currency:** `Organization.baseCurrency` and per-booking `currency` ensure GHS, NGN, USD never silently mix. Money is a value object (`@eks/shared-kernel.Money`) that carries both amount and currency.

### 7.3 Horizontal Scalability

- **Stateless web tier:** Next.js standalone servers behind Caddy; horizontal scaling by replicas. No in-process session state — sessions are signed JWTs (M2) or externalised to Redis.
- **Stateless worker tier:** Outbox publisher, event consumers, and AI copilot workers are stateless processes that pull work from Redis Streams / NATS JetStream. Scale by replica count.
- **Database:** single Postgres primary per region with read replicas. Connection pooling via PgBouncer. Prisma is configured with a bounded pool (`EKS_DB_MAX_CONNECTIONS`).
- **Cache:** Redis cluster per region. Cache-aside with single-flight locks (`@eks/http.cacheAside`) to prevent stampedes — see `OPERATIONS_RUNBOOK.md` § Cache Stampede.
- **Idempotency everywhere:** every state-changing API requires `Idempotency-Key`; the server stores the response in Redis for 24h and replays it on retry. See `API_CONVENTIONS.md`.

---

## 8. Request Lifecycle — Worked Example

A customer creates a booking. Here is the full path through the architecture:

```
1. Client (React + TanStack Query) POSTs /api/v1/bookings
   Headers: Idempotency-Key, X-Correlation-Id, Authorization (M2)

2. Next.js Route Handler (Interface layer)
   src/app/api/v1/bookings/route.ts
   • resolves Principal via @eks/auth.resolvePrincipal
   • calls @eks/http.parseAndValidate(CreateBookingSchema, body) → Result
   • calls @eks/bookings.CreateBookingCommand handler (Application)

3. Application layer — CreateBookingCommand handler
   • authorize(principal, "booking.create")
   • PricingCalculator.quote(service, duration) → Money
   • BookingRepository.create() → persists Booking (PENDING_MATCH)
     in same TX, writes Outbox row {type:"Booking.Created", v:1}
   • publishes "Booking.Created" to in-process event bus
   • returns Result.ok({code, quotedPrice, ...})

4. Route handler returns 201 with standard envelope (see API_CONVENTIONS.md)
   Response cached in Redis under Idempotency-Key for 24h.

5. Asynchronously:
   a. Outbox Publisher picks up the row, publishes to Redis Stream
      "eks.events.bookings".
   b. Matching consumer reads "Booking.Created", runs matchCooks(),
      publishes "Booking.Assigned" or "Booking.Escalated".
   c. Notification consumer reads "Booking.Created", sends SMS/email
      to customer via provider gateway.
   d. Audit consumer reads every event, writes to AuditLog.
   e. Demand consumer reads "Booking.Created", updates DemandSignal
      aggregates for the region/cuisine/hour.
```

The customer perceived latency = step 1–4 only (typically <150ms p99). Steps 5a–5e run in parallel, out-of-band.

---

## 9. Architectural Decision Records (ADRs)

Architectural decisions are recorded as ADRs in `docs/adr/` (to be created as decisions are made). The current accepted decisions:

- **ADR-0001** — Modular monolith with explicit `@eks/*` package boundaries (not microservices on day one).
- **ADR-0002** — Hexagonal layering; no Prisma in route handlers; no DB in domain.
- **ADR-0003** — Transactional outbox for event publishing (no dual-write to queue).
- **ADR-0004** — Payswap as the sole payment infrastructure; provider-agnostic `PaymentProvider` port; no card/MoMo credentials stored.
- **ADR-0005** — CQRS in Booking, Cook, and Intelligence contexts only.
- **ADR-0006** — SQLite for Milestone-1 sandbox; schema is Postgres-ready (no SQLite-only types).
- **ADR-0007** — Demo-principal RBAC via headers in M1; full NextAuth session in M2.

---

## 10. References

- `docs/FOLDER_STRUCTURE.md` — concrete file tree.
- `docs/CODING_STANDARDS.md` — how to write code that fits these layers.
- `docs/EVENT_CONVENTIONS.md` — the event contract that glues contexts together.
- `docs/API_CONVENTIONS.md` — the HTTP surface that the Interface layer exposes.
- `docs/PAYMENTS.md` — the Payswap integration contract.
- `prisma/schema.prisma` — the data model that backs every context.
