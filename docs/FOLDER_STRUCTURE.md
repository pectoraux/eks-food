# Eks-Food — Folder Structure

> **Audience:** Engineers joining the codebase. Read alongside `ARCHITECTURE.md` (the *why*) and `CODING_STANDARDS.md` (the *how*).
>
> **Notation:** Directories end with `/`. Files are listed with a one-line purpose. Items marked **(target)** are the planned `@eks/*` package layout for Milestone 2+; items marked **(today)** exist in the Milestone-1 sandbox.

---

## 1. Repository Root

```
eks-food/
├── docs/                        # All Markdown documentation (this file lives here)
├── prisma/                      # Prisma schema + migrations
├── public/                      # Static assets served as-is by Next.js
├── src/                         # Application source (Next.js App Router + packages)
├── infra/                       # Infrastructure-as-code: Docker, Caddy, k8s, terraform
├── scripts/                     # Operational scripts: seed, backup, replay, migrate
├── tests/                       # Cross-cutting integration & e2e tests + runtime build scripts
├── examples/                    # Reference snippets (e.g. websocket frontend/server)
├── db/                          # Local SQLite database file (sandbox only, gitignored in prod)
├── download/                    # Generated download artefacts (README placeholder)
├── .next/                       # Next.js build output (generated, gitignored)
├── bun.lock                     # Bun lockfile — the source of truth for deps
├── package.json                 # NPM manifest, scripts, dependencies
├── tsconfig.json                # TS config: strict, paths alias @/* → ./src/*
├── next.config.ts               # Next.js config: output:"standalone"
├── tailwind.config.ts           # Tailwind theme tokens (brand amber/terracotta)
├── postcss.config.mjs           # PostCSS pipeline (Tailwind 4)
├── eslint.config.mjs            # Flat ESLint config (Next + custom rules)
├── components.json              # shadcn/ui CLI config
├── Caddyfile                    # Reverse proxy + TLS + multi-region routing
├── worklog.md                   # Per-task agent worklog (append-only)
└── README.md                    # Top-level project entry (created by onboarding task)
```

---

## 2. `src/` — Application Source

```
src/
├── app/                         # Next.js App Router: pages, layouts, route handlers
├── packages/                    # (target) @eks/* internal packages — one per bounded context
├── lib/                         # (today) Cross-cutting infra + domain services (M1 home)
├── components/                  # React components: AppShell, modules, ui primitives
├── hooks/                       # React hooks (use-toast, use-mobile)
└── middleware.ts                # (target) Next.js edge middleware: tenant routing, request-id
```

### 2.1 `src/app/` — Next.js App Router

```
src/app/
├── layout.tsx                   # Root layout: ThemeProvider, QueryClient, AppShell
├── page.tsx                     # Root page: renders Overview module (the Platform Foundation Console)
├── globals.css                  # Tailwind base + brand tokens (amber/terracotta theme)
├── api/                         # Route handlers (HTTP Interface layer)
│   ├── route.ts                 # GET /api → service identity & version
│   ├── seed/route.ts            # POST /api/seed → idempotent demo-data seed
│   ├── platform/route.ts        # GET /api/platform → top-level KPIs + module registry
│   ├── cooks/
│   │   ├── route.ts             # GET /api/cooks → list; POST → create
│   │   └── [id]/route.ts        # GET /api/cooks/:id → profile detail
│   ├── bookings/
│   │   ├── route.ts             # POST /api/bookings → create + match + Payswap intent
│   │   └── [code]/route.ts      # GET /api/bookings/:code → status (EKS-XXXX)
│   ├── payswap/
│   │   ├── checkout/route.ts    # POST → create hosted checkout session
│   │   ├── confirm/route.ts     # POST → confirm payment intent (customer authorises)
│   │   ├── payouts/route.ts     # POST → worker payout (Transfer)
│   │   └── webhook/route.ts     # POST → Payswap webhook ingestion (signed in prod)
│   ├── cook-workspace/route.ts  # GET → cook profile + earnings + jobs + payouts
│   ├── analytics/route.ts       # GET → Food Intelligence aggregates (anonymised)
│   ├── ai-assistant/route.ts    # POST → role-aware LLM copilot (z-ai-web-dev-sdk)
│   └── admin/
│       ├── config/route.ts      # GET/PUT → services, regions, meal cats, pricing rules
│       ├── flags/route.ts       # GET/PUT → feature flags (per-tenant rollout config)
│       └── services/route.ts    # GET/POST/PUT → service catalog CRUD
└── (target) v1/                 # M2: versioned API surface /api/v1/* per API_CONVENTIONS.md
```

