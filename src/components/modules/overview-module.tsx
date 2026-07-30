"use client";

import { useMemo } from "react";
import Image from "next/image";
import {
  Flame, Users, ChefHat, CalendarCheck, Banknote,
  UtensilsCrossed, Settings2, BarChart3, Sparkles, ShieldCheck, Truck,
  Store, PackageSearch, Layers, MapPin, BadgeCheck, Wallet, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePlatform, useSeed } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { StatCard, SectionHeader, Pill } from "@/components/shared";
import { formatCurrency } from "@/lib/format";

const MODULES = [
  { icon: UtensilsCrossed, name: "Customer Platform", desc: "Booking, scheduling, meal history, favorites, subscriptions.", flag: null, live: true },
  { icon: ChefHat, name: "Cook Platform", desc: "Availability, certifications, jobs, navigation, payouts.", flag: null, live: true },
  { icon: Layers, name: "Area Manager Platform", desc: "Recruit, approve, assign, dispatch, quality & territory.", flag: null, live: true },
  { icon: Truck, name: "Rider Platform", desc: "Door-to-door acquisition, referrals, commission tracking.", flag: null, live: true },
  { icon: Store, name: "Restaurant & Vendor Marketplace", desc: "Restaurants, street food, cloud kitchens, reservations.", flag: "restaurant_marketplace", live: false },
  { icon: ShieldCheck, name: "Food Inspector Platform", desc: "Digital checklists, reports, compliance scoring, badges.", flag: null, live: true },
  { icon: PackageSearch, name: "Procurement Module", desc: "Supplier catalog, group purchasing, wholesale pricing.", flag: "procurement", live: false },
  { icon: Layers, name: "Shared Cooking Engine", desc: "Demand clustering, meal batching, kitchen assignment.", flag: "shared_cooking", live: false },
  { icon: BarChart3, name: "Food Intelligence", desc: "Anonymised demand heatmaps, trends, price intelligence.", flag: "food_intelligence", live: true },
  { icon: Sparkles, name: "AI Platform", desc: "Customer assistant, copilots, forecasting, meal planning.", flag: "ai_assistant", live: true },
];

