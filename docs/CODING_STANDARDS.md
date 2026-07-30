# Eks-Food — Coding Standards

> **Audience:** Every engineer writing TypeScript in this repo. Read once before your first PR; reference forever after.
>
> **Enforcement:** These rules are enforced by `eslint.config.mjs`, `tsc --noEmit`, PR review, and CI gates. "Should" rules are review-enforced; "MUST" rules are tool-enforced.

---

## 1. TypeScript Strictness

### 1.1 Compiler configuration

`tsconfig.json` sets:

- `strict: true` — enables `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`.
- `noEmit: true` — type-checking only; Next.js + Bun handle emission.
- `isolatedModules: true` — every file must be independently transpilable (forces explicit type-only imports).
- `moduleResolution: "bundler"` — modern resolution matching Next.js + Bun.
- `target: "ES2017"` — supported by both Bun and Node 20.

> **Known M1 deviation:** `noImplicitAny: false` is set in the sandbox `tsconfig.json` to keep early prototypes compiling. **M2 will flip this to `true`.** New code MUST be written as if it were already on; reviewers will reject implicit `any`.

### 1.2 The `any` rule

- **MUST NOT** use `any` in new code. Not as a type annotation, not as a generic argument, not in a cast.
- **MUST NOT** use `// @ts-ignore` or `// @ts-expect-error` without an inline justification comment on the same line: `// @ts-expect-error — Prisma types lag the schema; see ticket EKS-1234`.
- **SHOULD** use `unknown` when the shape is genuinely unknown, then narrow with a Zod schema or a type guard.
- **MAY** use `Record<string, unknown>` for opaque JSON blobs (e.g. `AuditLog.metadata`).

**Allowed escape hatches (still prefer narrower types):**
- `unknown` for unvalidated external input.
- `never` for exhaustiveness checks in `switch` over a union.
- `Record<string, unknown>` for opaquely-typed JSON columns.

### 1.3 Explicit return types on public API

- **MUST** annotate the return type of every exported function, every route handler, every React component, and every method on a class.
- **MAY** omit return types on private, non-exported helpers where the inference is obvious and stable.

```ts
// ✅ Good
export function matchCooks(req: MatchRequest): Promise<MatchedCook[]> { ... }
export async function POST(req: NextRequest): Promise<NextResponse> { ... }

// ❌ Bad — relies on inference for a public API
export function matchCooks(req: MatchRequest) { ... }
```

### 1.4 Type-only imports

With `isolatedModules: true`, **MUST** use `import type` for type-only imports:

```ts
import type { NextRequest, NextResponse } from "next/server";  // ✅ types only
import { NextResponse } from "next/server";                    // ✅ value used
import { NextResponse, type NextRequest } from "next/server";  // ✅ mixed
```

---

## 2. Naming Conventions

### 2.1 Files

| Kind | Convention | Example |
|---|---|---|
| Module file (TS) | `kebab-case.ts` | `booking-repository.ts` |
| React component file | `PascalCase.tsx` | `CheckoutDialog.tsx`, `CookCard.tsx` |
| Route handler | `route.ts` (Next.js convention) | `src/app/api/v1/bookings/route.ts` |
| Test file | `*.spec.ts` / `*.spec.tsx` (co-located) or `__tests__/<name>.spec.ts` | `booking.spec.ts` |
| Fixture file | `*.fixture.ts` | `cooks.fixture.ts` |
| Factory file | `*.factory.ts` | `booking.factory.ts` |
| Type definitions | co-located in the file that owns them, or `<name>.types.ts` for shared | `money.ts` exports `Money` |
| Barrel file | `index.ts` (only at package root) | `src/packages/bookings/src/index.ts` |

> **M1 deviation:** M1 uses `kebab-case.ts` for components (e.g. `cook-card.tsx`). M2 will rename to `PascalCase.tsx` to match shadcn/ui convention. New component files SHOULD use `PascalCase.tsx` from the start.

### 2.2 Types, Interfaces, and Classes

