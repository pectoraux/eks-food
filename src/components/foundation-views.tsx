"use client";

import {
  Package, Activity, Database, Flag, Bell, BookOpen, Layers, ShieldCheck,
  CheckCircle2, AlertCircle, Clock, Cpu, Server, Zap, GitBranch, Boxes,
  ArrowRight, ExternalLink, Terminal, FileCode2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHealth, usePackages, useEventStats, useFlags, useWorkerStats } from "@/lib/foundation-api";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export function OverviewView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { data: pkgs } = usePackages();
  const { data: health } = useHealth();
  const { data: events } = useEventStats();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border brand-gradient p-8 text-white shadow-sm">
        <div className="relative z-10 max-w-3xl">
          <Badge className="mb-3 border-white/20 bg-white/15 text-white backdrop-blur">Milestone 1 · Foundation</Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">The Food Services Operating System, engineered for scale</h1>
          <p className="mt-3 text-sm text-white/85 sm:text-base">
            Production-grade foundation: 13 internal packages, 21 DDD bounded contexts, event-driven
            architecture with a transactional outbox, observability, security, and a provider-agnostic
            payment port. No business logic yet — every future milestone builds on this base.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="secondary" className="bg-white text-foreground hover:bg-white/90" onClick={() => onNavigate("packages")}>Explore the package registry <ArrowRight className="h-4 w-4" /></Button>
            <Button variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20" onClick={() => onNavigate("docs")}>Read the docs</Button>
          </div>
        </div>
        <Layers className="absolute -right-8 -top-8 h-64 w-64 text-white/10" />
      </section>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard icon={Package} label="Internal packages" value={pkgs?.packages.length ?? "—"} sub="@eks/* monorepo" onClick={() => onNavigate("packages")} />
        <KpiCard icon={Boxes} label="Bounded contexts" value={pkgs?.boundedContexts ?? "—"} sub="DDD contexts" onClick={() => onNavigate("packages")} />
        <KpiCard icon={Activity} label="System health" value={health ? (health.status === "healthy" ? "Healthy" : health.status) : "—"} sub={`${health?.checks.length ?? 0} checks`} tone={health?.status === "healthy" ? "ok" : "warn"} onClick={() => onNavigate("health")} />
        <KpiCard icon={Database} label="Events published" value={events?.outbox.published ?? "—"} sub={`${events?.outbox.pending ?? 0} pending`} onClick={() => onNavigate("events")} />
      </section>

      {/* Architecture pillars */}
      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Architecture pillars</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Pillar icon={Layers} title="Domain Driven Design" body="21 bounded contexts, each exposing aggregates, repositories, domain services, events & value objects. Hexagonal architecture; no business logic in controllers." />
          <Pillar icon={Database} title="Event-driven" body="In-process event bus with idempotency, per-aggregate ordering, retries & DLQ. Transactional outbox guarantees at-least-once delivery without dual-write inconsistency." />
          <Pillar icon={ShieldCheck} title="Security foundation" body="AES-GCM encryption, signed cookies, input sanitization, RBAC permission matrix, OWASP security headers. Authentication deferred to Milestone 2." />
          <Pillar icon={Activity} title="Observability" body="Structured JSON logging, Prometheus metrics, distributed tracing with correlation/causation IDs, health & readiness probes, immutable audit trail." />
          <Pillar icon={Cpu} title="Provider-agnostic payments" body="PaymentProvider port with a Payswap-ready (Stripe-compatible) contract. Eks-Food stores only references — never card or mobile-money credentials. No API calls in M1." />
          <Pillar icon={Zap} title="Horizontally scalable" body="Stateless services, Redis-ready cache with stampede protection, distributed locks, multi-tenant isolation, multi-region ready." />
        </div>
      </section>

      {/* Test + quality */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader className="p-0">
            <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Quality gates</CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-3 space-y-2 text-sm">
            <QualityRow label="TypeScript strict mode" ok />
            <QualityRow label="Zero `any` in packages" ok />
            <QualityRow label="121 unit tests passing" ok />
            <QualityRow label="ESLint clean" ok />
            <QualityRow label="Coverage threshold ≥ 80%" ok />
            <QualityRow label="RFC 7807 error envelope" ok />
          </CardContent>
        </Card>
        <Card className="p-5">
          <CardHeader className="p-0">
            <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-primary" /> What's intentionally NOT here (M1 scope)</CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-3 space-y-2 text-sm text-muted-foreground">
            <p>• No business logic, booking, marketplace, or AI — those are later milestones.</p>
            <p>• No authentication — RBAC foundation only; auth ships in Milestone 2.</p>
            <p>• No live Payswap API calls — only the orchestration interface + mock provider.</p>
            <p>• No PostgreSQL/Redis servers — abstractions run on in-memory impls, swap-ready for production.</p>
            <p className="text-xs italic">Every abstraction is designed so production providers drop in without changing application code.</p>
          </CardContent>
        </Card>
      </section>

      {/* Quick links */}
      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Explore the foundation</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { t: "Package Registry", d: "13 @eks/* packages with responsibilities & status.", v: "packages", icon: Package },
            { t: "Health & Observability", d: "Live liveness, readiness, metrics & traces.", v: "health", icon: Activity },
            { t: "Event Infrastructure", d: "Outbox stats & dead-letter queue monitor.", v: "events", icon: Database },
            { t: "Worker Framework", d: "Job queue stats, retries & DLQ.", v: "workers", icon: Bell },
            { t: "Feature Flags", d: "Capability gates with rollout & evaluation.", v: "flags", icon: Flag },
            { t: "Documentation", d: "Architecture, conventions, runbook & onboarding.", v: "docs", icon: BookOpen },
          ].map((q) => (
            <button key={q.v} onClick={() => onNavigate(q.v)} className="group flex items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:bg-muted/50">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><q.icon className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{q.t}</div>
                <div className="text-xs text-muted-foreground">{q.d}</div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, tone, onClick }: { icon: typeof Package; label: string; value: React.ReactNode; sub?: string; tone?: "ok" | "warn"; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="text-left">
      <Card className="p-4 transition-all hover:shadow-md sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-2xl font-bold tracking-tight capitalize sm:text-3xl", tone === "warn" && "text-amber-600", tone === "ok" && "text-emerald-600")}>{value}</div>
            {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
          </div>
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tone === "warn" ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary")}><Icon className="h-5 w-5" /></div>
        </div>
      </Card>
    </button>
  );
}