> **M1→M2 migration note:** today's routes live at `/api/*`. The `API_CONVENTIONS.md` standard mandates `/api/v1/*`. The migration will move handlers under `src/app/api/v1/...` and add the standard envelope + RFC 7807 errors.

### 2.2 `src/packages/` — `@eks/*` Internal Packages (target)

One directory per bounded context, each following the same four-layer internal layout. The full package map is in `ARCHITECTURE.md` §6.

```
src/packages/
├── shared-kernel/               # Cross-context primitives
│   ├── src/
│   │   ├── result.ts            # Result<T,E>, ok(), err() — no throw across layers
│   │   ├── money.ts             # Money value object (amount + ISO currency)
│   │   ├── entity-id.ts         # Branded EntityId (cuid)
│   │   ├── clock.ts             # Clock port (testable time)
│   │   └── errors.ts            # DomainError hierarchy
│   └── index.ts
├── auth/                        # @eks/auth — RBAC, Principal, session foundation
│   ├── src/
│   │   ├── domain/
│   │   │   ├── role.ts          # Role union, ALL_ROLES
│   │   │   ├── permission.ts    # PERMISSIONS matrix
│   │   │   └── principal.ts     # Principal entity
│   │   ├── application/
│   │   │   ├── authorize.ts     # authorize(principal, perm)
│   │   │   └── resolve-principal.ts
│   │   └── infrastructure/
│   │       └── header-principal-resolver.ts  # M1 demo resolver
│   └── index.ts
├── customers/                   # @eks/customers — Customer, Address, Favorite
├── cooks/                       # @eks/cooks — Cook, Certification, Availability
├── catalog/                     # @eks/catalog — Service, Region, MealCategory, PricingRule, FeatureFlag
├── bookings/                    # @eks/bookings — Booking aggregate + matching engine
│   └── src/
│       ├── domain/
│       │   ├── booking.ts       # Booking aggregate root + invariants
│       │   ├── booking-status.ts
│       │   └── events/
│       │       ├── booking-created.ts
│       │       ├── booking-assigned.ts
│       │       ├── booking-confirmed.ts
│       │       └── booking-cancelled.ts
│       ├── application/
│       │   ├── commands/
│       │   │   ├── create-booking.ts
│       │   │   ├── confirm-booking.ts
│       │   │   └── cancel-booking.ts
│       │   ├── queries/
│       │   │   ├── get-booking-by-code.ts
│       │   │   └── list-bookings.ts
│       │   ├── matching-service.ts   # @eks/bookings matching engine (today: src/lib/matching.ts)
│       │   └── ports/
│       │       ├── booking-repository.ts
│       │       ├── cook-repository.ts  # cross-context read port
│       │       └── payment-provider.ts # from @eks/payments
│       └── infrastructure/
│           ├── prisma-booking-repository.ts
│           └── haversine.ts     # geo distance (today: src/lib/matching.ts)
├── payments/                    # @eks/payments — PaymentProvider port + Payswap adapter
│   └── src/
│       ├── domain/
│       │   ├── payment.ts
│       │   ├── transfer.ts
│       │   └── events/
│       ├── application/
│       │   └── ports/payment-provider.ts   # THE provider-agnostic contract (see PAYMENTS.md)
│       └── infrastructure/
│           ├── payswap-provider.ts          # Payswap adapter (today: src/lib/payswap.ts)
│           └── (target) stripe-provider.ts  # future: Stripe as alternate provider
├── inspections/                 # @eks/inspections — Inspector platform
├── intelligence/                # @eks/intelligence — anonymised demand signals
├── ai/                          # @eks/ai — role-aware copilots
│   └── src/
│       ├── application/
│       │   ├── ask-assistant.ts            # today: src/app/api/ai-assistant/route.ts logic
│       │   └── build-copilot-context.ts    # assembles role-aware grounding data
│       └── infrastructure/
│           └── z-ai-adapter.ts             # wraps z-ai-web-dev-sdk
├── audit/                       # @eks/audit — append-only audit log
├── events/                      # @eks/events — outbox + consumer framework
│   └── src/
│       ├── outbox/
│       │   ├── outbox-repository.ts
│       │   └── outbox-publisher.ts         # polls + publishes
│       ├── consumer/
│       │   ├── define-consumer.ts
│       │   └── exactly-once.ts             # idempotency-key store wrapper
│       └── schema/
│           └── registry.ts                 # JSON-schema registry client
├── http/                        # @eks/http — Interface-layer HTTP helpers
│   └── src/
│       ├── envelope.ts                     # standard response envelope
│       ├── problem-json.ts                 # RFC 7807 problem+json
│       ├── paginate.ts                     # cursor + offset pagination
│       ├── correlation.ts                  # request-id / correlation-id middleware
│       ├── idempotency.ts                  # Idempotency-Key store wrapper
│       └── openapi.ts                      # Zod → OpenAPI 3.1 generator
└── ui/                          # @eks/ui — shared React primitives
    └── src/
        ├── app-shell.tsx                   # today: src/components/app-shell.tsx
        ├── theme-provider.tsx              # today: src/components/theme-provider.tsx
        └── primitives/                     # today: src/components/ui/*
```

