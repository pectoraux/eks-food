# Eks-Food — Testing Guide

> **Audience:** Every engineer writing code. Read alongside `CODING_STANDARDS.md` §12 (testing rules) and `CONTRIBUTING.md` §3 (PR checklist).
>
> **TL;DR:** Tests are co-located with source. Vitest is the runner. Coverage target is ≥80% statements. Domain tests are pure; integration tests use a real test database; e2e tests use a real browser. Mock the world at the seams, not in the middle.

---

## 1. Tooling

| Concern | Tool | Version |
|---|---|---|
| Test runner | **Vitest** | 4.x |
| Coverage | **@vitest/coverage-v8** | 4.x |
| DOM testing | **@testing-library/react** + **@testing-library/jest-dom** | latest |
| Browser E2E | **Playwright** (M2 target; Agent Browser for ad-hoc verification today) | latest |
| Mocking | Vitest built-in `vi.mock`, `vi.spyOn`, `vi.fn` | built-in |
| HTTP mocking | **msw** (Mock Service Worker) for client-side fetch | 2.x |
| DB mocking | Real test Postgres per worker + `prisma migrate reset` per suite | — |
| Factory | Custom lightweight factories in `tests/factories/` | — |

`package.json` already declares `vitest`, `@vitest/coverage-v8`, and `bun-types`. Playwright and `@testing-library/*` ship in M2.

---

## 2. Test Pyramid

```
                          ┌──────────────┐
                          │     E2E      │   ~5%   Slow, expensive, brittle.
                          │  (Playwright)│         Only happy paths of
                          └──────────────┘         critical user journeys.
                       ┌──────────────────┐
                       │  Integration     │  ~25%  DB, cache, broker, provider
                       │  (Vitest + real  │         adapters wired; mocks only
                       │  Postgres + Redis)│        at the network edge.
                       └──────────────────┘
                  ┌──────────────────────────┐
                  │        Unit              │  ~70%  Pure, fast, deterministic.
                  │  (Vitest, no I/O)        │         Domain + application
                  └──────────────────────────┘         layers + pure utilities.
```

### 2.1 What goes where

| Layer | Where | What |
|---|---|---|
| **Unit** | `*.spec.ts` co-located with source | Domain aggregates, value objects, pure functions, Zod schemas, the matching scorer (with stubbed DB), Result combinators, money math |
| **Integration** | `__tests__/*.spec.ts` co-located, or `tests/integration/<context>/` | Repository adapters against a real test DB, use-case handlers with real repos + mocked provider ports, route handlers with real DB + mocked external HTTP |
| **E2E** | `tests/e2e/<journey>.spec.ts` | Browse → book → match → pay → confirm → payout; admin flag toggle; cook workspace earnings; AI assistant grounded reply |
| **Contract** | `tests/contract/<provider>.spec.ts` | Payswap adapter against a recorded fixture set; replays of real webhooks |
| **Load** | `tests/load/<scenario>.ts` (k6, M3) | Booking creation burst, outbox publisher throughput, AI assistant concurrency |

### 2.2 The ratio rule

For every line of production code, the project should have ~3 lines of test code, split roughly:

- ~2 lines of unit tests
- ~0.5 lines of integration tests
- ~0.5 lines of e2e / contract / load

If a PR adds 100 lines of production code and 0 lines of test, it's not done. If it adds 100 lines of code and 600 lines of e2e test, the architecture is wrong — push logic down into testable units.

---

## 3. Where Tests Live

### 3.1 Co-located unit tests

A unit test sits next to the file it tests, suffixed `.spec.ts`:

```
src/packages/bookings/src/domain/
├── booking.ts
├── booking.spec.ts              ← unit tests for the Booking aggregate
├── matching-service.ts
└── matching-service.spec.ts     ← unit tests for the scorer (DB stubbed)
```

This is the default. A new engineer reading `booking.ts` sees `booking.spec.ts` in the same directory — they don't have to hunt.

### 3.2 Co-located integration tests

When a test needs the real DB or a real adapter, it goes in a sibling `__tests__/` directory within the same package:

```
src/packages/bookings/src/
├── application/commands/
│   └── create-booking.ts
└── __tests__/
    └── create-booking.spec.ts   ← integration test: real repo, real DB, mocked Payswap
```

### 3.3 Cross-cutting tests

Tests that span packages or test the deployed app go in the top-level `tests/` directory:

