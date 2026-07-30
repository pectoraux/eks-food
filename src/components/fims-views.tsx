"use client";

import { useState } from "react";
import { Database, Calculator, Ruler, Trash2, Package, Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalogSearch, useWasteRecords, useScaleRecipe, useConvertMeasurement, useCalculateNutrition, useMeasurementUnits } from "@/lib/fims-api";
import { toast } from "sonner";

const ITEM_TYPES = ["INGREDIENT", "PREPARED_FOOD", "BEVERAGE", "PACKAGED", "MEAL_KIT", "SPICE", "CONDIMENT", "ADDITIVE", "ALLERGEN"];

/* ============ Catalog Explorer ============ */
export function CatalogExplorerView() {
  const [q, setQ] = useState("");
  const [itemType, setItemType] = useState("ALL");
  const { data, isLoading } = useCatalogSearch(q || undefined, itemType === "ALL" ? undefined : itemType);
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Catalog Explorer" description="Browse canonical food catalog items — ingredients, prepared foods, beverages, spices." />
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search catalog…" className="flex-1" />
        <Select value={itemType} onValueChange={setItemType}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All types</SelectItem>{ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
      </div>
      {isLoading && <Skeleton className="h-64" />}
      {data && data.items.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="truncate text-sm font-bold">{item.name}</div><code className="text-[10px] text-muted-foreground">{item.code}</code></div>
                <Badge variant="outline" className="text-[10px]">{item.itemType}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.barcode && <Badge variant="secondary" className="text-[9px]">{item.barcode}</Badge>}
                {item.sku && <Badge variant="secondary" className="text-[9px]">{item.sku}</Badge>}
                <Badge variant="outline" className="text-[9px]">{item._count.nutritionFacts} nutrition</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
      {data && data.items.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">No catalog items found. Seed FIMS first.</Card>}
    </div>
  );
}

/* ============ Recipe Debugger ============ */
export function RecipeDebuggerView() {
  const scale = useScaleRecipe();
  const [servings, setServings] = useState("10");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const testScale = async () => {
    try {
      const r = await scale.mutateAsync({
        recipeId: "demo",
        originalServings: 4,
        targetServings: Number(servings),
        ingredients: [
          { ingredientId: "rice", name: "Long Grain Rice", quantity: 500, unit: "g" },
          { ingredientId: "tomato", name: "Fresh Tomatoes", quantity: 400, unit: "g" },
          { ingredientId: "oil", name: "Vegetable Oil", quantity: 50, unit: "ml" },
        ],
      });
      setResult(r as Record<string, unknown>);
      toast.success(`Scaled to ${servings} servings`);
    } catch (e) { toast.error("Scaling failed", { description: e instanceof Error ? e.message : undefined }); }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Recipe Debugger" description="Inspect recipe calculations, scaling, dependencies, nutrition." />
      <Card className="p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Calculator className="h-4 w-4 text-primary" /> Recipe Scaling</h3>
        <p className="mt-1 text-xs text-muted-foreground">Scale a 4-serving Jollof Rice recipe to any serving count.</p>
        <div className="mt-3 flex items-end gap-2">
          <div><Label>Target servings</Label><Input value={servings} onChange={(e) => setServings(e.target.value)} type="number" className="w-32" /></div>
          <Button onClick={testScale} disabled={scale.isPending} className="gap-2">{scale.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Scale recipe</Button>
        </div>
      </Card>
      {result && <Card className="p-4"><h3 className="text-sm font-semibold mb-2">Scaled result</h3><pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-xs scrollbar-thin">{JSON.stringify(result, null, 2)}</pre></Card>}
    </div>
  );
}

/* ============ Measurement Converter ============ */
export function MeasurementConverterView() {
  const { data: units } = useMeasurementUnits();
  const convert = useConvertMeasurement();
  const [value, setValue] = useState("100");
  const [from, setFrom] = useState("g");
  const [to, setTo] = useState("oz");
  const [ingredient, setIngredient] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const doConvert = async () => {
    try {
      const r = await convert.mutateAsync({ value: Number(value), from, to, ingredient: ingredient || undefined });
      setResult(r as Record<string, unknown>);
      toast.success("Converted");
    } catch (e) { toast.error("Conversion failed", { description: e instanceof Error ? e.message : undefined }); }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Measurement Converter" description="Metric, imperial, volume, weight, count. Density-aware conversions." />
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><Label>Value</Label><Input value={value} onChange={(e) => setValue(e.target.value)} type="number" /></div>
          <div><Label>From</Label><Select value={from} onValueChange={setFrom}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{units?.map((u) => <SelectItem key={u.code} value={u.code}>{u.code}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>To</Label><Select value={to} onValueChange={setTo}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{units?.map((u) => <SelectItem key={u.code} value={u.code}>{u.code}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Ingredient (density)</Label><Input value={ingredient} onChange={(e) => setIngredient(e.target.value)} placeholder="water, oil, flour" /></div>
        </div>
        <Button onClick={doConvert} disabled={convert.isPending} className="mt-3 gap-2">{convert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ruler className="h-4 w-4" />} Convert</Button>
      </Card>
      {result && <Card className="p-4"><pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-xs scrollbar-thin">{JSON.stringify(result, null, 2)}</pre></Card>}
    </div>
  );
}

/* ============ Waste Dashboard ============ */
export function WasteDashboardView() {
  const { data, isLoading } = useWasteRecords();
  if (isLoading || !data) return <LoadingGrid />;
  const totalWaste = data.reduce((s, w) => s + w.quantity, 0);
  const byType: Record<string, number> = {};
  for (const w of data) byType[w.type] = (byType[w.type] ?? 0) + w.quantity;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Waste Dashboard" description="Track spoilage, preparation waste, overproduction, expired inventory." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini label="Total waste" value={`${totalWaste}g`} />
        <Mini label="Records" value={data.length} />
        <Mini label="Waste types" value={Object.keys(byType).length} />
        <Mini label="Top type" value={Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"} />
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {data.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No waste records.</div>}
          {data.map((w) => (
            <div key={w.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"><Trash2 className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{w.type}</div><div className="text-[11px] text-muted-foreground">{w.quantity}{w.unit} · {w.reason ?? "no reason"} · {new Date(w.createdAt).toLocaleString()}</div></div>
            </div>
          ))}
        </div>
      </Card>
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
function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return <Card className="p-4"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></Card>;
}
