# Eks-Food — Developer Onboarding

> **Audience:** A new engineer joining Eks-Food. This is your 30/60/90 plan to go from `git clone` to your first merged PR.
>
> **Goal:** by the end of 90 minutes you have opened a PR that adds a test to a bounded context, has passed CI, and has been reviewed by a teammate.

---

## 0. Before You Start (5 min)

You need:

- A workstation with **Bun 1.1+** installed (`curl -fsSL https://bun.sh/install | bash`).
- **Node.js 20+** (Bun uses this for some Next.js internals; `nvm install 20`).
- **Git** and access to the Eks-Food GitHub org (ask your manager).
- A terminal, an editor (VS Code with the ESLint + Tailwind + Prisma extensions is the house style), and a coffee.

Slack channels to join: `#eks-eng`, `#eks-onboarding`, `#eks-random`. Say hi in `#eks-onboarding`; your onboarding buddy is watching.

---

## 1. Minutes 0–30: Clone, Install, Run

### 1.1 Clone

```bash
git clone git@github.com:eks-food/eks-food.git
cd eks-food
```

### 1.2 Install dependencies

```bash
bun install
```

This reads `bun.lock` and installs exactly the pinned versions. If `bun install` fails, check that you're on Bun 1.1+ (`bun --version`).

### 1.3 Set up the database

The sandbox uses SQLite — no Postgres install needed for local dev.

```bash
cp .env.example .env.local
# Edit .env.local if you want; defaults work for sandbox
bun run db:push       # creates the SQLite file at db/custom.db and applies the schema
bun run db:generate   # generates the Prisma client
```

### 1.4 Seed demo data

```bash
curl -X POST http://localhost:3000/api/seed
# or, before the server is up:
bun run scripts/seed.ts
```

This creates: 1 organization (`eks-ghana`), 4 cooks (Amara, Kwame, Zainab, Tunde) with certifications and availability, 1 customer, manager/inspector/admin users, services, meal categories, regions, pricing rules, feature flags, 1400 demand signals, and a sample booking + payment + payout history.

### 1.5 Start the dev server

```bash
bun run dev
```

This runs `next dev -p 3000`. Open **http://localhost:3000**.

You should see the **Platform Foundation Console**:
- Overview module with hero, KPIs (cooks, bookings, GMV), module grid, architecture pillars.
- A sidebar with 6 modules: Overview, Book-a-Cook, Cook Workspace, Admin Console, Food Intelligence, AI Assistant.

If anything is broken, check `dev.log` (the dev script tees output there). Common fixes:
- `Cannot find module '@prisma/client'` → run `bun run db:generate`.
- `Database is locked` → another process has the SQLite file; kill stale Node/Bun processes.
- Port 3000 in use → `PORT=3001 bun run dev`.

### 1.6 Run the test suite (sanity check)

```bash
bun run test:run
```

If everything is green, you're set up. If not, ping `#eks-onboarding` with the error.

---

## 2. Minutes 30–60: Read the Maps

You don't need to read every doc cover-to-cover. Read these in this order:

### 2.1 `docs/ARCHITECTURE.md` (15 min)

Focus on:
- §2 Bounded Contexts — the table. You'll work in one of these.
- §3 Hexagonal layers — the diagram. Know which layer you're in before you write code.
- §4 CQRS & event-driven — the outbox flow diagram. This is how the system breathes.
- §6 `@eks/*` package map — the table. Find the package you'll work in.

### 2.2 `docs/FOLDER_STRUCTURE.md` (10 min)