```
tests/
├── e2e/
│   ├── book-and-pay.spec.ts
│   └── admin-flag-toggle.spec.ts
├── contract/
│   └── payswap-webhook.spec.ts
├── factories/
│   ├── booking.factory.ts
│   ├── cook.factory.ts
│   └── payment.factory.ts
├── fixtures/
│   ├── payswap-webhooks/
│   │   ├── payment_intent.succeeded.json
│   │   └── transfer.paid.json
│   └── demand-signals/
│       └── greater-accra-2025-07.json
└── helpers/
    ├── test-db.ts               ← spins up a per-worker Postgres schema
    ├── test-redis.ts            ← spins up a per-test Redis DB index
    └── test-app.ts              ← boots Next.js for e2e
```

---

## 4. Vitest Configuration

### 4.1 `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "src/**/*.spec.ts",
      "src/**/*.spec.tsx",
      "tests/**/*.spec.ts",
    ],
    exclude: ["node_modules", ".next", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/*.spec.tsx",
        "src/**/__tests__/**",
        "src/**/index.ts",            // barrel files
        "src/app/**/layout.tsx",      // Next.js boilerplate
        "src/components/ui/**",       // shadcn/ui primitives
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
    pool: "threads",
    poolOptions: { threads: { singleThread: false } },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@eks/shared-kernel": path.resolve(__dirname, "./src/packages/shared-kernel/src"),
      "@eks/auth": path.resolve(__dirname, "./src/packages/auth/src"),
      // ... etc per package
    },
  },
});
```

### 4.2 Client-component tests

Tests that import React components set `environment: "jsdom"` per-file:

```ts
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CookCard } from "../cook-card";

describe("CookCard", () => {
  it("renders the cook name and rating", () => {
    render(<CookCard cook={cookFixture} />);
    expect(screen.getByText("Amara Mensah")).toBeVisible();
    expect(screen.getByText(/5.0/)).toBeVisible();
  });
});
```

### 4.3 Setup

```ts
// tests/setup.ts
import { afterAll, afterEach, beforeAll } from "vitest";
import { startTestDb, stopTestDb, resetTestDb } from "./helpers/test-db";
import { startTestRedis, stopTestRedis, resetTestRedis } from "./helpers/test-redis";

beforeAll(async () => {
  await startTestDb();
  await startTestRedis();
}, 60_000);

afterEach(async () => {
  await resetTestDb();
  await resetTestRedis();
});

afterAll(async () => {
  await stopTestDb();
  await stopTestRedis();
});
```

---

## 5. Running Tests

### 5.1 Commands

```bash
bun run test                 # run all unit + integration tests, watch mode in dev
bun run test:run             # single run (CI mode)
bun run test:coverage        # run with coverage report
bun run test:ui              # open Vitest UI dashboard
bun run test:e2e             # run Playwright e2e suite
bun run test:contract        # run provider contract tests
bun run test -- <pattern>    # run matching tests, e.g. `bun run test -- booking`
```

Add to `package.json` `scripts`:

```json
{
  "test": "vitest",
  "test:run": "vitest run",
  "test:coverage": "vitest run --coverage",
  "test:ui": "vitest --ui",
  "test:e2e": "playwright test",
  "test:contract": "vitest run tests/contract"
}
```

### 5.2 CI

- PR pipeline: `bun run test:run` (must pass) + `bun run test:coverage` (must hit thresholds on touched files).
- Main pipeline: same + `bun run test:e2e` on a staging deploy.
- Nightly: full coverage report + a flake-detector run (3× repeat; any test that fails 1/3 times is marked flaky and filed).

### 5.3 Local dev loop

```
# Terminal 1
bun run dev