### 2.3 `src/lib/` — Cross-Cutting Services (M1 home, today)

The Milestone-1 sandbox keeps cross-cutting code flat in `src/lib/`. Each file maps to a planned `@eks/*` package (see column 4 in `ARCHITECTURE.md` §2).

```
src/lib/
├── db.ts                        # PrismaClient singleton (global cache for dev HMR) → @eks/*-infra
├── auth.ts                      # RBAC matrix, Principal, authorize(), demo resolver → @eks/auth
├── payswap.ts                   # Payswap payment abstraction → @eks/payments/infrastructure
├── matching.ts                  # Booking matching engine (haversine + scoring + auto-assign) → @eks/bookings
├── api.ts                       # Client-side fetch helpers for TanStack Query → @eks/http
├── store.ts                     # Zustand UI store (active module, sidebar, theme) → @eks/ui
├── format.ts                    # Money/date/distance formatters → @eks/shared-kernel
├── seed.ts                      # Idempotent demo-data seeder → scripts/seed.ts
└── utils.ts                     # cn() className merger (clsx + tailwind-merge) → @eks/ui
```

### 2.4 `src/components/` — React Components

```
src/components/
├── providers.tsx                # QueryClientProvider + ThemeProvider + Sonner/Toaster wiring
├── app-shell.tsx                # Layout chrome: sidebar + sticky topbar + sticky footer
├── theme-provider.tsx           # next-themes wrapper (light/dark)
├── checkout-dialog.tsx          # Payswap checkout modal (success/cancel URLs)
├── cook-card.tsx                # Cook grid tile (avatar, cuisines, rating, rate)
├── match-breakdown.tsx          # Radar chart of the 7-dimension match score
├── shared.tsx                   # KPI cards, module tiles, shared layout primitives
├── modules/                     # One file per top-level platform module
│   ├── overview-module.tsx          # Hero + KPIs + module grid + architecture pillars
│   ├── book-a-cook-module.tsx       # Filters + cook grid + match breakdown + booking + checkout
│   ├── cook-workspace-module.tsx    # Profile + earnings chart + certs + jobs + payouts
│   ├── admin-config-module.tsx      # Feature flags + services + pricing + regions
│   ├── food-intelligence-module.tsx # Heatmaps + trends + charts (anonymised)
│   └── ai-assistant-module.tsx      # Role-aware chat grounded in live data
└── ui/                          # shadcn/ui primitives (Radix-based, Tailwind-styled)
    ├── button.tsx                   # primary UI button (cva variants)
    ├── card.tsx                     # Card, CardHeader, CardContent, CardFooter
    ├── dialog.tsx                   # modal (Radix Dialog)
    ├── form.tsx                     # React Hook Form + Radix bridge
    ├── input.tsx, textarea.tsx      # text inputs
    ├── select.tsx                   # Radix Select
    ├── table.tsx                    # data table
    ├── chart.tsx                    # Recharts wrapper (ChartContainer, ChartTooltip)
    ├── toast.tsx, toaster.tsx, sonner.tsx  # toast systems
    ├── tabs.tsx, accordion.tsx, ... # 40+ primitives (see repo for full list)
    └── (one file per primitive)     # avatar, badge, breadcrumb, calendar, carousel,
                                     # checkbox, collapsible, command, context-menu,
                                     # drawer, dropdown-menu, hover-card, input-otp,
                                     # label, menubar, navigation-menu, pagination,
                                     # popover, progress, radio-group, resizable,
                                     # scroll-area, separator, sheet, sidebar,
                                     # skeleton, slider, switch, toggle, toggle-group,
                                     # tooltip
```

