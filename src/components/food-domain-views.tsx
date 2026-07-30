"use client";

import { useState } from "react";
import { Network, Search, GitBranch, Database, Activity, MapPin, Loader2, ArrowRight, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useGraphMetrics, useSearch, useAutocomplete, useGraphNeighbors, useEntities, useSeedFoodDomain } from "@/lib/food-domain-api";
import { toast } from "sonner";

const ENTITY_TYPES = ["INGREDIENT", "RECIPE", "RESTAURANT", "COOK", "KITCHEN", "CUSTOMER", "HOUSEHOLD", "SUPPLIER", "VENDOR", "EQUIPMENT", "VEHICLE"];

/* ============ Graph Explorer ============ */
export function GraphExplorerView() {
  const { data: metrics, isLoading } = useGraphMetrics();
  const [entityType, setEntityType] = useState("INGREDIENT");
  const [entityId, setEntityId] = useState("");
  const { data: neighbors, isLoading: nbLoading } = useGraphNeighbors(entityType, entityId || undefined);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Graph Explorer" description="Entity explorer, relationship explorer, graph traversal, dependency analysis." />
      {isLoading || !metrics ? <Skeleton className="h-24" /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Mini label="Graph nodes" value={metrics.nodes} />
          <Mini label="Graph edges" value={metrics.edges} />
          <Mini label="Relationship types" value={Object.keys(metrics.edgeTypes).length} />
          <Mini label="Top type" value={Object.entries(metrics.edgeTypes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"} />
        </div>
      )}
      <Card className="p-4">
        <Label>Explore neighbors</Label>
        <div className="mt-2 flex gap-2">
          <Select value={entityType} onValueChange={setEntityType}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
          <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="Entity ID" className="flex-1" />
          <Button disabled={nbLoading}>{nbLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />} Explore</Button>
        </div>
      </Card>
      {neighbors && Array.isArray(neighbors) && neighbors.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Neighbors ({neighbors.length})</h3>
          <div className="mt-3 space-y-2">
            {neighbors.map((n: unknown, i: number) => {
              const node = n as Record<string, unknown>;
              const data = (node.data ?? {}) as Record<string, unknown>;
              return (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><GitBranch className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{String(data.name ?? node.entityId)}</div><div className="text-[11px] text-muted-foreground">{String(node.entityType)} · {String(node.entityId).slice(0, 12)}…</div></div>
                <Badge variant="outline" className="text-[10px]">{String(node.entityType)}</Badge>
              </div>
              );
            })}
          </div>
        </Card>
      )}
      {metrics && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Edge type distribution</h3>
          <div className="mt-3 space-y-1.5">
            {Object.entries(metrics.edgeTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <div key={type} className="flex items-center gap-3 text-xs">
                <code className="w-32 truncate font-mono text-primary">{type}</code>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(count / Math.max(...Object.values(metrics.edgeTypes))) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ============ Search ============ */
export function SearchView() {
  const [q, setQ] = useState("");
  const [entityType, setEntityType] = useState("ALL");
  const { data: autocomplete } = useAutocomplete(q);
  const { data: searchResults, isLoading } = useSearch(q, entityType === "ALL" ? undefined : entityType);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Search" description="Full-text, faceted, autocomplete, fuzzy, multilingual search across all entities." />
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ingredients, recipes, restaurants, cooks…" className="pl-9" />
        {autocomplete && autocomplete.length > 0 && q.length >= 2 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg">
            {autocomplete.map((a, i) => (
              <button key={i} onClick={() => setQ(a.name)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                <Badge variant="outline" className="text-[9px]">{a.entityType}</Badge>
                <span>{a.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Select value={entityType} onValueChange={setEntityType}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All entities</SelectItem>{ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
      {isLoading && <Skeleton className="h-40" />}
      {searchResults && searchResults.results.length > 0 && (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {searchResults.results.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-3 text-sm">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Database className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.name}</div>{r.description && <div className="truncate text-[11px] text-muted-foreground">{r.description}</div>}</div>
                <Badge variant="outline" className="text-[10px]">{r.entityType}</Badge>
                <Badge variant="secondary" className="text-[10px]">{r.score}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
      {searchResults && searchResults.results.length === 0 && q.length >= 2 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">No results for &ldquo;{q}&rdquo;</Card>
      )}
    </div>
  );
}

/* ============ Entity Browser ============ */
export function EntityBrowserView() {
  const [entityType, setEntityType] = useState("INGREDIENT");
  const { data, isLoading } = useEntities(entityType);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Entity Browser" description="Browse canonical entities. Every entity is versioned, auditable, localized." />
      <Select value={entityType} onValueChange={setEntityType}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger><SelectContent>{ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
      {isLoading && <Skeleton className="h-64" />}
      {data && Array.isArray(data) && data.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data as readonly Record<string, unknown>[]).map((e, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="truncate text-sm font-bold">{String(e.name ?? e.code ?? "unnamed")}</div>{e.description ? <div className="line-clamp-2 text-xs text-muted-foreground">{String(e.description)}</div> : null}</div>
                {e.status ? <Badge variant="outline" className="text-[10px]">{String(e.status)}</Badge> : null}
              </div>
              {e.code ? <code className="mt-2 block text-[10px] text-muted-foreground">{String(e.code)}</code> : null}
              {e.version !== undefined ? <div className="mt-1 text-[11px] text-muted-foreground">v{String(e.version)}</div> : null}
            </Card>
          ))}
        </div>
      )}
      {data && Array.isArray(data) && data.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">No {entityType} entities found. Seed the domain first.</Card>}
    </div>
  );
}

/* ============ Shared ============ */
function Header({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h2><p className="mt-0.5 text-sm text-muted-foreground">{description}</p></div>;
}
function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return <Card className="p-4"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></Card>;
}