# Terminal 2
bun run test                    # watch mode, re-runs on file change
```

For a tight loop on one file:

```bash
bun run test -- src/packages/bookings/src/domain/booking.spec.ts
```

---

## 6. Coverage Targets

| Metric | Target | Hard floor |
|---|---|---|
| Statements | ≥ 80% | 75% |
| Branches | ≥ 70% | 65% |
| Functions | ≥ 80% | 75% |
| Lines | ≥ 80% | 75% |

### 6.1 Per-layer targets

- **Domain layer:** ≥ 95% statements. Domain code is pure and easily tested; anything less is unacceptable.
- **Application layer:** ≥ 85% statements. Commands/queries should have happy + error + idempotency tests.
- **Infrastructure layer:** ≥ 70% statements. Adapter code is harder to test fully; cover the happy path, the failure modes that surface to users, and the retry/idempotency logic.
- **Interface layer (route handlers):** ≥ 80% statements via integration tests.
- **React components:** ≥ 70% statements. Cover rendering, user interactions, and error states; don't chase 100% on shadcn/ui primitives.

### 6.2 What 100% coverage does not mean

Coverage proves lines were executed. It does not prove correctness. A test that asserts nothing (`expect(true).toBe(true)`) inflates coverage without proving anything. Reviewers reject tests that don't assert behaviour.

### 6.3 What we don't cover

- `src/components/ui/**` — shadcn/ui primitives are upstream-tested.
- `src/app/**/layout.tsx`, `src/app/**/page.tsx` — Next.js framework wiring; tested via e2e.
- Generated code (Prisma client, OpenAPI types).
- Migration SQL (tested via `prisma migrate reset` in CI, not via unit tests).

---

## 7. Factories & Fixtures

### 7.1 Factories

Factories build valid domain entities for tests. They live in `tests/factories/<entity>.factory.ts`. Each factory:

- Has a sensible default for every required field.
- Accepts overrides as a partial input.
- Returns the entity (or, for persistence factories, persists it and returns the saved row).
- Composes other factories for nested entities.

```ts
// tests/factories/booking.factory.ts
import { db } from "@/lib/db";
import { createCookFactory } from "./cook.factory";
import { createCustomerFactory } from "./customer.factory";
import { createServiceFactory } from "./service.factory";

export interface BookingOverrides {
  code?: string;
  status?: string;
  quotedPrice?: number;
  currency?: string;
  cookId?: string;
  customerId?: string;
  serviceId?: string;
  scheduledFor?: Date;
  organizationId?: string;
}