Skim the tree. Find:
- Where your bounded context's code lives today (`src/lib/`, `src/app/api/`) and where it's moving (`src/packages/`).
- Where tests live.
- Where docs live (you're here).

### 2.3 `docs/CODING_STANDARDS.md` (5 min, skim)

Bookmark §2 (naming) and §4 (`Result<T,E>`). You'll refer back constantly. The Quick Reference (§13) is a cheat sheet.

### 2.4 Pick a bounded context (5 min)

Pick **one** context for your first PR. Recommended starter contexts:
- **Food Intelligence** — pure read-model work, no money, low blast radius. Best for first PR.
- **Cook Platform** — CRUD + a domain invariant. Good for learning the layering.
- **Catalog** — config CRUD. Simple but exercises the admin API.

Avoid for first PR:
- **Payments** — money movement; high blast radius; needs two-staff-engineer review.
- **Auth** — security-sensitive; needs two-staff-engineer review.
- **Events infrastructure** — outbox/consumer framework; needs deep context.

Tell `#eks-onboarding` which context you picked; they'll match you with a reviewer who owns it.

---

## 3. Minutes 60–90: Write a Test, Open a PR

### 3.1 Find a good first issue

Look for issues labelled `good first issue` in your chosen context. If none, ask your onboarding buddy — they'll find you one. The classic first issue: **add a missing unit test for an existing domain function**.

Example: the matching engine in `src/lib/matching.ts` has `haversineKm()` and `autoAssign()`. The scoring logic is pure (DB is stubbable). A great first PR adds tests for:
- `haversineKm` with known coordinates (Accra → Tema ≈ 25 km).
- `autoAssign` returns `BELOW_THRESHOLD` when the best candidate is below threshold.
- `autoAssign` returns `NO_CANDIDATES` when the list is empty.

### 3.2 Write the test

Create `src/lib/matching.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { haversineKm, autoAssign, type MatchedCook } from "./matching";

describe("haversineKm", () => {
  it("returns ~25 km from Accra to Tema", () => {
    const accra = { lat: 5.6037, lng: -0.1870 };
    const tema  = { lat: 5.6698, lng: 0.0166 };
    const d = haversineKm(accra, tema);
    expect(d).toBeGreaterThan(24);
    expect(d).toBeLessThan(27);
  });

  it("returns 0 for the same point", () => {
    const p = { lat: 5.6, lng: -0.18 };
    expect(haversineKm(p, p)).toBe(0);
  });
});

describe("autoAssign", () => {
  it("returns NO_CANDIDATES when the candidate list is empty", async () => {
    const result = await autoAssign("booking-1", []);
    expect(result.assigned).toBe(false);
    expect(result.reason).toBe("NO_CANDIDATES");
  });

  it("returns BELOW_THRESHOLD when the best candidate is below the threshold", async () => {
    const weak: MatchedCook[] = [
      { /* ... a cook with score 0.3 ... */ } as MatchedCook,
    ];
    const result = await autoAssign("booking-1", weak, 0.55);
    expect(result.assigned).toBe(false);
    expect(result.reason).toBe("BELOW_THRESHOLD");
  });
});
```

> Note: `autoAssign` writes to the DB. The test for `BELOW_THRESHOLD` works because it returns before the DB write. For tests that exercise the DB write, you need the test database (see `TESTING_GUIDE.md` §9). For a first PR, prefer pure-logic tests.

### 3.3 Run the test

```bash
bun run test -- src/lib/matching.spec.ts
```

Watch it pass. If it fails, read the error — Vitest's output is excellent.

### 3.4 Check coverage

```bash
bun run test:coverage -- src/lib/matching.spec.ts
```

Confirm `matching.ts` coverage went up. (Don't worry about the global threshold for a first PR; reviewers care about your delta.)

### 3.5 Lint + typecheck

```bash
bun run lint
bun run tsc --noEmit
```

Both must be clean.

### 3.6 Branch + commit

```bash
git checkout -b test/matching-haversine-EKS-001
git add src/lib/matching.spec.ts
git commit -m "test(bookings): add haversine + autoAssign unit tests

Covers the geo distance calculation with a known Accra→Tema fixture
and the auto-assign fallback branches (NO_CANDIDATES, BELOW_THRESHOLD).

Closes EKS-001"
```

(Conventional Commits — see `CONTRIBUTING.md` §2.)

### 3.7 Push + open PR

```bash
git push -u origin test/matching-haversine-EKS-001
```

Open the PR on GitHub. Use the PR template from `CONTRIBUTING.md` §3.2. Set your onboarding buddy as reviewer.

### 3.8 Address review

Your reviewer will leave comments. Respond to each (fix, push back with reasoning, or mark won't-fix). Push updates; CI re-runs. When approved, squash-merge.

🎉 You've shipped to Eks-Food.

---

## 4. `@eks/*` Package Cheat-Sheet

Print this. Tape it to your monitor.

| Package | What it does | Key exports you'll use |
|---|---|---|
| `@eks/shared-kernel` | Cross-context primitives | `Result<T,E>`, `ok()`, `err()`, `Money`, `EntityId`, `Clock`, `DomainError` |
| `@eks/auth` | RBAC, Principal, sessions | `Principal`, `Role`, `PERMISSIONS`, `authorize(principal, perm)`, `resolvePrincipal(headers)` |
| `@eks/customers` | Customer profiles, addresses, favorites | `CustomerRepository`, `CreateCustomerCommand`, `CustomerView` |
| `@eks/cooks` | Cook profiles, certifications, availability | `CookRepository`, `ApproveCookCommand`, `CookAvailabilityService` |
| `@eks/catalog` | Tenant config: services, regions, pricing, flags | `ServiceRepository`, `FeatureFlagService`, `PricingCalculator`, `RegionService` |
| `@eks/bookings` | Booking lifecycle + matching engine | `BookingRepository`, `matchCooks(req)`, `autoAssign(id, candidates)`, `CreateBookingCommand` |
| `@eks/payments` | Provider-agnostic payments; Payswap adapter | `PaymentProvider` (port), `PayswapProvider` (adapter), `createIntent`, `confirm`, `transfer`, `refund`, `handleWebhook` |
| `@eks/inspections` | Inspector scheduling, checklists, scoring | `InspectionRepository`, `ScheduleInspectionCommand` |
| `@eks/intelligence` | Anonymised demand signals | `DemandSignalRepository`, `DemandAggregator` |
| `@eks/ai` | Role-aware copilots | `askAssistant(principal, prompt)`, `buildCopilotContext(principal)` |
| `@eks/audit` | Append-only audit log | `writeAudit(actor, action, entity, meta)`, `AuditRepository` |
| `@eks/events` | Outbox + consumer framework | `OutboxWriter`, `OutboxPublisher`, `defineConsumer(opts)`, `EventSchemaRegistry` |
| `@eks/http` | Interface-layer HTTP helpers | `envelope(data, meta)`, `problemJson(error)`, `paginate(rows, cursor)`, `withCorrelation(handler)` |
| `@eks/ui` | Shared React primitives | `AppShell`, `Button`, `Card`, `useToast`, `useQuery` wrapper |

### 4.1 Common patterns

**Resolve the principal** at the start of every route handler:
```ts
const principal = resolvePrincipal(req.headers);
authorize(principal, "booking.create");
```

**Return a Result** from every application method:
```ts
const result = await createBooking.handle(cmd);
if (!result.ok) return problemJson(result.error);
return NextResponse.json(envelope(result.value), { status: 201 });
```

**Publish an event** via the outbox:
```ts
await outbox.write({
  eventType: "Booking.Created",
  eventVersion: 1,
  aggregateId: booking.id,
  aggregateType: "Booking",
  correlationId: principal.correlationId,
  causationId: cmd.commandId,
  data: booking.toJSON(),
});
```

**Define a consumer**:
```ts
export const bookingCreatedConsumer = defineConsumer({
  name: "eks.notifications.booking-confirmed",
  eventType: "Booking.Confirmed",
  minVersion: 1, maxVersion: 1,
  async handle(event, ctx) { /* ... */ },
});
```

**Call Payswap** (never store card data):
```ts
const intent = await payments.createIntent({
  organizationId, bookingCode, amount, currency,
  idempotencyKey: genIdempotencyKey("pi"),
});
```

---

## 5. Day 2 and Beyond

### 5.1 After your first PR

- Read `docs/EVENT_CONVENTIONS.md` end-to-end. Events are the nervous system of Eks-Food; you'll be adding or consuming events constantly.
- Read `docs/API_CONVENTIONS.md` end-to-end. You'll touch the HTTP surface soon.
- Read `docs/TESTING_GUIDE.md`. Your second PR should include an integration test, not just a unit test.

### 5.2 Your first week

- Pair with your onboarding buddy on a small feature in your chosen context.
- Attend the weekly architecture review (Tuesdays).
- Read one post-mortem from `docs/postmortems/`. They're the fastest way to learn how the system breaks.

### 5.3 Your first month

- Pick up an on-call shadow shift. You'll sit with the primary on-call for a day and watch them handle alerts.
- Contribute to an ADR (`docs/adr/`). The staff engineer will help you scope it.
- Ship a feature end-to-end: schema migration → domain logic → application use case → route handler → React component → test → docs.

### 5.4 Your first quarter

- Be primary on-call for a week (with secondary backing you up).
- Own a bounded context's roadmap for a sprint.
- Write a runbook for an alert that doesn't have one yet.

---

## 6. Getting Unstuck

| You're stuck on... | Try... |
|---|---|
| Prisma query returns the wrong shape | Check `schema.prisma` relations; use `include`/`select` explicitly; never `findMany` without a `where`. |
| A test is flaky | Check for time-dependence (use `FixedClock`), shared state (reset in `afterEach`), or async ordering (`await` everything). See `TESTING_GUIDE.md` §13. |
| A route handler returns 500 with no useful log | Add `console.error` in the catch (temporarily), or check Loki for the `requestId`. The structured logs are usually enough. |
| A PR is stuck in review | Ping the reviewer in `#eks-eng` after 24h. If still stuck, escalate to the staff engineer. |
| You don't know which context owns a piece of data | Check `ARCHITECTURE.md` §2 table. If still unclear, ask in `#eks-eng`. |
| You're not sure if a change is breaking | It's breaking if it removes/renames a field, changes a type, or changes a status code. See `API_CONVENTIONS.md` §1.2. |
| The dev server is doing something weird | Stop it (`Ctrl+C`), delete `.next/`, run `bun run dev` again. Cures 80% of ailments. |
| `bun install` is broken | Delete `node_modules` and `bun.lock`, run `bun install` fresh. If that fails, ping `#eks-onboarding`. |

---

## 7. House Style Summary

- **TypeScript strict.** No `any`. Explicit return types on public API. `import type` for types.
- **Names.** `kebab-case.ts` files, `PascalCase` types, no `I` prefix, `Repository`/`Service`/`*er` suffixes, `is`/`has`/`should` boolean prefixes.
- **Errors.** `Result<T,E>` from domain + application. Throw only for infrastructure failures. RFC 7807 problem+json at the boundary.
- **Layers.** No Prisma in route handlers. No DB in domain. No HTTP in application.
- **Events.** `{Aggregate}.{PastTenseVerb}`. Outbox-transactional. Consumers idempotent on `eventId`.
- **API.** `/api/v1/*`, kebab-case URLs, camelCase JSON, problem+json errors, `Idempotency-Key` for writes.
- **Tests.** Co-located `*.spec.ts`. Vitest. ≥80% statements. Mock at the seams, not in the middle.
- **Commits.** Conventional Commits. Squash-merge. Trunk-based.

---

## 8. Welcome

Eks-Food is building the operating system for food services across emerging markets. The work matters — every booking is a cook's livelihood, every meal is a family's memory. Write code you'd be proud to explain to the cook who depends on it.

See you in `#eks-eng`. 🍳