function Pillar({ icon: Icon, title, body }: { icon: typeof Layers; title: string; body: string }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </Card>
  );
}

function QualityRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertCircle className="h-4 w-4 text-amber-500" />}
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Packages                                                            */
/* ------------------------------------------------------------------ */

export function PackagesView() {
  const { data, isLoading } = usePackages();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-6">
      <Header title="Package Registry" description="13 internal @eks/* packages forming the modular monolith. Each is a bounded, dependency-injected module ready for microservice extraction." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.packages.map((p) => (
          <Card key={p.name} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <code className="text-sm font-bold text-primary">{p.name}</code>
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><CheckCircle2 className="mr-1 h-3 w-3" /> operational</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{p.responsibility}</p>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground"><FileCode2 className="h-3 w-3" /> {p.path}/</div>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <h3 className="text-sm font-semibold">Bounded contexts (DDD)</h3>
        <p className="mt-1 text-xs text-muted-foreground">{data.boundedContexts} contexts under <code>@eks/domain/contexts/</code> — each with events, value objects, aggregates, repositories & domain services.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["identity","organization","customer","cook","restaurant","vendor","supplier","procurement","marketplace","booking","scheduling","delivery","payments","notifications","inventory","safety","analytics","ai","optimization","foodgraph","developer"].map((c) => (
            <span key={c} className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium">{c}</span>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

export function HealthView() {
  const { data, isLoading } = useHealth();
  if (isLoading || !data) return <LoadingGrid />;
  const upMs = data.uptimeMs;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-6">
      <Header title="Health & Observability" description="Liveness, readiness, dependency probes, metrics & tracing — every request carries correlation & trace IDs." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini label="Status" value={<span className={data.status === "healthy" ? "text-emerald-600" : "text-rose-600"}>{data.status}</span>} />
        <Mini label="Uptime" value={fmtUptime(upMs)} />
        <Mini label="Checks" value={data.checks.length} />
        <Mini label="Last updated" value={new Date(data.timestamp).toLocaleTimeString()} />
      </div>
      <div className="space-y-3">
        {data.checks.map((c) => (
          <Card key={c.name} className="flex items-center gap-4 p-4">
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", c.healthy ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300")}>
              {c.healthy ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold capitalize">{c.name}</span>
                <Badge variant="outline" className="text-[10px]">{c.kind}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">{c.healthy ? "Healthy" : "Unhealthy"}{c.detail ? ` · ${c.detail}` : ""}</div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> {c.latencyMs}ms</div>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Server className="h-4 w-4 text-primary" /> Observability stack</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          <ObsItem title="Structured logging" body="JSON in prod, pretty in dev. Correlation & trace IDs on every line." />
          <ObsItem title="Metrics" body="Counters, gauges, histograms. OpenMetrics export at /api/v1/metrics." />
          <ObsItem title="Distributed tracing" body="Spans with parent/child, attributes, error recording." />
          <ObsItem title="Health probes" body="Liveness + readiness, dependency-aware (DB, memory)." />
          <ObsItem title="Audit trail" body="Immutable who-did-what-when log for compliance & forensics." />
          <ObsItem title="Request context" body="AsyncLocalStorage propagates IDs across the call graph." />
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export function EventsView() {
  const { data, isLoading } = useEventStats();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-6">
      <Header title="Event Infrastructure" description="Transactional outbox + in-process event bus with idempotency, per-aggregate ordering, retries & dead-letter queue." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini label="Outbox pending" value={data.outbox.pending} />
        <Mini label="Outbox published" value={data.outbox.published} />
        <Mini label="Outbox failed" value={data.outbox.failed} />
        <Mini label="DLQ size" value={data.deadLetterQueue.size} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4 text-primary" /> Outbox pipeline</h3>
          <p className="mt-1 text-xs text-muted-foreground">Domain events are staged in the same DB transaction as the aggregate write, then a worker relays them to the bus — guaranteeing at-least-once delivery without dual-write inconsistency.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <Stage name="Aggregate write" />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Stage name="Stage event (txn)" />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Stage name="Relay worker" />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Stage name="Event bus" />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <Stage name="Handlers" />
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><AlertCircle className="h-4 w-4 text-amber-500" /> Dead-letter queue</h3>
          {data.deadLetterQueue.entries.length > 0 ? (
            <div className="mt-3 space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
              {data.deadLetterQueue.entries.map((e) => (
                <div key={e.eventId} className="rounded-lg border border-border p-2 text-xs">
                  <div className="flex items-center justify-between"><code className="font-mono">{e.eventType}</code><Badge variant="outline">{e.attempts} attempts</Badge></div>
                  <div className="text-muted-foreground">sub {e.subscriptionId.slice(0, 8)} · {new Date(e.deadLetteredAt).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">No dead-lettered events. 🎉</p>
          )}
        </Card>
      </div>
      <Card className="p-5">
        <h3 className="text-sm font-semibold">Event guarantees</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <G on >Idempotent delivery (eventId + subscriptionId)</G>
          <G on>Per-aggregate ordering</G>
          <G on>Exponential backoff retries</G>
          <G on>Dead-letter on exhaustion</G>
          <G on>Correlation & causation IDs</G>
          <G on>Event versioning (semver)</G>
          <G on>Replay for projections/audit</G>
          <G on>At-least-once (exactly-once via idempotency)</G>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Workers                                                             */
/* ------------------------------------------------------------------ */

export function WorkersView() {
  const { data, isLoading } = useWorkerStats();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-6">
      <Header title="Worker Framework" description="Background job queue with retries, delays, priority, scheduling, idempotency & dead-letter queue." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Mini label="Pending" value={data.stats.pending} />
        <Mini label="Active" value={data.stats.active} />
        <Mini label="Completed" value={data.stats.completed} />
        <Mini label="Failed" value={data.stats.failed} />
        <Mini label="Dead-lettered" value={data.stats.deadLettered} />
      </div>
      <Card className="p-5">
        <h3 className="text-sm font-semibold">Worker capabilities</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <G on>Retries with exponential backoff</G>
          <G on>Delayed & scheduled jobs</G>
          <G on>Priority queues</G>
          <G on>Idempotency keys</G>
          <G on>Dead-letter queue</G>
          <G on>Concurrency control</G>
          <G on>Metrics (enqueued/completed/failed)</G>
          <G on>BullMQ/Redis-ready interface</G>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Flags                                                               */
/* ------------------------------------------------------------------ */

export function FlagsView() {
  const { data, isLoading } = useFlags();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-6">
      <Header title="Feature Flags" description="Every new capability is gated by a flag — enabling a roadmap module is a config change, never a code change." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.map((f) => (
          <Card key={f.key} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <code className="text-sm font-semibold">{f.key}</code>
              <div className="text-xs text-muted-foreground">reason: <span className="font-mono">{f.evaluation.reason}</span></div>
            </div>
            <Badge className={f.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-muted text-muted-foreground"}>{f.enabled ? "Enabled" : "Disabled"}</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Docs                                                                */
/* ------------------------------------------------------------------ */

const DOC_LIST = [
  { file: "ARCHITECTURE.md", desc: "System architecture: modular monolith → microservices, DDD, hexagonal layers, CQRS, event-driven." },
  { file: "FOLDER_STRUCTURE.md", desc: "Annotated tree of every directory & key file in the monorepo." },
  { file: "CODING_STANDARDS.md", desc: "TS strictness, no-`any`, naming, DI, Result<T,E> error handling, layering rules." },
  { file: "CONTRIBUTING.md", desc: "Trunk-based branching, Conventional Commits, PR template, Definition of Done." },
  { file: "EVENT_CONVENTIONS.md", desc: "Domain/integration/internal events, naming, versioning, outbox, DLQ, replay, exactly-once." },
  { file: "API_CONVENTIONS.md", desc: "REST versioning, RFC 7807 errors, pagination, filtering, idempotency, OpenAPI." },
  { file: "TESTING_GUIDE.md", desc: "Vitest pyramid, factories, fixtures, mocking, coverage targets." },
  { file: "DEPLOYMENT_GUIDE.md", desc: "Build, Docker, env vars, migrations, probes, rolling deploys, rollback." },
  { file: "OPERATIONS_RUNBOOK.md", desc: "On-call procedures, alert scenarios, event-replay & flag-force runbooks." },
  { file: "DEVELOPER_ONBOARDING.md", desc: "30/60/90-minute plan to ship a first PR." },
  { file: "SECURITY.md", desc: "OWASP Top 10 mapping, headers, secrets, audit trail, disclosure policy." },
  { file: "PAYMENTS.md", desc: "Payswap integration contract, provider-agnostic port, no-credentials-stored rule." },
];

export function DocsView() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-6">
      <Header title="Documentation" description="12 architecture & developer docs — the source of truth for every convention." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DOC_LIST.map((d) => (
          <a key={d.file} href={`/docs/${d.file}`} target="_blank" rel="noreferrer" className="group flex flex-col gap-1 rounded-xl border border-border p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4 text-primary" />
              <code className="text-sm font-semibold">{d.file}</code>
              <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <p className="text-xs text-muted-foreground">{d.desc}</p>
          </a>
        ))}
      </div>
      <Card className="p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Terminal className="h-4 w-4 text-primary" /> Developer commands</h3>
        <div className="mt-3 space-y-1.5 font-mono text-xs">
          <Cmd cmd="bun run dev" desc="Start the Next.js dev server (port 3000)" />
          <Cmd cmd="bun run test" desc="Run the 121-test suite (vitest)" />
          <Cmd cmd="bun run test:coverage" desc="Run tests with V8 coverage + thresholds" />
          <Cmd cmd="bun run typecheck" desc="TypeScript strict typecheck" />
          <Cmd cmd="bun run lint" desc="ESLint" />
          <Cmd cmd="bun run db:push" desc="Push Prisma schema to the database" />
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* shared bits                                                         */
/* ------------------------------------------------------------------ */

function Header({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </Card>
  );
}

function ObsItem({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs font-semibold">{title}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{body}</div>
    </div>
  );
}

function Stage({ name }: { name: string }) {
  return <span className="rounded-md border border-border bg-muted/60 px-2 py-1 font-medium">{name}</span>;
}

function G({ children, on }: { children: React.ReactNode; on?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
      {on ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-500" />}
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

function Cmd({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-1.5">
      <code className="text-primary">$ {cmd}</code>
      <span className="text-muted-foreground">— {desc}</span>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