export async function createBookingFactory(overrides: BookingOverrides = {}) {
  const organizationId = overrides.organizationId ?? "eks-default-org-id";
  const cook = overrides.cookId ?? (await createCookFactory({ organizationId })).id;
  const customer = overrides.customerId ?? (await createCustomerFactory({ organizationId })).id;
  const service = overrides.serviceId ?? (await createServiceFactory({ organizationId })).id;

  return db.booking.create({
    data: {
      organizationId,
      code: overrides.code ?? `EKS-TEST${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      customerId: customer,
      cookId: cook,
      serviceId: service,
      bookingType: "IMMEDIATE",
      scheduledFor: overrides.scheduledFor ?? new Date(Date.now() + 86_400_000),
      durationMins: 120,
      partySize: 2,
      addressLine1: "12 Test Lane",
      city: "Accra",
      region: "Greater Accra",
      lat: 5.6037,
      lng: -0.1870,
      status: overrides.status ?? "CONFIRMED",
      quotedPrice: overrides.quotedPrice ?? 180.0,
      currency: overrides.currency ?? "GHS",
    },
  });
}
```

### 7.2 Fixtures

Fixtures are static test data — JSON files, images, recorded API responses. They live in `tests/fixtures/`. Use fixtures when:

- The data shape is contractual (e.g. a recorded Payswap webhook).
- The data is large (e.g. 1400 demand signals) and you don't want to regenerate it per test.
- The data is shared across many tests (e.g. a standard cook profile).

```ts
// tests/contract/payswap-webhook.spec.ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const webhookFixture = JSON.parse(
  readFileSync("tests/fixtures/payswap-webhooks/payment_intent.succeeded.json", "utf8"),
);

describe("Payswap webhook ingestion", () => {
  it("marks the payment SUCCEEDED when webhook type is payment_intent.succeeded", async () => {
    // ... use webhookFixture
  });
});
```

### 7.3 Builders vs fixtures

- **Builders** (factories) for entities that need to vary per test.
- **Fixtures** for contractual / external data that doesn't change.
- Don't use a fixture where a builder is more flexible; don't use a builder where a fixture makes the contract explicit.

---

## 8. Mocking the Seams

### 8.1 What to mock, what to keep real

| Concern | In unit tests | In integration tests | In e2e |
|---|---|---|---|
| Database | Mock the repository port | Real test Postgres | Real Postgres |
| Redis cache | Mock the cache port | Real test Redis | Real Redis |
| Message broker | Mock the publisher | Real Redis Streams / in-memory | Real broker |
| Payswap provider | Mock `PaymentProvider` port | Mock at HTTP layer (msw) | Payswap sandbox |
| z-ai-web-dev-sdk | Mock the SDK | Mock the SDK | Real SDK |
| Email/SMS gateway | Mock the gateway port | Mock the gateway port | Real gateway (suppressed) |
| Time (`Clock`) | Inject a fixed `Clock` | Inject a fixed `Clock` | Real clock |

### 8.2 Mocking the repository (unit test)

```ts
import { describe, it, expect, vi } from "vitest";
import { CreateBookingCommandHandler } from "../create-booking";
import type { BookingRepository } from "../../application/ports/booking-repository";
import type { PaymentProvider } from "@eks/payments";

describe("CreateBookingCommandHandler", () => {
  it("returns Result.err(booking.invalid_state) when service code is unknown", async () => {
    const bookings: BookingRepository = {
      findByCode: vi.fn(),
      findByOrganization: vi.fn(),
      save: vi.fn(),
    };
    const payments: PaymentProvider = {
      createIntent: vi.fn(),
      createCheckoutSession: vi.fn(),
      confirm: vi.fn(),
      retrieve: vi.fn(),
      transfer: vi.fn(),
      refund: vi.fn(),
      handleWebhook: vi.fn(),
    };

    const handler = new CreateBookingCommandHandler(bookings, /* cooks */ vi.fn() as any, payments, /* outbox */ vi.fn() as any);
    const result = await handler.handle({ /* ... serviceCode: "UNKNOWN" */ } as any);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("booking.unknown_service");
    expect(payments.createIntent).not.toHaveBeenCalled();
  });
});
```

> Note: `as any` appears above only for the unused ports in this single test; in real code we use a `mockPort<T>()` helper that returns a fully-mocked implementation. See `tests/helpers/mock-port.ts` (target M2).

### 8.3 Mocking the HTTP edge (integration test, msw)

```ts
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const server = setupServer(
  http.post("https://api.payswap.com/v1/payment_intents", () =>
    HttpResponse.json({
      id: "pi_test_123",
      client_secret: "pi_test_123_secret",
      status: "requires_action",
      amount: 18000,
      currency: "ghs",
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("POST /api/v1/payswap/checkout", () => {
  it("creates a Payswap payment intent and returns the checkout URL", async () => {
    // ... call the route handler with a real NextRequest
  });
});
```

### 8.4 Mocking time

Inject a `Clock` port into application code; never call `Date.now()` or `new Date()` directly in domain or application layers.

```ts
// @eks/shared-kernel/src/clock.ts
export interface Clock { now(): Date; }
export class SystemClock implements Clock { now() { return new Date(); } }
export class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now() { return this.fixed; }
  advance(ms: number) { this.fixed = new Date(this.fixed.getTime() + ms); }
}

// In a test:
const clock = new FixedClock(new Date("2025-07-30T12:00:00Z"));
const handler = new CreateBookingCommandHandler(bookings, cooks, payments, outbox, clock);
```

### 8.5 Mocking the database (when you must)

For pure unit tests of application logic, mock the repository port (§8.2). For integration tests, use a real test database (§9). Avoid mocking Prisma directly — it's brittle and hides schema bugs.

When you do need to stub a single Prisma call (e.g. to force an error), use `vi.spyOn(db.booking, "findUnique")` and restore in `afterEach`.

---

## 9. The Test Database

### 9.1 One schema per worker

CI runs tests in parallel workers. Each worker gets its own Postgres schema (`test_<workerId>`) to avoid cross-contamination. The `tests/helpers/test-db.ts` helper:

1. On `beforeAll`: creates a fresh schema, runs `prisma migrate deploy` against it, sets `DATABASE_URL` to point at it.
2. On `afterEach`: truncates all tables (faster than `migrate reset`).
3. On `afterAll`: drops the schema.

### 9.2 Local dev

For local dev, a single shared test database is fine. Set `EKS_TEST_DATABASE_URL=postgresql://...@localhost:5432/eks_test`. The setup script detects a local run and uses truncation instead of schema-per-worker.

### 9.3 SQLite fallback

In the M1 sandbox, tests run against SQLite (`db/custom.db`). This is acceptable for unit-level integration tests but does not exercise Postgres-specific behaviour (JSON operators, `FOR UPDATE SKIP LOCKED`, arrays). Postgres-only behaviours are tested in CI against a real Postgres container (see `tests/database-runtime-build.sh`).

### 9.4 Migrations in tests

Tests assume the schema is up to date. The setup script runs `prisma migrate deploy` once per worker. If a migration is broken, every test fails fast with a clear error.

---

## 10. Component Testing with React Testing Library

### 10.1 Principles

- **Test behaviour, not implementation.** Query by role, label, or visible text — not by class name or test ID (unless accessibility requires otherwise).
- **Test what the user sees.** Don't assert on internal state; assert on rendered output.
- **Avoid implementation detail queries.** `container.querySelector('.internal-class')` is a smell.

### 10.2 Setup

```ts
// tests/setup.tsx (jsdom environment)
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

### 10.3 Example — Book-a-Cook module

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { BookACookModule } from "../book-a-cook-module";

const server = setupServer(
  http.get("/api/cooks", () =>
    HttpResponse.json({
      data: [
        { id: "c1", name: "Amara", cuisines: ["ghanaian"], rating: 5.0, hourlyRate: 50 },
      ],
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("BookACookModule", () => {
  it("renders cooks from the API", async () => {
    renderWithProviders(<BookACookModule />);
    await waitFor(() => expect(screen.getByText("Amara")).toBeVisible());
    expect(screen.getByText(/ghanaian/i)).toBeVisible();
  });

  it("filters cooks by cuisine when the filter chip is clicked", async () => {
    renderWithProviders(<BookACookModule />);
    await waitFor(() => expect(screen.getByText("Amara")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: /nigerian/i }));
    await waitFor(() => expect(screen.queryByText("Amara")).not.toBeInTheDocument());
  });
});
```

### 10.4 What not to do

- ❌ Snapshot testing for components. Snapshots break on cosmetic changes and prove nothing. Use them only for serialised output (event payloads, OpenAPI fragments).
- ❌ Testing `useState` internals. Test what the user sees after the state change.
- ❌ Mocking the component under test. If you're mocking the thing you're testing, you're testing the mock.

---

## 11. Writing Good Test Names

Test names are sentences. A reader should understand the behaviour from the `describe` + `it` alone, without reading the body.

```ts
// ✅ Good
describe("Booking.cancel", () => {
  it("returns Result.err(invalid_state) when booking is already COMPLETED", () => { ... });
  it("sets status to CANCELLED and emits Booking.Cancelled", () => { ... });
  it("issues a full refund when cancelled within 60 minutes of confirmation", () => { ... });
  it("issues a 30% refund when cancelled after 60 minutes", () => { ... });
});

// ❌ Bad
describe("cancel", () => {
  it("works", () => { ... });
  it("test1", () => { ... });
  it("should work correctly", () => { ... });
});
```

---

## 12. Test Data & PII

- **MUST NOT** use real customer PII in tests. Use generated names, fake emails (`test+<id>@eks.test`), random cuids.
- **MUST NOT** commit real Payswap IDs, real phone numbers, or real addresses. Use fixtures with obviously fake data (`+233000000000`, `12 Test Lane`).
- **MUST** scrub the test database of any PII before snapshotting it for debugging.

---

## 13. Flaky Tests

A flaky test is a bug. The policy:

1. A test that fails intermittently in CI is quarantined: moved to `tests/quarantine/` and marked `it.skip` with a comment + ticket link.
2. The owner has **2 weeks** to fix or delete it. After 2 weeks, it's deleted.
3. A test that flakes 3× in a week is auto-quarantined by CI.

We never tolerate flaky tests in the main suite. A green build must mean the code works.

---

## 14. Performance Budget

| Suite | Budget |
|---|---|
| Single unit test | < 50 ms |
| Single integration test | < 2 s |
| Single e2e test | < 30 s |
| Full unit + integration suite (CI) | < 5 min |
| Full e2e suite (nightly) | < 20 min |

Tests over budget are flagged by CI. The owner either speeds them up or moves them to a slower suite (e.g. a `@slow` annotation that runs only on main).

---

## 15. Test Anti-Patterns to Reject in Review

| ❌ Anti-pattern | ✅ Fix |
|---|---|
| `expect(true).toBe(true)` | Assert on actual behaviour |
| Snapshot testing components | Query by role + assert visible content |
| Mocking the thing under test | Mock its dependencies, not itself |
| `Date.now()` in domain code | Inject `Clock` |
| One giant test that does 10 things | Split into 10 tests, each named for its behaviour |
| Test depends on test ordering | Each test sets up and tears down its own state |
| Test hits the real Payswap API | Use msw or a sandbox; never real money |
| `console.log` left in test | Use `ctx.log` (Vitest) or remove |
| Shared mutable fixture mutated across tests | Make fixtures immutable; use factories for variation |
| Coverage gate that ignores a folder "just because" | Add the exclusion to `vitest.config.ts` with a justification comment |
