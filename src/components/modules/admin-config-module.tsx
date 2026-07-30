"use client";

import { useState } from "react";
import {
  Settings2, Plus, Flag, Tags, MapPin, DollarSign, Server, ShieldAlert,
  Loader2, Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminConfig, useToggleFlag, useCreateService, type FeatureFlag } from "@/lib/api";
import { SectionHeader, Pill, EmptyState } from "@/components/shared";
import { formatCurrency, titleCase } from "@/lib/format";
import { toast } from "sonner";

const FLAG_LABELS: Record<string, { label: string; desc: string }> = {
  ai_assistant: { label: "AI Assistant", desc: "Role-aware copilots across the platform." },
  group_purchasing: { label: "Group Purchasing", desc: "Households band together for wholesale ingredient prices." },
  shared_cooking: { label: "Shared Cooking", desc: "Demand clustering & meal batching across kitchens." },
  restaurant_marketplace: { label: "Restaurant Marketplace", desc: "Restaurants, cloud kitchens & reservations." },
  ready_meals: { label: "Ready Meals", desc: "Pre-cooked meal delivery from central kitchens." },
  procurement: { label: "Procurement", desc: "Supplier catalog & wholesale ingredient ordering." },
  food_intelligence: { label: "Food Intelligence", desc: "Anonymised demand heatmaps, trends & price analytics." },
};

export function AdminConfigModule() {
  const { data, isLoading } = useAdminConfig();
  const toggle = useToggleFlag();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
      <SectionHeader
        title="Admin Console"
        description="Everything is configurable — no hardcoded business rules. New capabilities ship as data."
        action={
          <Button className="gap-2" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New service</Button>
        }
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-64 rounded-xl" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Feature flags */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Flag className="h-4 w-4 text-primary" /> Feature flags</CardTitle>
              <CardDescription className="text-xs">Gate every roadmap capability. Enabling a flag turns on a module — no deployment required.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {data.featureFlags.map((f) => {
                const meta = FLAG_LABELS[f.key] ?? { label: f.key, desc: "Custom capability." };
                return (
                  <div key={f.key} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{meta.label}</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{f.key}</code>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{meta.desc}</p>
                    </div>
                    <Switch
                      checked={f.enabled}
                      disabled={toggle.isPending}
                      onCheckedChange={async (checked) => {
                        try {
                          await toggle.mutateAsync({ key: f.key, enabled: checked });
                          toast.success(`${meta.label} ${checked ? "enabled" : "disabled"}`);
                        } catch {
                          toast.error("Could not update flag");
                        }
                      }}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Services */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Server className="h-4 w-4 text-primary" /> Service catalog</CardTitle>
                <CardDescription className="text-xs">Services are database records — add new ones without code changes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.services.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{s.name}</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{s.code}</code>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{s.description}</p>
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>{formatCurrency(s.basePrice, s.currency)} base</span>
                        <span>· {s.estimatedMins}min</span>
                      </div>
                    </div>
                    <Badge variant={s.active ? "default" : "secondary"}>{s.active ? "Active" : "Inactive"}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Pricing rules */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><DollarSign className="h-4 w-4 text-primary" /> Pricing rules</CardTitle>
                <CardDescription className="text-xs">Hourly, surge, tiered & fixed rules — composable per service.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.pricingRules.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{r.name}</span>
                      <div className="flex items-center gap-2">
                        <Pill className="bg-primary/10 text-primary">{titleCase(r.kind)}</Pill>
                        <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "On" : "Off"}</Badge>
                      </div>
                    </div>
                    <pre className="mt-1.5 overflow-x-auto rounded bg-muted/60 p-2 text-[10px] leading-relaxed text-muted-foreground scrollbar-thin">{JSON.stringify(r.config, null, 2)}</pre>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Meal categories */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Tags className="h-4 w-4 text-primary" /> Meal categories</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.mealCategories.map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs">
                    <span>{c.icon}</span>
                    <span className="font-medium capitalize">{c.name}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Regions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-primary" /> Regions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.regions.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-2.5">
                    <div>
                      <span className="text-sm font-medium">{r.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{r.country}</span>
                    </div>
                    <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Active" : "Inactive"}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Audit note */}
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="flex items-start gap-3 p-4">
              <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <div className="text-sm font-semibold">Every change is audited</div>
                <p className="mt-0.5 text-xs text-muted-foreground">All admin actions — flag toggles, service creation, pricing changes — are written to the audit log with actor, timestamp & diff. Multi-tenant isolation is enforced at the organisation layer.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <CreateServiceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function CreateServiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateService();
  const [form, setForm] = useState({ code: "", name: "", description: "", basePrice: 100, estimatedMins: 120, active: true });

  const submit = async () => {
    if (!form.code || !form.name) {
      toast.error("Code and name are required");
      return;
    }
    try {
      await create.mutateAsync(form);
      toast.success("Service created", { description: `${form.name} added to the catalog.` });
      setForm({ code: "", name: "", description: "", basePrice: 100, estimatedMins: 120, active: true });
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not create service", { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Create a new service</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Code</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="PRIVATE_CHEF" />
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Private Chef Night" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="A private chef experience for special occasions." rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Base price (GHS)</Label>
              <Input type="number" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">Estimated minutes</Label>
              <Input type="number" value={form.estimatedMins} onChange={(e) => setForm({ ...form, estimatedMins: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label className="text-xs">Active immediately</Label>
            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending} className="gap-2">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create service
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
