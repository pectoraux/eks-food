"use client";

import {
  BarChart3, TrendingUp, MapPin, Flame, Activity, Banknote, CheckCircle2,
  XCircle, Layers,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Area, AreaChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/lib/api";
import { SectionHeader, StatCard, Pill, EmptyState } from "@/components/shared";
import { formatCurrency, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

const CUISINE_EMOJI: Record<string, string> = {
  ghanaian: "🍲", nigerian: "🌶️", vegan: "🥗", continental: "🍝", grills: "🔥",
};

export function FoodIntelligenceModule() {
  const { data, isLoading } = useAnalytics();

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
        <SectionHeader title="Food Intelligence" description="Anonymised, aggregated market intelligence — never PII." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  const op = data.operations;
  const totalOpBookings = op.byStatus.reduce((s, b) => s + b.count, 0);
  const heatmapMax = Math.max(...data.regionHeatmap.map((r) => r.avgDemand), 1);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
      <SectionHeader
        title="Food Intelligence"
        description="Anonymised, aggregated demand, trends & price intelligence across every market."
      />

      {/* Operational KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Gross payment volume" value={formatCurrency(op.grossPaymentVolume)} icon={Banknote} accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" sub="Via Payswap" />
        <StatCard label="Worker payouts" value={formatCurrency(op.workerPayouts)} icon={TrendingUp} accent="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" sub={`${op.totalBookings} bookings`} />
        <StatCard label="Completion rate" value={`${op.completionRate}%`} icon={CheckCircle2} accent="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" sub={`${op.cancellationRate}% cancelled`} />
        <StatCard label="Active bookings" value={totalOpBookings} icon={Activity} sub="Across all statuses" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Demand heatmap by region */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Flame className="h-4 w-4 text-primary" /> Demand heatmap by region</CardTitle>
            <CardDescription className="text-xs">Average demand score (0–100) over the last 14 days. Anonymised & aggregated.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.regionHeatmap.map((r) => (
              <div key={r.region} className="flex items-center gap-3">
                <div className="flex w-32 shrink-0 items-center gap-1.5 text-sm">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate font-medium">{r.region}</span>
                </div>
                <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-muted">
                  <div
                    className="flex h-full items-center justify-end rounded-md px-2 transition-all"
                    style={{
                      width: `${(r.avgDemand / heatmapMax) * 100}%`,
                      background: `linear-gradient(90deg, color-mix(in oklab, var(--primary) 30%, transparent), var(--primary))`,
                    }}
                  >
                    <span className="text-[11px] font-bold text-primary-foreground">{Math.round(r.avgDemand)}</span>
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{r.bookings}</span> bk · {formatCurrency(r.avgPrice)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Cuisine trends */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Layers className="h-4 w-4 text-primary" /> Top cuisines</CardTitle>
            <CardDescription className="text-xs">By total bookings (14d).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.cuisineTrends.map((c, i) => {
              const max = data.cuisineTrends[0]?.bookings ?? 1;
              return (
                <div key={c.cuisine} className="flex items-center gap-2.5">
                  <span className="w-5 text-center text-base">{CUISINE_EMOJI[c.cuisine] ?? "🍽️"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium capitalize">{c.cuisine}</span>
                      <span className="text-[11px] text-muted-foreground">{formatCurrency(c.avgPrice)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(c.bookings / max) * 100}%` }} />
                    </div>
                  </div>
                  {i === 0 && <Badge className="bg-primary/10 text-primary">#1</Badge>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Daily demand trend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-primary" /> Daily demand (14 days)</CardTitle>
            <CardDescription className="text-xs">Total bookings across all regions & cuisines.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="demandGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} className="text-[10px]" tickFormatter={(v) => v.slice(5)} />
                <YAxis tickLine={false} axisLine={false} className="text-[10px]" width={32} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }} formatter={(v: number) => [v, "Bookings"]} />
                <Area type="monotone" dataKey="bookings" stroke="var(--primary)" strokeWidth={2} fill="url(#demandGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Hourly demand */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-primary" /> Demand by hour</CardTitle>
            <CardDescription className="text-xs">Peak meal windows drive surge pricing.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.hourly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="hour" tickLine={false} axisLine={false} className="text-[10px]" tickFormatter={(v) => `${v}:00`} />
                <YAxis tickLine={false} axisLine={false} className="text-[10px]" width={32} />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }} formatter={(v: number) => [v, "Bookings"]} />
                <Bar dataKey="bookings" radius={[6, 6, 0, 0]} maxBarSize={36}>
                  {data.hourly.map((h, i) => {
                    const max = Math.max(...data.hourly.map((x) => x.bookings));
                    const isPeak = h.bookings === max;
                    return <Cell key={i} fill={isPeak ? "var(--primary)" : "color-mix(in oklab, var(--primary) 45%, transparent)"} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Booking status breakdown */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-primary" /> Booking status distribution</CardTitle>
          <CardDescription className="text-xs">Real-time operational state across the organisation.</CardDescription>
        </CardHeader>
        <CardContent>
          {op.byStatus.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {op.byStatus.map((s) => (
                <div key={s.status} className="rounded-lg border border-border p-3 text-center">
                  <div className="text-2xl font-bold">{s.count}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{titleCase(s.status)}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={BarChart3} title="No bookings yet" />
          )}
        </CardContent>
      </Card>

      {/* Privacy notice */}
      <Card className="mt-6 border-border bg-muted/30">
        <CardContent className="flex items-start gap-3 p-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Privacy by design</div>
            <p className="mt-0.5 text-xs text-muted-foreground">Food Intelligence uses only aggregate, anonymised signals — region, cuisine, hour, demand score & average price. No personally identifiable information is ever exposed or stored in these metrics.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
