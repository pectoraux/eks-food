# Eks-Food — Contributing Guide

> **Audience:** Anyone contributing code, docs, or issues to Eks-Food. Read this before opening your first PR. Read alongside `CODING_STANDARDS.md` (how to write the code) and `TESTING_GUIDE.md` (how to prove it works).

---

## 1. Branch Model — Trunk-Based Development

Eks-Food uses **trunk-based development**. There is one long-lived branch: `main`. Everything else is short-lived.

### 1.1 The rules

- `main` is **always deployable**. Never merge code that fails CI, breaks tests, or leaves the app in a non-runnable state.
- Branch from `main`, target `main`. Branch lifetime target: **≤ 2 days**, hard limit **≤ 7 days**.
- Branches are named `<type>/<short-scope>-<ticket>`:
  - `feat/booking-cancellation-EKS-412`
  - `fix/payswap-refund-status-EKS-518`
  - `docs/event-conventions-EKS-15`
  - `chore/bump-prisma-6.11-EKS-600`
- Force-push to your own feature branch is allowed (to keep history clean). **Never** force-push to `main`.
- Merge by **squash merge**. The squash commit message becomes the canonical history entry (see §3).

### 1.2 Why trunk-based, not Git Flow

- Eks-Food ships continuously. Long-lived release branches create merge hell and delay value.
- Small, frequent merges keep blast radius small and rollback cheap.
- Feature flags (per-tenant `FeatureFlag` rows) decouple *deploy* from *release*. A feature can be merged to `main`, deployed, and kept dark until ready (see `OPERATIONS_RUNBOOK.md` § Force a Feature Flag).

### 1.3 Release branches

- We cut `release/<yyyy.mm.dd>` branches only for hotfix support of an already-shipped version. They are rare. Most fixes go to `main` and roll forward.
- Hotfixes: cherry-pick from `main` to the relevant `release/*` branch, then deploy the release branch. Open a backport PR so `main` and `release/*` stay in sync.

---

## 2. Commit Message Convention — Conventional Commits