### 2.5 `src/hooks/` — React Hooks

```
src/hooks/
├── use-toast.ts                 # Imperative toast API (shadcn/ui)
└── use-mobile.ts                # Media-query hook (sidebar collapse)
```

---

## 3. `prisma/` — Schema & Migrations

```
prisma/
├── schema.prisma                 # THE source of truth for the data model
│                                 #   • generator client → PrismaClient
│                                 #   • datasource db → env DATABASE_URL
│                                 #   • 16 models grouped by bounded context
│                                 #   • SQLite in M1 sandbox; no SQLite-only types
│                                 #     (enums encoded as strings, validated at app layer)
└── migrations/                   # (target) prisma migrate deploy artefacts
    └── (target) <timestamp>_init/
```

Schema sections (in order in `schema.prisma`):

| Section | Models |
|---|---|
| Tenancy & Identity | `Organization`, `User` |
| Customer Platform | `Customer`, `Address`, `Favorite` |
| Cook Platform | `Cook`, `CookAvailability`, `Certification` |
| Configurable Catalog | `Service`, `MealCategory`, `Region`, `PricingRule`, `FeatureFlag` |
| Booking & Dispatch | `Booking` |
| Payswap Payments | `PayswapPayment`, `PayswapTransfer` |
| Food Inspection | `Inspection` |
| Food Intelligence | `DemandSignal` |
| Audit & Observability | `AuditLog` |

---

## 4. `infra/` — Infrastructure-as-Code (target layout)

```
infra/
├── docker/
│   ├── Dockerfile               # Multi-stage: deps → build → runtime (bun-based)
│   └── Dockerfile.worker        # Outbox publisher + event consumers image
├── caddy/
│   └── Caddyfile                # (root copy in repo) reverse proxy + TLS + region routing
├── k8s/                         # (target) Kubernetes manifests
│   ├── web-deployment.yaml      # Next.js standalone replicas
│   ├── worker-deployment.yaml   # Outbox + consumers
│   ├── postgres-statefulset.yaml
│   ├── redis-statefulset.yaml
│   ├── ingress.yaml             # Caddy ingress
│   └── hpa.yaml                 # HorizontalPodAutoscalers
├── terraform/                   # (target) cloud infra (VPC, RDS, ElastiCache, IAM)
│   ├── modules/
│   │   ├── tenant-database/
│   │   ├── redis-cluster/
│   │   └── region-router/
│   └── environments/
│       ├── ghana/
│       └── nigeria/
└── observability/
    ├── grafana-dashboards/      # Health, outbox backlog, DLQ, payments
    ├── alerting-rules.yaml      # Prometheus rules → see OPERATIONS_RUNBOOK.md
    └── otel-collector.yaml      # OpenTelemetry collector config
```

---

## 5. `scripts/` — Operational Scripts (target layout)

```
scripts/
├── seed.ts                      # Idempotent demo-data seed (today: src/lib/seed.ts)
├── migrate.ts                   # Wraps `prisma migrate deploy` with pre-flight checks
├── outbox-replay.ts             # Replay outbox rows for a given event type + window
├── event-replay.ts              # Replay integration events from the event log
├── flag-force.ts                # Force-set a feature flag (see OPERATIONS_RUNBOOK.md)
├── backup-audit.ts              # Export AuditLog to cold storage (S3 / GCS)
├── export-openapi.ts            # Generate openapi.json from Zod schemas
└── anonymise-intelligence.ts    # One-shot PII scrub for Food Intelligence exports
```