- **MUST NOT** prefix interfaces with `I`. Use descriptive nouns.
  - ❌ `interface IBookingRepository`
  - ✅ `interface BookingRepository`
- **MUST** suffix repository interfaces with `Repository`: `BookingRepository`, `CookRepository`.
- **MUST** suffix service classes with `Service`: `MatchingService`, `PricingService`, `FeatureFlagService`.
- **MUST** name pure orchestration classes by their verb in the `*er` form when no `Service` suffix fits naturally: `PayswapProvider` (not `PayswapService`), `OutboxPublisher`, `DemandAggregator`, `AuditWriter`.
- **MUST** suffix DTOs with the layer they cross: `BookingDTO` (over the wire), `BookingView` (read model), `BookingRow` (Prisma row). Domain entities have no suffix: `Booking`, `Cook`, `PaymentIntent`.
- **MUST** suffix error classes with `Error`: `AuthorizationError`, `PaymentFailedError`, `BookingNotFoundError`.
- **MUST** suffix Zod schemas with `Schema`: `CreateBookingSchema`, `PayswapWebhookSchema`.
- **MUST** suffix domain events with their past-tense verb, no `Event` suffix: `BookingCreated`, `PaymentSucceeded`, `CookApproved`. (The wire format uses dot-notation: `Booking.Created` — see `EVENT_CONVENTIONS.md`.)
- **MUST** name command/query handler classes after the command: `CreateBookingCommandHandler`, `GetBookingByCodeQueryHandler`.

### 2.3 Variables & functions

- `camelCase` for variables and functions: `quotedPrice`, `matchCooks`, `autoAssign`.
- `SCREAMING_SNAKE_CASE` for module-level constants: `EARTH_RADIUS_KM`, `DEFAULT_THRESHOLD`, `PERMISSIONS`.
- `PascalCase` for types, classes, enums/union const objects, and React components.
- **MUST** name booleans with a `is`/`has`/`should`/`can` prefix: `isAvailable`, `hasPermission`, `shouldAutoAssign`, `canRefund`.
- **MUST NOT** use single-letter variable names outside small scopes (`i`, `j`, `k` in tight loops; `e` in catch blocks). Use `error`, not `e`, when the catch body is non-trivial.

### 2.4 Constants and enums

- Prefer **union string literal types** (`type BookingStatus = "DRAFT" | "PENDING_MATCH" | ...`) over TS `enum`. They tree-shake better and serialise cleanly to JSON.
- For sets of values that need runtime iteration, use a `const` object + derived type:

```ts
export const BOOKING_STATUS = {
  DRAFT: "DRAFT",
  PENDING_MATCH: "PENDING_MATCH",
  ASSIGNED: "ASSIGNED",
  CONFIRMED: "CONFIRMED",
  // ...
} as const;
export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];
```

---

## 3. Dependency Injection via Interfaces

### 3.1 The pattern

- The **Application** layer defines **ports** — interfaces that describe what it needs from the outside world.
- The **Infrastructure** layer provides **adapters** — concrete implementations of those ports.
- The **Interface** layer (route handlers, React server components) **wires** adapters to ports at request scope (or module scope for singletons).

```ts
// @eks/bookings/src/application/ports/booking-repository.ts
export interface BookingRepository {
  findByCode(code: string): Promise<Booking | null>;
  findByOrganization(organizationId: string, filter: BookingFilter): Promise<Booking[]>;
  save(booking: Booking): Promise<void>;
}

// @eks/bookings/src/infrastructure/prisma-booking-repository.ts
export class PrismaBookingRepository implements BookingRepository {
  constructor(private readonly db: PrismaClient) {}
  async findByCode(code: string): Promise<Booking | null> { /* prisma query + map to domain */ }
  // ...
}

// @eks/bookings/src/application/commands/create-booking.ts
export class CreateBookingCommandHandler {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly cooks: CookRepository,
    private readonly payments: PaymentProvider,    // port from @eks/payments
    private readonly outbox: OutboxWriter,         // port from @eks/events
  ) {}
  async handle(cmd: CreateBookingCommand): Promise<Result<BookingCreated, BookingError>> { ... }
}
```

