"use client";

import { Home, Heart, ShoppingBag, Calendar, Utensils, Star, Database } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `failed`);
  return (data as { data?: T }).data ?? (data as T);
}

/* ============ Customer Dashboard ============ */
export function CustomerDashboardView() {
  const { data: households } = useQuery({ queryKey: ["cust-households"], queryFn: () => api<unknown[]>("/api/v1/customer/households") });
  const { data: reviews } = useQuery({ queryKey: ["cust-reviews"], queryFn: () => api<unknown[]>("/api/v1/customer/reviews") });
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Customer Dashboard" description="Households, preferences, meal plans, pantry, shopping, favorites, and reviews." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini icon={Home} label="Households" value={Array.isArray(households) ? households.length : "—"} />
        <Mini icon={ShoppingBag} label="Shopping Lists" value="—" />
        <Mini icon={Calendar} label="Meal Plans" value="—" />
        <Mini icon={Star} label="Reviews" value={Array.isArray(reviews) ? reviews.length : "—"} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Home className="h-4 w-4 text-primary" /> Households</h3>
          {households && Array.isArray(households) && households.length > 0 ? (
            <div className="mt-3 space-y-2">
              {(households as readonly Record<string, unknown>[]).slice(0, 5).map((h, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{String(h.name ?? "Unnamed")}</div><div className="text-[11px] text-muted-foreground">{(h._count as Record<string, number>)?.members ?? 0} members</div></div>
                </div>
              ))}
            </div>
          ) : <p className="mt-3 text-xs text-muted-foreground">No households. Seed the customer platform.</p>}
        </Card>
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Star className="h-4 w-4 text-primary" /> Recent Reviews</h3>
          {reviews && Array.isArray(reviews) && reviews.length > 0 ? (
            <div className="mt-3 space-y-2">
              {(reviews as readonly Record<string, unknown>[]).slice(0, 5).map((r, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
                  <Badge variant="outline" className="text-[10px]">{String(r.rating)}★</Badge>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{String(r.title ?? r.comment ?? "Review")}</div><div className="text-[11px] text-muted-foreground">{String(r.entityType)}</div></div>
                </div>
              ))}
            </div>
          ) : <p className="mt-3 text-xs text-muted-foreground">No reviews yet.</p>}
        </Card>
      </div>
    </div>
  );
}

/* ============ Household Manager ============ */
export function HouseholdManagerView() {
  const { data, isLoading } = useQuery({ queryKey: ["cust-households-full"], queryFn: () => api<unknown[]>("/api/v1/customer/households") });
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Household Manager" description="Household profiles, members, relationships, permissions." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(data as readonly Record<string, unknown>[]).map((h, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-sm font-bold">{String(h.name ?? "Unnamed")}</div></div>
              <Badge variant="outline" className="text-[10px]">{(h._count as Record<string, number>)?.members ?? 0} members</Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Preference Center ============ */
export function PreferenceCenterView() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Preference Center" description="Food preferences, cuisines, ingredients, spice levels, dietary profiles." />
      <Card className="p-6 text-center text-sm text-muted-foreground">
        <Heart className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
        Preferences are managed per customer profile. Use the API to set cuisine and ingredient preferences.
      </Card>
    </div>
  );
}

/* ============ Pantry Dashboard ============ */
export function PantryDashboardView() {
  const { data, isLoading } = useQuery({ queryKey: ["cust-pantry"], queryFn: () => api<unknown[]>("/api/v1/customer/pantry?householdId=demo") });
  if (isLoading) return <LoadingGrid />;
  const items = (data ?? []) as readonly Record<string, unknown>[];
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Pantry Dashboard" description="Household pantry items, expiration tracking, consumption history." />
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {items.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No pantry items.</div>}
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Utensils className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{String(item.name ?? "Unknown")}</div><div className="text-[11px] text-muted-foreground">{String(item.quantity ?? 0)} {String(item.unit ?? "")}</div></div>
              <Badge className={String(item.status) === "IN_STOCK" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : String(item.status) === "EXPIRING" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : String(item.status) === "EXPIRED" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-muted"}>{String(item.status ?? "UNKNOWN")}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Shopping Lists ============ */
export function ShoppingListsView() {
  const { data, isLoading } = useQuery({ queryKey: ["cust-shopping"], queryFn: () => api<unknown[]>("/api/v1/customer/shopping?householdId=demo") });
  if (isLoading) return <LoadingGrid />;
  const lists = (data ?? []) as readonly Record<string, unknown>[];
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Shopping Lists" description="Collaborative household shopping lists with completion tracking." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lists.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground col-span-full">No shopping lists.</Card>}
        {lists.map((list, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-sm font-bold">{String(list.name ?? "Unnamed")}</div></div>
              <Badge variant="outline" className="text-[10px]">{String(list.status ?? "ACTIVE")}</Badge>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">{(list._count as Record<string, number>)?.items ?? 0} items</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Meal Planner ============ */
export function MealPlannerView() {
  const { data, isLoading } = useQuery({ queryKey: ["cust-meal-plans"], queryFn: () => api<unknown[]>("/api/v1/customer/meal-plans?householdId=demo") });
  if (isLoading) return <LoadingGrid />;
  const plans = (data ?? []) as readonly Record<string, unknown>[];
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Meal Planner" description="Weekly/monthly meal plans, meal calendar, special occasions." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plans.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground col-span-full">No meal plans.</Card>}
        {plans.map((plan, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-sm font-bold">{String(plan.name ?? "Unnamed")}</div><div className="text-[11px] text-muted-foreground">{String(plan.type ?? "WEEKLY")}</div></div>
              <Badge variant="outline" className="text-[10px]">{String(plan.status ?? "DRAFT")}</Badge>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">{(plan._count as Record<string, number>)?.calendar ?? 0} meals planned</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Shared ============ */
function Header({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h2><p className="mt-0.5 text-sm text-muted-foreground">{description}</p></div>;
}
function LoadingGrid() {
  return <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 rounded-xl" /></div>;
}
function Mini({ icon: Icon, label, value }: { icon: typeof Home; label: string; value: React.ReactNode }) {
  return <Card className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></div><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div></div></Card>;
}