---

## 6. `docs/` — Documentation (this directory)

```
docs/
├── ARCHITECTURE.md              # System architecture, layers, package map
├── FOLDER_STRUCTURE.md          # This file
├── CODING_STANDARDS.md          # TS strictness, naming, Result<T,E>, layering
├── CONTRIBUTING.md              # Trunk-based, Conventional Commits, PR checklist
├── EVENT_CONVENTIONS.md         # Domain/Integration/Internal events, outbox, replay
├── API_CONVENTIONS.md           # REST v1, RFC 7807, pagination, OpenAPI
├── TESTING_GUIDE.md             # Vitest, test pyramid, factories, coverage
├── DEPLOYMENT_GUIDE.md          # Build, Docker, env vars, migrations, rollback
├── OPERATIONS_RUNBOOK.md        # On-call, alert scenarios, runbooks, severity
├── DEVELOPER_ONBOARDING.md      # 30/60/90 plan + @eks/* cheat sheet
├── SECURITY.md                  # OWASP mapping, headers, audit, disclosure
├── PAYMENTS.md                  # PaymentProvider port + Payswap contract
└── adr/                         # (target) Architectural Decision Records
    ├── 0001-modular-monolith.md
    ├── 0002-hexagonal-layering.md
    └── ...
```

---

## 7. `tests/` — Cross-Cutting Tests & Runtime Scripts

```
tests/
├── python-runtime-build.sh      # Builds the Python runtime container (auxiliary services)
├── python-runtime-container.sh  # Runs the Python runtime container
└── database-runtime-build.sh    # Builds the database runtime container (Postgres seed image)
```

> Unit and integration tests are **co-located** with source under `src/**/__tests__/` or as `*.spec.ts` siblings — see `TESTING_GUIDE.md`. The top-level `tests/` directory is reserved for cross-cutting, environment-level, and infrastructure tests that don't belong to a single package.

---

## 8. `public/` — Static Assets

```
public/
├── logo.svg                     # Eks-Food wordmark / mark
├── robots.txt                   # Crawler directives
└── images/                      # Brand + marketplace imagery (1024×1024, JPEG-as-.png)
    ├── hero-cooking.png         # Overview hero
    ├── cook-amara.png           # Cook portraits
    ├── cook-kwame.png
    ├── cook-zainab.png
    ├── cook-tunde.png
    ├── dish-jollof.png          # Dish photography
    ├── dish-fufu.png
    └── dish-banku.png
```

> **Note:** image-generation CLI mandates `.png` extension but the bytes are JPEG. Frontend references use `.png` to match on-disk filenames. See worklog Task ID 4.

---

## 9. File-Size & Module-Size Guidance

| Kind | Soft limit | Hard limit | Action when exceeded |
|---|---|---|---|
| Single `.ts` / `.tsx` file | 300 lines | 500 lines | Split by concern; extract a sibling file or a private sub-module. |
| Single `@eks/*` package public surface (`index.ts`) | 40 exports | 60 exports | Split package into two bounded contexts. |
| Single React component file | 200 lines | 350 lines | Extract child components into siblings. |
| Single route handler (`route.ts`) | 100 lines | 150 lines | Move logic into an Application use case; route handler should only parse + dispatch. |

These limits are enforced by review and by `scripts/check-file-size.ts` (planned) in CI.

---

## 10. Import Path Aliases

Defined in `tsconfig.json`:

| Alias | Resolves to |
|---|---|
| `@/*` | `./src/*` |
| `@eks/shared-kernel` (target) | `./src/packages/shared-kernel/src/index.ts` |
| `@eks/auth` (target) | `./src/packages/auth/src/index.ts` |
| `@eks/bookings` (target) | `./src/packages/bookings/src/index.ts` |
| `@eks/payments` (target) | `./src/packages/payments/src/index.ts` |
| `@eks/<name>` (target) | `./src/packages/<name>/src/index.ts` |

> In Milestone 1, `@/*` is the only active alias; `@eks/*` aliases ship in Milestone 2 alongside the package extraction. Until then, `@eks/<name>` in this documentation refers conceptually to the planned package and concretely to the `src/lib/*` file mapped in §2.3.