### 3.2 Composition root

- **MUST NOT** instantiate adapters inside application code. Adapters are constructed once in a composition root (`src/packages/<name>/src/composition.ts`) and passed in.
- **MUST NOT** use singleton state inside application code. If a service needs to be a singleton, the composition root decides that — not the service.

### 3.3 No `PrismaClient` in application or domain code

- **MUST NOT** import `@prisma/client` or `PrismaClient` from `@eks/*/src/domain/**` or `@eks/*/src/application/**`.
- Repositories (`@eks/*/src/infrastructure/**`) are the only place Prisma is imported.
- Repositories **MUST** map Prisma rows to domain entities at the boundary — never leak `Prisma.BookingGetPayload<...>` types upward.

---

## 4. Error Handling — `Result<T, E>`

### 4.1 The rule

- **MUST NOT** `throw` from domain or application code. Throw is reserved for **infrastructure** (network failure, DB connection lost) and for **programmer errors** (assertions, invariants that should be impossible).
- **MUST** return `Result<T, E>` from every public method in domain and application layers.

```ts
// @eks/shared-kernel/src/result.ts
export type Result<T, E = DomainError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> { return { ok: true, value }; }
export function err<E>(error: E): Result<never, E> { return { ok: false, error }; }
```

### 4.2 DomainError hierarchy

```ts
// @eks/shared-kernel/src/errors.ts
export abstract class DomainError {
  abstract readonly code: string;     // machine-readable, e.g. "booking.not_found"
  abstract readonly status: number;   // HTTP status for interface layer mapping
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export class NotFoundError extends DomainError { readonly status = 404; }
export class ValidationError extends DomainError { readonly status = 422; }
export class ConflictError extends DomainError { readonly status = 409; }
export class AuthorizationError extends DomainError { readonly status = 403; }
export class PaymentFailedError extends DomainError { readonly status = 402; }
```

### 4.3 Consuming Results

```ts
// Application layer
const result = await createBooking.handle(cmd);
if (!result.ok) {
  // Map DomainError → RFC 7807 problem+json at the interface boundary
  return problemJson(result.error);
}
return NextResponse.json(envelope(result.value), { status: 201 });
```

### 4.4 Where throwing is still allowed

- **Interface layer** may throw when parsing a malformed request that can't even reach the use case (e.g. invalid JSON body). The framework's error boundary converts these to `400 problem+json`.
- **Infrastructure layer** may throw on transient failures (DB connection lost, Payswap 5xx). The application layer wraps these in a `Result.err(InfrastructureError)`.
- **Assertion-style** `throw new Error("unreachable")` is allowed in `default` branches of exhaustive `switch` statements over a union — paired with a `never`-typed check.

### 4.5 No `try/catch` for control flow

- **MUST NOT** use `try/catch` to handle expected business outcomes. Use `Result` instead.
- **MAY** use `try/catch` around infrastructure calls, immediately wrapping the caught error in `Result.err(...)`.

---

## 5. Layering Rules

| Rule | Enforcement |
|---|---|
| **No Prisma in Interface layer.** Route handlers (`src/app/api/**/route.ts`) MUST NOT import `@/lib/db` or `@prisma/client`. | ESLint `no-restricted-imports` rule (planned). |
| **No DB in Domain layer.** Domain aggregates MUST NOT import Prisma, fetch, fs, Redis. | ESLint `no-restricted-imports` rule (planned). |
| **No HTTP in Application layer.** Use cases MUST NOT import `next/server`. They return `Result`; the interface layer maps to HTTP. | Review + `no-restricted-imports`. |
| **No React in Application or Domain layers.** | Review. |
| **No cross-context Prisma.** A repository in `@eks/bookings` MUST NOT query `db.cook` directly — it goes through the `CookRepository` port defined in `@eks/cooks`'s application layer. | Review. |
| **Domain entities are created via factories, not `new`.** This protects invariants. | Review; factories live in `domain/<entity>.ts`. |
| **Aggregates are loaded whole, modified, saved whole.** No partial updates. | Review. |

