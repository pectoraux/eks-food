"use client";

import {
  Plug, Activity, Webhook, RefreshCw, FileJson, Heart, KeyRound, Gauge,
  CheckCircle2, AlertCircle, Clock, Zap, TrendingUp, TrendingDown, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntConnectors, useIntSyncJobs, useIntWebhooks, useIntPolling, useIntSchemas, useIntHealth, useIntCredentials, useIntPolicies } from "@/lib/integration-api";

/* ============ Connector Registry ============ */
export function ConnectorRegistryView() {
  const { data, isLoading } = useIntConnectors();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Connector Registry" description="Installed connectors, versions, dependencies, publishers." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-sm font-bold">{c.connectorDef.name}</div><code className="text-[10px] text-muted-foreground">{c.connectorDef.code}</code></div>
              <Badge className={statusColor(c.status)}>{c.status}</Badge>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{c.name}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="outline" className="text-[10px]">{c._count.executions} execs</Badge>
              <Badge variant="outline" className="text-[10px]">{c._count.syncJobs} syncs</Badge>
              <Badge variant="outline" className="text-[10px]">{c._count.webhookEndpoints} webhooks</Badge>
              <Badge variant="outline" className="text-[10px]">{c._count.pollingJobs} polls</Badge>
            </div>
            {c.credential && <div className="mt-1 text-[11px] text-muted-foreground"><KeyRound className="mr-1 inline h-3 w-3" />{c.credential.name} ({c.credential.authType})</div>}
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Sync Monitor ============ */
export function SyncMonitorView() {
  const { data, isLoading } = useIntSyncJobs();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Synchronization Monitor" description="Active sync jobs, lag, checkpoints, throughput, failures." />
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {data.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No sync jobs.</div>}
          {data.map((j) => (
            <div key={j.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><RefreshCw className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><code className="text-xs font-mono">{j.config.connectorDef.code}</code><Badge variant="outline" className="text-[10px]">{j.mode}</Badge></div>
                <div className="text-[11px] text-muted-foreground">{j.recordsProcessed} processed · {j.recordsCreated} created · {j.recordsUpdated} updated · {j._count.checkpoints} checkpoints</div>
              </div>
              <Badge className={statusColor(j.status)}>{j.status}</Badge>
              {j.durationMs && <span className="text-[11px] text-muted-foreground">{(j.durationMs / 1000).toFixed(1)}s</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Webhook Explorer ============ */
export function WebhookExplorerView() {
  const { data, isLoading } = useIntWebhooks();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Webhook Explorer" description="Inspect deliveries, retries, payloads, signatures, latency." />
      <div className="space-y-3">
        {data.map((ep) => (
          <Card key={ep.id} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-sm font-mono">{ep.url}</div><div className="text-xs text-muted-foreground">{ep.config.connectorDef.code} · {ep._count.deliveries} deliveries</div></div>
              <div className="flex gap-1">
                <Badge className={ep.verified ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-muted"}>{ep.verified ? "verified" : "unverified"}</Badge>
                <Badge className={ep.active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-muted"}>{ep.active ? "active" : "paused"}</Badge>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {JSON.parse(ep.eventTypes).map((t: string) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Polling Explorer ============ */
export function PollingExplorerView() {
  const { data, isLoading } = useIntConnectors();
  const firstConfigId = data?.[0]?.id;
  const { data: polls, isLoading: pollsLoading } = useIntPolling(firstConfigId);
  if (isLoading || !data) return <LoadingGrid />;
  if (pollsLoading || !polls) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Polling Explorer" description="Polling history, schedules, execution times, failures." />
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {polls.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No polling jobs.</div>}
          {polls.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Clock className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><code className="text-xs font-mono">{p.resource}</code>{p.adaptive && <Badge variant="secondary" className="text-[10px]">adaptive</Badge>}</div>
                <div className="text-[11px] text-muted-foreground">every {p.intervalSec}s · {p.lastRecordCount} records last poll · cursor {p.lastCursor?.slice(0, 12) ?? "none"}</div>
              </div>
              <Badge className={statusColor(p.status)}>{p.status}</Badge>
              {p.lastPollAt && <span className="text-[11px] text-muted-foreground">{new Date(p.lastPollAt).toLocaleTimeString()}</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Schema Explorer ============ */
export function SchemaExplorerView() {
  const { data, isLoading } = useIntSchemas();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Schema Explorer" description="Browse schemas, versions, mappings, transformations." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-sm font-bold">{s.name}</div><code className="text-[10px] text-muted-foreground">{s.identifier}</code></div>
              <Badge variant="outline" className="text-[10px]">{s.format}</Badge>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              {s.latestVersion && <Badge variant="secondary" className="text-[10px]">v{s.latestVersion.version}</Badge>}
              <span>{s._count.versions} versions</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Health Dashboard ============ */
export function HealthDashboardView() {
  const { data, isLoading } = useIntHealth();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Health Dashboard" description="Connector availability, latency, failures, retries, throughput." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini label="Healthy" value={data.filter((h) => h.status === "HEALTHY").length} tone="ok" />
        <Mini label="Degraded" value={data.filter((h) => h.status === "DEGRADED").length} tone="warn" />
        <Mini label="Unhealthy" value={data.filter((h) => h.status === "UNHEALTHY").length} tone="err" />
        <Mini label="Avg availability" value={`${Math.round(data.reduce((s, h) => s + h.availability, 0) / (data.length || 1) * 100)}%`} />
      </div>
      <div className="space-y-3">
        {data.map((h) => (
          <Card key={h.configId} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${h.status === "HEALTHY" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : h.status === "DEGRADED" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"}`}><Heart className="h-4 w-4" /></div>
                <div><code className="text-xs font-mono">{h.configId.slice(0, 16)}…</code><div className="text-[11px] text-muted-foreground">Reported {new Date(h.reportedAt).toLocaleTimeString()}</div></div>
              </div>
              <Badge className={statusColor(h.status)}>{h.status}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Metric label="Latency" value={`${h.latencyMs}ms`} icon={Clock} tone={h.latencyMs > 1000 ? "warn" : "ok"} />
              <Metric label="Error rate" value={`${(h.errorRate * 100).toFixed(1)}%`} icon={TrendingDown} tone={h.errorRate > 0.05 ? "err" : "ok"} />
              <Metric label="Throughput" value={`${h.throughput.toFixed(0)}/s`} icon={Zap} tone="ok" />
              <Metric label="Sync lag" value={`${h.syncLagSec}s`} icon={RefreshCw} tone={h.syncLagSec > 60 ? "warn" : "ok"} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Credentials ============ */
export function CredentialsView() {
  const { data, isLoading } = useIntCredentials();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Credentials" description="Encrypted credential store with rotation, expiration, scoped access." />
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {data.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No credentials.</div>}
          {data.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><KeyRound className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.name}</div><div className="text-[11px] text-muted-foreground">{c.authType} · {c.lastUsedAt ? `last used ${new Date(c.lastUsedAt).toLocaleDateString()}` : "never used"}</div></div>
              <Badge className={c.active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-muted"}>{c.active ? "active" : "inactive"}</Badge>
              {c.expiresAt && <Badge variant="outline" className="text-[10px]">expires {new Date(c.expiresAt).toLocaleDateString()}</Badge>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Policies ============ */
export function PoliciesView() {
  const { data, isLoading } = useIntPolicies();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Retry & Rate-Limit Policies" description="Configurable resilience policies for every connector." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><RefreshCw className="h-4 w-4 text-primary" /> Retry Policies</h3>
          <div className="mt-3 space-y-2">
            {data.retry.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-3 text-xs">
                <div className="flex items-center justify-between"><span className="font-medium">{p.name}</span><Badge variant="outline" className="text-[10px]">{p.circuitBreaker ? "circuit breaker" : "no CB"}</Badge></div>
                <div className="mt-1 text-muted-foreground">{p.maxAttempts} attempts · {p.baseDelayMs}ms base · budget {p.budget}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4 text-primary" /> Rate-Limit Policies</h3>
          <div className="mt-3 space-y-2">
            {data.rateLimit.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-3 text-xs">
                <div className="font-medium">{p.name}</div>
                <div className="mt-1 text-muted-foreground">{p.capacity} capacity · {p.refillRate}/s refill · {p.concurrencyLimit} concurrent</div>
              </div>
            ))}
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
function LoadingGrid() {
  return <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4"><Skeleton className="h-8 w-64" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div><Skeleton className="h-64 rounded-xl" /></div>;
}
function Mini({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "err" }) {
  return <Card className="p-4"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-bold ${tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "err" ? "text-rose-600" : ""}`}>{value}</div></Card>;
}
function Metric({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Clock; tone: "ok" | "warn" | "err" }) {
  return <div className="flex items-center gap-2"><Icon className={`h-3.5 w-3.5 ${tone === "ok" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : "text-rose-500"}`} /><div><div className="text-[10px] uppercase text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div></div>;
}
function statusColor(s: string): string {
  const map: Record<string, string> = { ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", HEALTHY: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", COMPLETED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", DELIVERED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", PAUSED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", DEGRADED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", PARTIAL: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", ERROR: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", FAILED: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", UNHEALTHY: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", DEAD_LETTERED: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", DRAFT: "bg-muted text-muted-foreground", OFFLINE: "bg-muted text-muted-foreground" };
  return map[s] ?? "bg-muted text-muted-foreground";
}