export function OverviewModule() {
  const { data: platform, isLoading, isError } = usePlatform();
  const seed = useSeed();
  const setActiveModule = useAppStore((s) => s.setActiveModule);

  const kpis = platform?.kpis;
  const flags = useMemo(() => {
    const map = new Map<string, boolean>();
    platform?.featureFlags?.forEach((f) => map.set(f.key, f.enabled));
    return map;
  }, [platform]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border shadow-sm">
        <div className="absolute inset-0">
          <Image src="/images/hero-cooking.png" alt="A cook preparing a vibrant meal" fill priority className="object-cover" sizes="100vw" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/20" />
        </div>
        <div className="relative px-6 py-12 sm:px-10 sm:py-16 lg:px-14 lg:py-20">
          <div className="max-w-2xl">
            <Badge className="mb-4 gap-1 border-white/20 bg-white/10 text-white backdrop-blur">
              <Flame className="h-3 w-3" /> Cooking-as-a-Service
            </Badge>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
              The Food Services <span className="brand-text-gradient">Operating System</span> for Africa
            </h1>
            <p className="mt-4 max-w-xl text-sm text-white/85 sm:text-base">
              Eks-Food connects households with trusted, verified cooks — and builds the digital
              infrastructure for food services across the continent. Procurement, shared cooking,
              marketplaces, inspections, ready meals, and food intelligence, all on one platform.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" onClick={() => setActiveModule("book")} className="gap-2">
                <UtensilsCrossed className="h-4 w-4" /> Book a Cook
              </Button>
              <Button size="lg" variant="secondary" onClick={() => setActiveModule("assistant")} className="gap-2 bg-white/15 text-white backdrop-blur hover:bg-white/25">
                <Sparkles className="h-4 w-4" /> Ask the AI Assistant
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/75">
              <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-3.5 w-3.5" /> Verified cooks</span>
              <span className="inline-flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Payments by Payswap</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Food-safety certified</span>
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Multi-region</span>
            </div>
          </div>
        </div>
      </section>

      {/* Seed banner */}
      {isError && (
        <Card className="mt-6 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="text-sm font-semibold">Platform not seeded yet</div>
              <div className="text-xs text-muted-foreground">Seed the reference deployment to explore all modules end-to-end.</div>
            </div>
            <Button onClick={() => seed.mutate(true)} disabled={seed.isPending}>
              {seed.isPending ? "Seeding…" : "Seed platform"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <section className="mt-8">
        <SectionHeader title="Network at a glance" description="Real-time operational KPIs for the Ghana market." />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard label="Verified cooks" value={kpis?.verifiedCooks} icon={ChefHat} loading={isLoading} sub="Background-checked & rated" />
          <StatCard label="Customers" value={kpis?.customers} icon={Users} loading={isLoading} sub="Active households" />
          <StatCard label="Total bookings" value={kpis?.totalBookings} icon={CalendarCheck} loading={isLoading} sub={`${kpis?.completedBookings ?? 0} completed`} />
          <StatCard label="Gross payment volume" value={kpis ? formatCurrency(kpis.grossPaymentVolume, platform?.organization.currency) : undefined} icon={Banknote} loading={isLoading} sub="Processed via Payswap" />
        </div>
      </section>

      {/* Module grid */}
      <section className="mt-10">
        <SectionHeader
          title="One platform, every food service"
          description="Built modular from day one — future capabilities are enabled by configuration, not rewrites."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => {
            const Icon = m.icon;
            const enabled = m.flag ? flags.get(m.flag) ?? false : m.live;
            return (
              <Card key={m.name} className="group relative overflow-hidden p-4 transition-all hover:shadow-md">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{m.name}</h3>
                      {enabled ? (
                        <Pill className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Live</Pill>
                      ) : (
                        <Pill className="bg-muted text-muted-foreground">Roadmap</Pill>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{m.desc}</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Architecture pillars */}
      <section className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <CardHeader className="p-0">
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" /> Payments, fully delegated</CardTitle>
            <CardDescription className="text-xs">
              Eks-Food never touches card or mobile-money data. Every payment, payout, and refund flows through Payswap — a Stripe-like provider — behind a single abstraction.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 pt-4">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>• Payment intents &amp; hosted checkout sessions</li>
              <li>• Worker payouts via Payswap Transfers</li>
              <li>• Idempotent webhooks &amp; retries</li>
              <li>• Only payment references are stored</li>
            </ul>
          </CardContent>
        </Card>
        <Card className="p-5">
          <CardHeader className="p-0">
            <CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4 text-primary" /> Configurable to the core</CardTitle>
            <CardDescription className="text-xs">
              No hardcoded business rules. Services, pricing, regions, meal categories, tax rules, and feature flags are all admin-configurable data.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 pt-4">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>• Service catalog driven by the database</li>
              <li>• Pricing rules: hourly, surge, tiered, fixed</li>
              <li>• Feature flags gate every new capability</li>
              <li>• Multi-tenant &amp; multi-country ready</li>
            </ul>
          </CardContent>
        </Card>
        <Card className="p-5">
          <CardHeader className="p-0">
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" /> AI-native operations</CardTitle>
            <CardDescription className="text-xs">
              Copilots for every role — customers, cooks, managers, inspectors, admins — plus forecasting and food-intelligence analytics.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 pt-4">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>• Customer meal-planning assistant</li>
              <li>• Cook &amp; manager copilots</li>
              <li>• Demand forecasting &amp; heatmaps</li>
              <li>• Grounded in live platform context</li>
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* Quick start */}
      <section className="mt-10">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-3">
            {[
              { t: "Book a cook", d: "Browse verified cooks, get matched on distance, rating & cuisine, and pay securely via Payswap.", a: "book", label: "Start booking" },
              { t: "Run your kitchen", d: "Cooks see upcoming jobs, earnings, and performance — with payouts processed by Payswap.", a: "cook", label: "Open workspace" },
              { t: "Configure everything", d: "Admins toggle feature flags, add services, and read real-time operational analytics.", a: "admin", label: "Open console" },
            ].map((q) => (
              <button key={q.t} onClick={() => setActiveModule(q.a as any)} className="group flex flex-col gap-2 border-border p-6 text-left transition-colors hover:bg-muted/50 lg:border-l first:border-l-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{q.t}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </div>
                <p className="text-xs text-muted-foreground">{q.d}</p>
                <span className="mt-1 text-xs font-medium text-primary">{q.label} →</span>
              </button>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