### 5.1 Worked example: confirming a booking

```ts
// ❌ WRONG — Prisma in route handler, throws, no Result
export async function POST(req: NextRequest) {
  const body = await req.json();
  const booking = await db.booking.update({
    where: { code: body.code },
    data: { status: "CONFIRMED" },
  });
  await db.auditLog.create({ ... });
  return NextResponse.json(booking);
}

// ✅ RIGHT — route handler is thin, delegates to application, maps Result
export async function POST(req: NextRequest): Promise<NextResponse> {
  const principal = resolvePrincipal(req.headers);
  const parsed = ConfirmBookingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problemJson(new ValidationError("invalid_body", parsed.error.issues));

  const result = await confirmBooking.handle({
    principal,
    code: parsed.data.code,
    payswapId: parsed.data.payswapId,
  });
  if (!result.ok) return problemJson(result.error);
  return NextResponse.json(envelope(result.value), { status: 200 });
}
```

---

## 6. JSDoc Requirements

### 6.1 What MUST be documented

- Every exported function, class, interface, type alias, and constant.
- Every `@eks/*` package's `index.ts` public surface.
- Every Zod schema — what shape it validates and where it's used.
- Every domain event — its meaning, when it's emitted, and who consumes it.

### 6.2 Format

Use TSDoc with `@param`, `@returns`, `@throws` (only for infrastructure), `@see`, `@example`. The first sentence is the summary; it appears in IDE hover and generated API docs.

```ts
/**
 * Score candidate cooks for a booking request across seven dimensions:
 * distance, rating, availability, cuisine fit, price, language, and past
 * customer preference. Returns a ranked list with a per-dimension breakdown
 * so dispatch decisions are explainable and auditable.
 *
 * @param req - Match request scoped to the tenant derived from `req.organizationId`.
 * @returns Ranked candidates, highest score first. Empty array when no approved
 *          cooks are available in the tenant.
 * @see autoAssign — applies the threshold and persists the assignment.
 * @example
 * const candidates = await matchCooks({
 *   organizationId: "cm...",
 *   lat: 5.6037, lng: -0.1870,
 *   cuisines: ["ghanaian"],
 * });
 */
export async function matchCooks(req: MatchRequest): Promise<MatchedCook[]> { ... }
```

### 6.3 What SHOULD NOT be documented

- Trivial getters/setters.
- Private helpers whose name + signature are self-explanatory.
- React component props when the props interface is fully TSDoc'd.

---

## 7. Import Ordering

Imports are grouped and sorted within each group. Enforced by `eslint-plugin-simple-import-sort`.

```ts
// 1. Node.js built-ins
import { readFile } from "node:fs/promises";

// 2. External packages (alphabetical)
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

// 3. Internal @eks/* packages (alphabetical)
import type { BookingRepository } from "@eks/bookings";
import { authorize, resolvePrincipal } from "@eks/auth";
import { payswap } from "@eks/payments";

// 4. Absolute @/* aliases (alphabetical)
import { db } from "@/lib/db";
import { matchCooks } from "@/lib/matching";

// 5. Relative imports (alphabetical, grouped by depth)
import { BookingCard } from "./BookingCard";
import type { BookingView } from "./types";
```

**Rules:**
- One import per line (no `import { a, b } from "x"` collapsing across multiple sources).
- Type-only imports use `import type` or inline `type` modifier.
- No unused imports — `eslint-plugin-unused-imports` auto-removes them.
- No circular imports across `@eks/*` packages. Within a package, circular imports are allowed only between a domain aggregate and its events.

---

## 8. File-Size Guidance

| Kind | Soft | Hard | Action |
|---|---|---|---|
| Route handler (`route.ts`) | 80 lines | 150 lines | Move logic to application use case. |
| Application use case | 150 lines | 250 lines | Split command/query handlers; extract a domain service. |
| Domain aggregate | 200 lines | 350 lines | Extract value objects or a sub-entity. |
| React component | 150 lines | 300 lines | Extract child components. |
| Repository | 250 lines | 400 lines | Split read/write repos if a context uses CQRS. |
| Any other `.ts` file | 300 lines | 500 lines | Re-evaluate the abstraction. |

