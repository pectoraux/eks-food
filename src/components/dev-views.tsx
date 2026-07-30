"use client";

import { useState } from "react";
import {
  Puzzle, Plug, GitBranch, Activity, ShieldCheck, Terminal, Ticket, ScrollText,
  RotateCcw, CheckCircle2, AlertCircle, Loader2, Package, Cpu, Zap, Clock,
  ArrowRight, Play, Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useDevExtensions, useDevConnectors, useDevWorkflows, useDevPublishers, useDevReplays, useSeedDeveloper, useValidateManifest, useRunCli } from "@/lib/dev-api";
import { toast } from "sonner";

/* ============ Dashboard ============ */
export function DashboardView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { data: exts } = useDevExtensions();
  const { data: conns } = useDevConnectors();
  const { data: wfs } = useDevWorkflows();
  const { data: pubs } = useDevPublishers();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-border brand-gradient p-8 text-white shadow-sm">
        <div className="relative z-10 max-w-3xl">
          <Badge className="mb-3 border-white/20 bg-white/15 text-white backdrop-blur">Milestone 3 · Developer Platform</Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Build extensions, connectors &amp; workflows on Eks-Food</h1>
          <p className="mt-3 text-sm text-white/85 sm:text-base">
            A production developer platform with a sandboxed extension runtime, connector SDK, workflow engine,
            registry with signed packages, event replay, and a full developer console. Thousands of extensions,
            safely isolated.
          </p>
        </div>
        <Puzzle className="absolute -right-8 -top-8 h-64 w-64 text-white/10" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi icon={Puzzle} label="Extensions" value={exts?.length ?? "—"} sub="In the registry" onClick={() => onNavigate("extensions")} />
        <Kpi icon={Plug} label="Connectors" value={conns?.length ?? "—"} sub="Connector SDK" onClick={() => onNavigate("connectors")} />
        <Kpi icon={GitBranch} label="Workflows" value={wfs?.length ?? "—"} sub="Active automations" onClick={() => onNavigate("workflows")} />
        <Kpi icon={Ticket} label="Publishers" value={pubs?.length ?? "—"} sub="Verified + pending" onClick={() => onNavigate("publishers")} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader className="p-0"><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Platform capabilities</CardTitle></CardHeader>
          <CardContent className="p-0 pt-3 space-y-1.5 text-sm">
            <Cap label="Sandboxed extension runtime (CPU/memory/timeout isolation)" />
            <Cap label="Connector SDK (retry, pagination, sync, circuit breakers)" />
            <Cap label="Workflow SDK (triggers, branches, compensation, parallel)" />
            <Cap label="Extension registry with signed packages (Ed25519)" />
            <Cap label="Manifest validation + compatibility checks" />
            <Cap label="Event replay (dry-run + execute)" />
            <Cap label="Developer CLI (create, validate, build, package, publish)" />
            <Cap label="Capability-based permissions (least privilege)" />
            <Cap label="Namespaced extension storage + secrets (encrypted)" />
            <Cap label="Runtime health monitoring + extension logs" />
          </CardContent>
        </Card>
        <Card className="p-5">
          <CardHeader className="p-0"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-primary" /> @eks/* packages</CardTitle></CardHeader>
          <CardContent className="p-0 pt-3 space-y-1.5 text-sm">
            <Pkg name="@eks/sdk" desc="Platform SDK (ExtensionContext)" />
            <Pkg name="@eks/connector-sdk" desc="Connector framework" />
            <Pkg name="@eks/runtime" desc="Extension runtime + sandbox" />
            <Pkg name="@eks/workflow" desc="Workflow engine" />
            <Pkg name="@eks/registry" desc="Registry + manifest + packaging" />
            <Pkg name="@eks/dev-cli" desc="Developer CLI" />
            <Pkg name="@eks/developer" desc="Domain events + audit actions" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { t: "Manifest Validator", d: "Upload & validate manifests.", v: "manifests", icon: ShieldCheck },
          { t: "Developer CLI", d: "Run CLI commands in-browser.", v: "cli", icon: Terminal },
          { t: "Event Replay", d: "Replay historical events.", v: "replay", icon: RotateCcw },
          { t: "Runtime Inspector", d: "CPU, memory, execution history.", v: "runtime", icon: Cpu },
        ].map((q) => (
          <button key={q.v} onClick={() => onNavigate(q.v)} className="group flex flex-col gap-2 rounded-xl border border-border p-4 text-left transition-colors hover:bg-muted/50">
            <q.icon className="h-5 w-5 text-primary" />
            <div className="text-sm font-semibold">{q.t}</div>
            <div className="text-xs text-muted-foreground">{q.d}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============ Extensions ============ */
export function ExtensionsView() {
  const { data, isLoading } = useDevExtensions();
  const [q, setQ] = useState("");
  if (isLoading || !data) return <LoadingGrid />;
  const filtered = q ? data.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()) || e.identifier.includes(q.toLowerCase())) : data;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Extension Explorer" description="Installed extensions, dependencies, capabilities, permissions." />
      <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search extensions…" className="pl-9" /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((e) => (
          <Card key={e.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-sm font-bold">{e.name}</div><code className="text-[10px] text-muted-foreground">{e.identifier}</code></div>
              <Badge className={e.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-muted text-muted-foreground"}>{e.status}</Badge>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{e.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {e.category && <Badge variant="secondary" className="text-[10px]">{e.category}</Badge>}
              <Badge variant="outline" className="text-[10px]">v{e.latestVersion?.version ?? "—"}</Badge>
              <Badge variant="outline" className="text-[10px]">{e._count.installations} installs</Badge>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">by {e.publisher.name} ({e.publisher.verificationStatus})</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Connectors ============ */
export function ConnectorsView() {
  const { data, isLoading } = useDevConnectors();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Connector Explorer" description="Inspect connector definitions, requests, retries, latency, sync history." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div><div className="text-sm font-bold">{c.name}</div><code className="text-[10px] text-muted-foreground">{c.code}</code></div>
              <Badge variant="outline" className="text-[10px]">{c._count.configurations} configs</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{c.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {c.supportsPolling && <Badge variant="secondary" className="text-[10px]">polling</Badge>}
              {c.supportsWebhooks && <Badge variant="secondary" className="text-[10px]">webhooks</Badge>}
              {c.defaultSyncIntervalSec > 0 && <Badge variant="outline" className="text-[10px]">every {c.defaultSyncIntervalSec}s</Badge>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Workflows ============ */
export function WorkflowsView() {
  const { data, isLoading } = useDevWorkflows();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Workflow Inspector" description="Execution history, retries, failures, timing, branches." />
      <div className="space-y-3">
        {data.map((w) => (
          <Card key={w.id} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div><div className="text-sm font-bold">{w.name}</div><div className="text-xs text-muted-foreground">{w.description}</div></div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">v{w.version}</Badge>
                <Badge className={w.active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-muted"}>{w.active ? "active" : "paused"}</Badge>
                <Badge variant="secondary" className="text-[10px]">{w._count.executions} runs</Badge>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Event Explorer ============ */
export function EventsView() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Event Explorer" description="Browse domain events, integration events, replay history." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4 text-primary" /> Developer Platform events</h3>
          <div className="mt-3 space-y-1.5 text-xs">
            {["ExtensionInstalled", "ExtensionActivated", "ExtensionSuspended", "ExtensionRemoved", "ExtensionUpgraded", "ExtensionRolledBack", "ConnectorExecuted", "ConnectorFailed", "WorkflowStarted", "WorkflowCompleted", "WorkflowFailed", "EventReplayed", "ManifestValidated", "ManifestValidationFailed", "PackagePublished", "PackageSignatureVerified", "SecretRotated", "ExtensionHealthChanged", "ExtensionLogEmitted"].map((e) => (
              <div key={e} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1"><code className="text-primary">{e}</code></div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Zap className="h-4 w-4 text-primary" /> Event guarantees</h3>
          <div className="mt-3 space-y-1.5 text-xs">
            <Cap label="Versioned (semver) event envelopes" />
            <Cap label="Correlation + causation IDs" />
            <Cap label="Idempotent delivery (eventId + consumer)" />
            <Cap label="Transactional outbox (at-least-once)" />
            <Cap label="Dead-letter queue on exhaustion" />
            <Cap label="Replay (dry-run + execute)" />
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ============ Manifest Validator ============ */
export function ManifestsView() {
  const validate = useValidateManifest();
  const [manifest, setManifest] = useState(JSON.stringify({
    metadata: { id: "com.acme.analytics", name: "Cook Analytics", version: "1.0.0", description: "Analytics for cooks", publisher: "acme-corp" },
    capabilities: [{ name: "api.handler" }, { name: "event.subscriber" }],
    permissions: [{ code: "read.cooks", description: "Read cook data" }, { code: "read.analytics", description: "Read analytics" }],
    requiredAPIs: [], requiredEvents: ["Booking.Confirmed"], configurationSchema: {}, connectorDependencies: [],
    localization: { defaultLanguage: "en", supportedLanguages: ["en", "tw"] },
    licensing: { type: "free" }, compatibility: { platformRange: ">=1.0.0" },
  }, null, 2));
  const [result, setResult] = useState<null | { valid: boolean; errors: string[] }>(null);

  const submit = async () => {
    try {
      const parsed = JSON.parse(manifest);
      const r = await validate.mutateAsync(parsed);
      setResult({ valid: r.valid, errors: r.errors });
      toast(r.valid ? "Manifest is valid" : "Validation failed", { description: r.valid ? undefined : `${r.errors.length} error(s)` });
    } catch (e) { toast.error("Invalid JSON", { description: e instanceof Error ? e.message : undefined }); }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Manifest Validator" description="Upload a manifest, validate it, preview installation & permission requests." />
      <Card className="p-4">
        <Label>Manifest JSON</Label>
        <Textarea value={manifest} onChange={(e) => setManifest(e.target.value)} rows={18} className="mt-2 font-mono text-xs" />
        <Button className="mt-3 gap-2" onClick={submit} disabled={validate.isPending}>{validate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Validate manifest</Button>
      </Card>
      {result && (
        <Card className={result.valid ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20" : "border-rose-300 bg-rose-50 dark:bg-rose-950/20"}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              {result.valid ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertCircle className="h-5 w-5 text-rose-600" />}
              <span className="text-sm font-semibold">{result.valid ? "Manifest is valid" : "Validation failed"}</span>
            </div>
            {result.errors.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-rose-700 dark:text-rose-300">{result.errors.map((e, i) => <li key={i}>• {e}</li>)}</ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ============ CLI ============ */
export function CliView() {
  const runCli = useRunCli();
  const [argv, setArgv] = useState("manifest:generate --name com.acme.test");
  const [output, setOutput] = useState<null | { success: boolean; message: string; data?: unknown }>(null);

  const submit = async () => {
    const parts = argv.trim().split(/\s+/);
    const r = await runCli.mutateAsync(parts);
    setOutput(r);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Developer CLI" description="Run @eks/dev-cli commands in-browser." />
      <Card className="p-4">
        <Label>Command</Label>
        <div className="mt-2 flex gap-2">
          <div className="flex flex-1 items-center rounded-md border border-input bg-muted px-3"><span className="text-xs text-muted-foreground">eks&nbsp;</span><input value={argv} onChange={(e) => setArgv(e.target.value)} className="flex-1 bg-transparent py-2 text-sm outline-none" /></div>
          <Button onClick={submit} disabled={runCli.isPending} className="gap-2">{runCli.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {["create", "validate", "build", "test", "package", "install", "publish", "upgrade", "manifest:generate", "logs", "events:replay"].map((c) => (
            <button key={c} onClick={() => setArgv(c + (c === "create" ? " com.example.my-ext" : c === "manifest:generate" ? " --name com.acme.test" : ""))} className="rounded-md border border-border px-2 py-0.5 text-[11px] font-mono hover:bg-muted">{c}</button>
          ))}
        </div>
      </Card>
      {output && (
        <Card className="p-4">
          <div className="flex items-center gap-2"><code className="text-xs text-muted-foreground">$ eks {argv}</code></div>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted/60 p-3 text-xs scrollbar-thin">{JSON.stringify(output, null, 2)}</pre>
        </Card>
      )}
    </div>
  );
}

/* ============ Publishers ============ */
export function PublishersView() {
  const { data, isLoading } = useDevPublishers();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Publishers" description="Publisher registry with verification status + Ed25519 signing keys." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div><div className="text-sm font-bold">{p.name}</div><code className="text-[10px] text-muted-foreground">@{p.handle}</code></div>
              <Badge className={p.verificationStatus === "VERIFIED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}>{p.verificationStatus}</Badge>
            </div>
            {p.description && <p className="mt-2 text-xs text-muted-foreground">{p.description}</p>}
            <div className="mt-2 text-[11px] text-muted-foreground">{p._count.extensions} extensions · {p._count.packages} packages</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Logs ============ */
export function LogsView() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Extension Logs" description="Search, filter, correlate with traces, export." />
      <Card className="p-6 text-center text-sm text-muted-foreground">
        <ScrollText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
        Extension logs appear here when extensions run. Logs are auto-tagged with extensionId + organizationId and correlated via traceId.
      </Card>
    </div>
  );
}

/* ============ Replay ============ */
export function ReplayView() {
  const { data, isLoading } = useDevReplays();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Event Replay" description="Replay historical events with dry-run + execute modes." />
      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs"><RotateCcw className="h-4 w-4 text-primary" /><span>Replay an event by ID, event type, or date range. Dry-run mode shows what would happen without side effects.</span></div>
      </Card>
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {data.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No replays yet.</div>}
          {data.map((r) => (
            <div key={r.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><RotateCcw className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><div className="truncate font-mono text-xs">{r.eventType}</div><div className="text-[11px] text-muted-foreground">event {r.eventId.slice(0, 12)} · {new Date(r.createdAt).toLocaleString()}</div></div>
              <Badge variant="outline" className="text-[10px]">{r.mode}</Badge>
              <Badge className={r.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-muted"}>{r.status}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Runtime Inspector ============ */
export function RuntimeView() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Runtime Inspector" description="CPU usage, memory usage, execution history, failures, retries, logs, metrics." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-2"><Cpu className="h-5 w-5 text-primary" /><span className="text-sm font-semibold">Sandbox limits</span></div>
          <div className="mt-3 space-y-1.5 text-xs">
            <Cap label="Max execution: 30s per invocation" />
            <Cap label="Max memory: 256MB per extension" />
            <Cap label="Max invocations: 1000/billing period" />
            <Cap label="Permission enforcement on every call" />
            <Cap label="Network policy (deny by default)" />
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /><span className="text-sm font-semibold">Isolation guarantees</span></div>
          <div className="mt-3 space-y-1.5 text-xs">
            <Cap label="One extension cannot crash another" />
            <Cap label="Sandbox violations auto-logged + metrics" />
            <Cap label="Rate-limited invocations" />
            <Cap label="CPU/memory/timeout enforcement" />
            <Cap label="Permission denied → SandboxPermissionError" />
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /><span className="text-sm font-semibold">Lifecycle</span></div>
          <div className="mt-3 space-y-1.5 text-xs">
            <Cap label="install → activate → suspend → remove" />
            <Cap label="upgrade + rollback" />
            <Cap label="Startup validation" />
            <Cap label="Graceful shutdown (deactivate)" />
            <Cap label="Health reporting (HEALTHY/DEGRADED/UNHEALTHY)" />
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ============ Shared ============ */
function Header({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h2><p className="mt-0.5 text-sm text-muted-foreground">{description}</p></div>;
}
function Kpi({ icon: Icon, label, value, sub, onClick }: { icon: typeof Puzzle; label: string; value: React.ReactNode; sub?: string; onClick?: () => void }) {
  return <button onClick={onClick} className="text-left"><Card className="p-4 transition-all hover:shadow-md sm:p-5"><div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold sm:text-3xl">{value}</div>{sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}</div><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div></div></Card></button>;
}
function Cap({ label }: { label: string }) {
  return <div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span className="text-muted-foreground">{label}</span></div>;
}
function Pkg({ name, desc }: { name: string; desc: string }) {
  return <div className="flex items-center gap-2"><Package className="h-3.5 w-3.5 text-primary" /><code className="text-xs font-mono text-primary">{name}</code><span className="text-xs text-muted-foreground">{desc}</span></div>;
}
function LoadingGrid() {
  return <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4"><Skeleton className="h-8 w-64" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div><Skeleton className="h-64 rounded-xl" /></div>;
}