Every commit (and the squash-merge commit on `main`) follows [Conventional Commits](https://www.conventionalcommits.org/).

### 2.1 Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

- `type` — one of: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- `scope` — the bounded context or package, lowercase, no `@eks/` prefix: `bookings`, `payments`, `auth`, `catalog`, `events`, `http`, `ui`, `infra`, `docs`.
- `subject` — imperative mood, lowercase, no trailing period, ≤72 chars: "add cancellation flow", not "added cancellation flow".
- `body` — wrapped at 100 chars; explain *what changed and why*, not *how* (the diff already shows how).
- `footer` — breaking changes (`BREAKING CHANGE: <description>`) and issue references (`Closes EKS-412`, `Refs EKS-518`).

### 2.2 Examples

```
feat(bookings): add cancellation flow with refund window

Customers may cancel a CONFIRMED booking within 60 minutes for a full
refund; after that, a 30% hold applies. Refund is issued via the
Payswap `refund()` port and the booking transitions to CANCELLED.

Closes EKS-412
```

```
fix(payswap): treat 409 from provider as idempotent replay

Payswap returns 409 Conflict when an idempotency key is reused with a
different payload. We now treat 409 as a replay and return the
original PaymentIntent, matching Stripe semantics.

Refs EKS-518
```

```
refactor(events)!: move outbox to per-tenant streams

BREAKING CHANGE: outbox consumers must be redeployed with the new
stream-name env var (EKS_EVENT_STREAM_PATTERN) before this commit
deploys. See docs/EVENT_CONVENTIONS.md § 4.3.
```

### 2.3 Squash-merge policy

When a PR is merged, GitHub squashes all branch commits into one. The squash message is the PR title (which must itself be a Conventional Commit). Edit the squash message body to summarise the PR's *net* change, not the iteration history.

---

## 3. Pull Request Checklist

Before requesting review, the PR author confirms every box. Reviewers reject PRs that skip boxes.

### 3.1 Pre-flight (run locally)

- [ ] `bun run lint` passes with 0 errors, 0 warnings.
- [ ] `bun run typecheck` (or `tsc --noEmit`) passes.
- [ ] `bun run test` passes.
- [ ] `bun run test:coverage` ≥ 80% statements, ≥ 70% branches (for the files you touched).
- [ ] `bun run build` succeeds (catches Next.js + standalone issues).

### 3.2 PR description template

```markdown
## What
One-paragraph summary of the change.

## Why
The business or technical reason. Link the ticket (EKS-###).

## How
Key design decisions. Call out anything a reviewer should pay attention to.

## Risk
What could go wrong. What's the rollback path. What's feature-flagged.

## Verification
- [ ] Unit tests added/updated
- [ ] Integration test added (if API or DB change)
- [ ] Manually verified in dev: <steps or screenshot>
- [ ] Docs updated (ARCHITECTURE / API_CONVENTIONS / EVENT_CONVENTIONS / etc.)

## Checklist
- [ ] No `any`, no unexplained `@ts-ignore`
- [ ] No Prisma in route handlers; no DB in domain
- [ ] Public functions have explicit return types + TSDoc
- [ ] Names follow CODING_STANDARDS §2
- [ ] Files under size limits
- [ ] New env vars documented in DEPLOYMENT_GUIDE §env
- [ ] New events documented in EVENT_CONVENTIONS (if applicable)
- [ ] New API endpoints documented in API_CONVENTIONS (if applicable)
- [ ] Migration is reversible (if schema change)
```

### 3.3 Reviewer checklist (in addition to author's)

- [ ] Tests prove the change works, not just that it compiles.
- [ ] Error paths are tested, not just happy paths.
- [ ] No secrets in code, env files, or example payloads.
- [ ] No PII in logs or audit `metadata`.
- [ ] Boundary checks: domain has no I/O; application has no HTTP; interface has no Prisma.
- [ ] If a feature flag was added, it defaults to OFF and the rollout plan is in the PR description.
- [ ] If a schema migration was added, the `up` and `down` are both present and tested locally.

---

## 4. Code Review Expectations

### 4.1 SLA

| Role | First response | Subsequent responses |
|---|---|---|
| Reviewer | ≤ 4 business hours (small PR), ≤ 1 business day (large) | ≤ 2 business hours |
| Author (after review) | ≤ 1 business day | ≤ 2 business hours |

If a PR has been open ≥ 3 business days without movement, ping in `#eks-eng`. If still stuck after 5 days, escalate to the staff engineer on call.

### 4.2 Reviewer conduct

- **Review the code, not the coder.** Critique is specific, technical, and kind.
- **Distinguish must-fix from nit from suggestion.** Prefix comments:
  - `must:` — blocks merge. Explain why.
  - `nit:` — style preference; author may decline.
  - `suggestion:` — alternative approach; author decides.
  - `question:` — seeking understanding; not blocking.
- **Approve with comments.** It's fine to approve and leave nits — make the nits clearly optional.
- **Don't block on bike-shedding.** If it's a matter of taste and the code is correct, ship it.

### 4.3 Author conduct

- **Respond to every comment.** Either fix it, push back with reasoning, or mark as "won't fix" with a justification.
- **Don't take `must:` personally.** They're about the code.
- **Push back if a reviewer is wrong.** "I disagree because X. Happy to pair on it."
- **Keep PRs small.** ≤ 400 lines diff is ideal; > 1000 lines requires explicit justification in the PR description and a staff-engineer sign-off.

### 4.4 Two-reviewer rule

- PRs touching `prisma/schema.prisma`, `src/lib/payswap.ts`, `src/lib/auth.ts`, or anything under `infra/` require **two** approvals, one of which must be from a staff engineer or the on-call SRE.
- PRs touching `docs/` require **one** approval from a docs owner.
- All other PRs require **one** approval from a code owner (per `CODEOWNERS`, target M2).

---

## 5. Definition of Done

A ticket is "done" when **all** of the following are true:

### 5.1 Code

- [ ] Merged to `main` via squash merge with a Conventional Commit message.
- [ ] CI pipeline green on `main` post-merge.
- [ ] Feature flag (if any) configured in the target tenant(s) with an explicit rollout plan.
- [ ] No new `TODO` without an owner and ticket link.

### 5.2 Tests

- [ ] Unit tests for new domain/application logic.
- [ ] Integration tests for new API endpoints or event flows.
- [ ] Coverage targets met (≥80% statements on touched files).
- [ ] Tests run in CI in ≤ 5 minutes (no slow-test creep).

### 5.3 Docs

- [ ] Public API changes → `API_CONVENTIONS.md` updated.
- [ ] New events → `EVENT_CONVENTIONS.md` updated with name, schema, consumers.
- [ ] Schema changes → `prisma/schema.prisma` comment block updated; migration SQL committed.
- [ ] New env vars → `DEPLOYMENT_GUIDE.md` env table updated.
- [ ] New `@eks/*` package or major refactor → `ARCHITECTURE.md` §6 and `FOLDER_STRUCTURE.md` §2.2 updated.
- [ ] Operational changes → `OPERATIONS_RUNBOOK.md` updated.

### 5.4 Operability

- [ ] New logs/metrics use the correlation ID; no PII.
- [ ] New alerts (if any) documented in `OPERATIONS_RUNBOOK.md` with diagnosis + mitigation.
- [ ] Rollback plan identified (revert commit, feature flag off, or migration down).
- [ ] On-call team notified in `#eks-eng` if the change touches payments, auth, or events.

### 5.5 Customer-facing

- [ ] If user-visible, the change is behind a feature flag and dark-launched to one tenant first.
- [ ] Release notes drafted (for the next platform release).

A ticket is **not** done when the code is merged. It is done when it is operable in production and the team has confirmed it.

---

## 6. Issue & Ticket Hygiene

- Every PR links to a ticket (`Closes EKS-###`). No "drive-by" PRs without a ticket — open one first.
- Tickets describe the *problem* and the *acceptance criteria*, not the implementation.
- Bugs include: reproduction steps, expected vs actual, tenant, region, correlation ID, screenshot/log.
- Feature requests include: user story, success metric, tenant(s) affected, non-goals.

---

## 7. Handling Secrets

- **Never** commit secrets. `.env*` is gitignored.
- **Never** paste real Payswap keys, DB passwords, or JWT secrets into PR descriptions, comments, or example payloads.
- Use `EKS_*_DEV` placeholder values in examples: `EKS_PAYSWAP_SECRET_KEY=sk_test_payswap_xxx`.
- If a secret is accidentally committed: rotate it immediately, then `git filter-repo` to scrub history. Notify security@ in `SECURITY.md`.

---

## 8. Force-Push & Rewriting History

- Force-push to your own feature branch: **allowed** (keeps PRs reviewable).
- Force-push to `main`, `release/*`, or someone else's branch: **never**.
- If you force-push after review, **notify reviewers** in the PR thread: "Rebased on latest main; please re-review."

---

## 9. Conflict Resolution

When the author and reviewer can't agree:

1. Pair for 15 minutes. Most disagreements dissolve in a screen-share.
2. If still stuck, ping a third engineer (preferably a code owner of the touched file).
3. If still stuck, escalate to the staff engineer on call. Their call is final for the PR; further debate goes in a follow-up ADR (`docs/adr/`).

Decisions are documented. If a review thread produces a new convention, it goes into `CODING_STANDARDS.md` or a new ADR within one week.

---

## 10. Onboarding a New Contributor

If it's your first PR:

1. Read `DEVELOPER_ONBOARDING.md` (30/60/90 plan).
2. Read `ARCHITECTURE.md` and `CODING_STANDARDS.md`.
3. Pick a `good first issue` label or ask in `#eks-eng` for a starter.
4. Open a draft PR early — even with failing tests — so reviewers can course-correct before you sink days into a wrong approach.
5. Ask questions. Trunk-based only works with psychological safety; nobody is expected to know everything on day one.
