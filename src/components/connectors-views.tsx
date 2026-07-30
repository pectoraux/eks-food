"use client";

import { useState } from "react";
import { Plug, Heart, RefreshCw, Database, Activity, MapPin, Cloud, Send, Zap, Loader2, Globe, ShieldCheck, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useProviders, useProviderHealth, useSyncHistory, useCacheEntries, useMapsAction, useWeatherAction, useNotifyAction, type HealthProvider } from "@/lib/connectors-api";
import { toast } from "sonner";

const CATEGORIES = ["MAPS", "WEATHER", "CALENDAR", "GOVERNMENT", "RESTAURANT", "PROCUREMENT", "MERCHANT", "NOTIFICATIONS", "COMMUNICATIONS", "IDENTITY"];

/* ============ Provider Registry ============ */
export function ProviderRegistryView() {
  const { data, isLoading } = useProviders();
  if (isLoading || !data) return <LoadingGrid />;
  const grouped = CATEGORIES.map((cat) => ({ cat, providers: data.filter((p) => p.category === cat) })).filter((g) => g.providers.length > 0);
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Provider Registry" description="Installed providers, versions, health, regions, capabilities." />
      {grouped.map(({ cat, providers }) => (
        <div key={cat}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat} ({providers.length})</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="truncate text-sm font-bold">{p.name}</div><code className="text-[10px] text-muted-foreground">{p.code}</code></div>
                  <Badge className={p.health[0]?.status === "HEALTHY" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : p.health[0]?.status === "DEGRADED" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"}>{p.health[0]?.status ?? "HEALTHY"}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[10px]">score {p.health[0]?.score ?? 100}</Badge>
                  <Badge variant="outline" className="text-[10px]">{p.health[0]?.latencyMs ?? 0}ms</Badge>
                  <Badge variant="outline" className="text-[10px]">weight {p.weight}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {JSON.parse(p.capabilities).slice(0, 4).map((c: string) => <Badge key={c} variant="secondary" className="text-[9px]">{c}</Badge>)}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============ Connector Health ============ */
export function ConnectorHealthView() {
  const { data, isLoading } = useProviderHealth();
  if (isLoading || !data) return <LoadingGrid />;
  const healthy = data.filter((p) => p.status === "HEALTHY").length;
  const degraded = data.filter((p) => p.status === "DEGRADED").length;
  const unhealthy = data.filter((p) => p.status === "UNHEALTHY").length;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Connector Health" description="Latency, failures, retries, availability across all providers." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini label="Healthy" value={healthy} tone="ok" />
        <Mini label="Degraded" value={degraded} tone="warn" />
        <Mini label="Unhealthy" value={unhealthy} tone="err" />
        <Mini label="Avg latency" value={`${Math.round(data.reduce((s, p) => s + p.latencyMs, 0) / (data.length || 1))}ms`} />
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {data.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${p.status === "HEALTHY" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : p.status === "DEGRADED" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"}`}><Heart className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="text-[11px] text-muted-foreground">{p.category} · {p.latencyMs}ms · {(p.errorRate * 100).toFixed(1)}% errors</div></div>
              <Badge variant="outline" className="text-[10px]">score {p.score}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Sync Dashboard ============ */
export function SyncDashboardView() {
  const { data, isLoading } = useSyncHistory();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Synchronization Dashboard" description="Running syncs, history, checkpoint status, backlogs." />
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {data.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No sync history yet.</div>}
          {data.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><RefreshCw className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><div className="truncate font-mono text-xs">{s.resource}</div><div className="text-[11px] text-muted-foreground">{s.mode} · {s.recordsSynced} records · {(s.durationMs / 1000).toFixed(1)}s</div></div>
              <Badge className={s.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : s.status === "FAILED" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}>{s.status}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Cache Inspector ============ */
export function CacheInspectorView() {
  const { data, isLoading } = useCacheEntries();
  if (isLoading || !data) return <LoadingGrid />;
  const totalHits = data.reduce((s, e) => s + e.hitCount, 0);
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Cache Inspector" description="Cache hit rate, TTL, invalidations, hot keys." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini label="Cached entries" value={data.length} />
        <Mini label="Total hits" value={totalHits} />
        <Mini label="Stale entries" value={data.filter((e) => e.stale).length} tone="warn" />
        <Mini label="Avg hit rate" value={data.length > 0 ? `${Math.round(totalHits / data.length)}x` : "0x"} />
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {data.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No cache entries.</div>}
          {data.map((e) => (
            <div key={e.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Database className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><div className="truncate font-mono text-xs">{e.key}</div><div className="text-[11px] text-muted-foreground">TTL {e.ttlSec}s · {e.hitCount} hits · expires {new Date(e.expiresAt).toLocaleTimeString()}</div></div>
              {e.stale && <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-[10px]">stale</Badge>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ API Explorer (interactive) ============ */
export function ApiExplorerView() {
  const mapsAction = useMapsAction();
  const weatherAction = useWeatherAction();
  const notifyAction = useNotifyAction();
  const [address, setAddress] = useState("Independence Square, Accra");
  const [lat, setLat] = useState("5.6037");
  const [lng, setLng] = useState("-0.1870");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const testMaps = async () => {
    try { const r = await mapsAction.mutateAsync({ action: "geocode", address, organizationId: "demo" }); setResult(r as Record<string, unknown>); toast.success("Geocoding resolved"); } catch (e) { toast.error("Failed", { description: e instanceof Error ? e.message : undefined }); }
  };
  const testWeather = async () => {
    try { const r = await weatherAction.mutateAsync({ lat: Number(lat), lng: Number(lng), organizationId: "demo", type: "current" }); setResult(r as Record<string, unknown>); toast.success("Weather retrieved"); } catch (e) { toast.error("Failed", { description: e instanceof Error ? e.message : undefined }); }
  };
  const testNotify = async () => {
    try { const r = await notifyAction.mutateAsync({ organizationId: "demo", channel: "IN_APP", to: "user@eks.food", templateCode: "WELCOME", variables: { name: "Test" } }); setResult(r as Record<string, unknown>); toast.success("Notification sent"); } catch (e) { toast.error("Failed", { description: e instanceof Error ? e.message : undefined }); }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="API Explorer" description="Test connector APIs in-browser. Calls go through the provider selection engine." />
      <Card className="p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-primary" /> Maps — Geocode</h3>
        <div className="mt-3 flex gap-2"><Input value={address} onChange={(e) => setAddress(e.target.value)} className="flex-1" /><Button onClick={testMaps} disabled={mapsAction.isPending} className="gap-2">{mapsAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Geocode</Button></div>
      </Card>
      <Card className="p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Cloud className="h-4 w-4 text-primary" /> Weather — Current</h3>
        <div className="mt-3 flex gap-2"><Input value={lat} onChange={(e) => setLat(e.target.value)} className="w-24" placeholder="Lat" /><Input value={lng} onChange={(e) => setLng(e.target.value)} className="w-24" placeholder="Lng" /><Button onClick={testWeather} disabled={weatherAction.isPending} className="gap-2">{weatherAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />} Get weather</Button></div>
      </Card>
      <Card className="p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4 text-primary" /> Notifications — In-App</h3>
        <div className="mt-3"><Button onClick={testNotify} disabled={notifyAction.isPending} className="gap-2">{notifyAction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test notification</Button></div>
      </Card>
      {result && <Card className="p-4"><h3 className="text-sm font-semibold mb-2">Result</h3><pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-xs scrollbar-thin">{JSON.stringify(result, null, 2)}</pre></Card>}
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
