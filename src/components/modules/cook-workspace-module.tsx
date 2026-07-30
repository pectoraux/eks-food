"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import {
  ChefHat, Star, Award, Calendar, Wallet, TrendingUp, Clock,
  CheckCircle2, MapPin, BadgeCheck, ArrowRightCircle,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useCookWorkspace, useCooks } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { SectionHeader, StatCard, Pill, EmptyState } from "@/components/shared";
import { formatCurrency, formatCurrencyPrecise, formatDateTime, formatDate, statusClass, titleCase } from "@/lib/format";

export function CookWorkspaceModule() {
  const activeCookId = useAppStore((s) => s.activeCookId);
  const setActiveCookId = useAppStore((s) => s.setActiveCookId);
  const cooksQ = useCooks({ lat: 5.645, lng: -0.181, limit: 50 });
  const [selected, setSelected] = useState<string | null>(activeCookId);

  const cookId = selected ?? activeCookId ?? cooksQ.data?.cooks[0]?.cookId ?? null;
  const ws = useCookWorkspace(cookId);

  const allCooks = cooksQ.data?.cooks ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
      <SectionHeader
        title="Cook Workspace"
        description="Jobs, earnings & performance. Payouts are processed by Payswap — only references are stored."
        action={
          <Select value={cookId ?? undefined} onValueChange={(v) => { setSelected(v); setActiveCookId(v); }}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select a cook" /></SelectTrigger>
            <SelectContent>
              {allCooks.map((c) => <SelectItem key={c.cookId} value={c.cookId}>{c.name} · {c.homeRegion}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      {!cookId || !cooksQ.data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          <Skeleton className="lg:col-span-3 h-96 rounded-xl" />
        </div>
      ) : ws.isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : ws.data ? (
        <CookWorkspaceView data={ws.data} currency={ws.data.income.currency} />
      ) : null}
    </div>
  );
}

function CookWorkspaceView({ data, currency }: { data: NonNullable<ReturnType<typeof useCookWorkspace>["data"]>; currency: string }) {
  const p = data.profile;
  return (
    <div className="space-y-6">
      {/* Profile header */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-muted">
            {p.avatarUrl && <Image src={p.avatarUrl} alt={p.name} fill className="object-cover" sizes="80px" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold">{p.name}</h2>
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 gap-1"><BadgeCheck className="h-3 w-3" /> {titleCase(p.verificationStatus)}</Badge>
              <Pill className="bg-muted text-muted-foreground">{p.availabilityMode}</Pill>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> <span className="font-semibold text-foreground">{p.rating}</span></span>
              <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {p.completedJobs}/{p.totalJobs} jobs completed</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {p.homeRegion}</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> ~{p.responseTimeMins}m reply</span>
              <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" /> {formatCurrency(p.hourlyRate, currency)}/hr</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{p.bio}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.cuisines.map((c) => <Pill key={c} className="bg-primary/10 text-primary capitalize">{c}</Pill>)}
              {p.skills.map((s) => <Pill key={s} className="bg-muted text-muted-foreground capitalize">{s.replace("_", " ")}</Pill>)}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{formatCurrency(data.income.totalPaid, currency)}</div>
              <div className="text-[11px] text-muted-foreground">total paid (Payswap)</div>
            </div>
            <Badge variant="outline" className="gap-1">{data.income.payoutCount} payouts</Badge>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Completion rate" value={`${data.performance.completionRate}%`} icon={CheckCircle2} accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" />
        <StatCard label="Rating" value={p.rating} icon={Star} accent="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" sub={`${p.totalJobs} total jobs`} />
        <StatCard label="Response time" value={`${p.responseTimeMins}m`} icon={Clock} accent="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" sub="avg reply" />
        <StatCard label="This week" value={formatCurrency(data.performance.weekly[7]?.earnings ?? 0, currency)} icon={TrendingUp} sub={`${data.performance.weekly[7]?.jobs ?? 0} jobs`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Earnings chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Wallet className="h-4 w-4 text-primary" /> Weekly earnings</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.performance.weekly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="week" tickLine={false} axisLine={false} className="text-xs" />
                <YAxis tickLine={false} axisLine={false} className="text-xs" width={48} tickFormatter={(v) => `₵${v}`} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }}
                  formatter={(v: number) => [formatCurrencyPrecise(v, currency), "Earnings"]}
                />
                <Bar dataKey="earnings" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {data.performance.weekly.map((_, i) => (
                    <Cell key={i} fill={i === 7 ? "var(--primary)" : "color-mix(in oklab, var(--primary) 55%, transparent)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Last 8 weeks</span>
              <span>Paid via Payswap Transfers</span>
            </div>
          </CardContent>
        </Card>

        {/* Certifications */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Award className="h-4 w-4 text-primary" /> Certifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {p.certifications.map((c, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border p-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <BadgeCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{c.title}</div>
                  <div className="text-[11px] text-muted-foreground">{c.issuer}</div>
                  {c.expiresAt && <div className="text-[10px] text-muted-foreground">Expires {formatDate(c.expiresAt)}</div>}
                </div>
                <Badge className={statusClass(c.status)}>{titleCase(c.status)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Upcoming jobs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Calendar className="h-4 w-4 text-primary" /> Upcoming jobs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.upcoming.length > 0 ? (
              <div className="divide-y divide-border">
                {data.upcoming.map((j) => (
                  <div key={j.code} className="flex items-center gap-3 p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ChefHat className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{j.code}</span>
                        <Badge className={statusClass(j.status)} variant="outline">{titleCase(j.status)}</Badge>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{j.service} · {j.customerName} · {j.partySize} guests · {j.region}</div>
                      <div className="text-[11px] text-muted-foreground">{formatDateTime(j.scheduledFor)} · {j.durationMins}min</div>
                    </div>
                    <div className="text-right text-sm font-semibold text-primary">{formatCurrency(j.quotedPrice, currency)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Calendar} title="No upcoming jobs" description="New bookings will appear here." />
            )}
          </CardContent>
        </Card>

        {/* Recent payouts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Wallet className="h-4 w-4 text-primary" /> Recent payouts (Payswap)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.income.lastPayouts.length > 0 ? (
              <div className="divide-y divide-border">
                {data.income.lastPayouts.map((t) => (
                  <div key={t.payswapId} className="flex items-center gap-3 p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><ArrowRightCircle className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.payswapId}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {(t.metadata as Record<string, string>).bookingCode ? `Booking ${(t.metadata as Record<string, string>).bookingCode}` : "Payout"} · {formatDate(t.createdAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-emerald-600">+{formatCurrency(t.amount, currency)}</div>
                      <Badge className={statusClass(t.status)} variant="outline">{titleCase(t.status)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Wallet} title="No payouts yet" description="Payouts appear after a booking is completed." />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Completed jobs */}
      {data.completed.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-primary" /> Recent completed jobs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {data.completed.map((j) => (
                <div key={j.code} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{j.code}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{j.service} · {j.customerName}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{formatDate(j.scheduledFor)}</span>
                  <span className="text-sm font-semibold">{formatCurrency(j.quotedPrice, currency)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