CI runs `scripts/check-file-size.ts` (planned); files over the hard limit fail the build.

---

## 9. Immutability & Equality

- **MUST** mark domain entity fields `readonly` where they shouldn't change after construction.
- **MUST** use `Readonly<T>` or `ReadonlyArray<T>` for DTOs and event payloads.
- **MUST** implement value-object equality by structural comparison, not reference identity. `Money.of(100, "GHS").equals(Money.of(100, "GHS"))` is `true`.
- **SHOULD** use `as const` for object literals that should be deeply readonly.

---

## 10. Comments & TODOs

- `// TODO(<owner>): <action> — see EKS-<n>` — owned, tracked. CI greps for TODOs without an owner and fails.
- `// FIXME:` — broken right now, must fix before merge. Rarely used; prefer TODO.
- `// HACK:` — temporary; must include a date and a TODO link.
- **MUST NOT** commit commented-out code. Delete it; git remembers.
- **MUST** explain *why*, not *what*, in inline comments. The code already says what.

---

## 11. React-Specific Rules

- **MUST** type every component props interface (no `React.FC` — use `function Component(props: Props)`).
- **MUST** colocate styles via Tailwind classes; no CSS modules. Brand tokens live in `src/app/globals.css`.
- **MUST** use TanStack Query for server state, Zustand for ephemeral UI state. Never store server state in Zustand.
- **MUST** use React Hook Form + Zod for any form with ≥3 fields.
- **SHOULD** prefer Server Components; mark `"use client"` only when interactivity is required.
- **MUST NOT** call Prisma from a client component. Use a route handler or a Server Action.

---

## 12. Testing Rules (cross-reference `TESTING_GUIDE.md`)

- Every public function in domain and application layers **MUST** have at least one unit test.
- Every Zod schema **MUST** have a "happy path" test and at least one "rejects invalid input" test.
- Every route handler **SHOULD** have one integration test that exercises the full request → response cycle with a test database.
- Test names use the `describe("unit", () => it("behaviour", ...))` pattern, written as sentences: `it("returns PENDING_MATCH when no cook clears the threshold", ...)`.

---

## 13. Quick Reference — Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| `Result<T, E>` from application | `throw new Error("not found")` from application |
| `interface BookingRepository` | `interface IBookingRepository` |
| `import type { NextRequest }` | `import { NextRequest }` (when type-only) |
| `function matchCooks(req: MatchRequest): Promise<MatchedCook[]>` | `function matchCooks(req)` |
| `BookingStatus = "DRAFT" \| "PENDING_MATCH" \| ...` | `enum BookingStatus { DRAFT, ... }` |
| Route handler calls a use case | Route handler calls `db.booking.findMany` |
| Repository maps Prisma row → domain entity | Repository returns `Prisma.BookingGetPayload` |
| TSDoc on every export | No docs, "the code is self-documenting" |
| `kebab-case.ts` for modules | `bookingRepository.ts`, `Booking-Repository.ts` |
| `as const` for static lookup tables | `const STATUS_DRAFT = "DRAFT"` (no union) |
| `isAvailable`, `hasPermission` | `available`, `permission` (booleans) |

---

## 14. Review Checklist (Reviewer's View)

When reviewing a PR, confirm:

- [ ] No `any`, no unexplained `@ts-ignore`.
- [ ] Public functions have explicit return types and TSDoc.
- [ ] Application code returns `Result`, doesn't throw for business outcomes.
- [ ] No Prisma in route handlers; no DB in domain.
- [ ] Names follow §2 (no `I` prefix, `Repository`/`Service`/`*er` suffixes, boolean prefixes).
- [ ] Imports follow §7 ordering.
- [ ] Files under §8 size limits.
- [ ] Tests added for new domain/application logic.
- [ ] No commented-out code; TODOs have owners.
