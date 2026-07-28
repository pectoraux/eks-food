"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import {
  Search, SlidersHorizontal, MapPin, Star, BadgeCheck, Clock, Languages,
  Calendar, Users, ChefHat, FileText, Sparkles, CheckCircle2, ArrowRight,
  Loader2, Wallet, History, ShieldCheck, Award,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useCooks, usePlatform, useCreateBooking, useBookings, type MatchedCook, type BookingResult } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { CookCard } from "@/components/cook-card";
import { MatchBreakdown } from "@/components/match-breakdown";
import { CheckoutDialog } from "@/components/checkout-dialog";
import { SectionHeader, RatingStars, Pill, EmptyState } from "@/components/shared";
import { formatCurrency, formatCurrencyPrecise, formatDateTime, statusClass, titleCase } from "@/lib/format";
import { toast } from "sonner";

export function BookACookModule() {
  const { data: platform } = usePlatform();
  const draft = useAppStore((s) => s.bookingDraft);
  const setDraft = useAppStore((s) => s.setBookingDraft);

  const [query, setQuery] = useState("");
  const [cuisine, setCuisine] = useState<string>("ghanaian");
  const [region, setRegion] = useState<string>("");
  const [maxRate, setMaxRate] = useState<number>(80);
  const [profileCook, setProfileCook] = useState<MatchedCook | null>(null);

  const [result, setResult] = useState<BookingResult | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const cooksQ = useCooks({
    lat: draft.lat, lng: draft.lng, cuisine: cuisine || undefined,
    region: region || undefined, maxRate, q: query || undefined, limit: 24,
  });

  const createBooking = useCreateBooking();
  const { data: bookingsData, isLoading: bookingsLoading } = useBookings();

  const services = platform?.services ?? [];
  const mealCats = platform?.mealCategories ?? [];
  const regions = platform?.regions ?? [];

  const handleCreate = async () => {
    if (!draft.serviceCode || !draft.scheduledFor) {
      toast.error("Please choose a service and a date/time.");
      return;
    }
    try {
      const r = await createBooking.mutateAsync({
        serviceCode: draft.serviceCode,
        bookingType: draft.bookingType ?? "SCHEDULED",
        scheduledFor: new Date(draft.scheduledFor).toISOString(),
        durationMins: draft.durationMins ?? 120,
        partySize: draft.partySize ?? 4,
        addressLine1: draft.addressLine1 ?? "",
        city: draft.city ?? "Accra",
        region: draft.region ?? "East Legon",
        lat: draft.lat ?? 5.645,
        lng: draft.lng ?? -0.181,
        notes: draft.notes,
        cuisines: draft.cuisines,
        languages: draft.languages,
        autoAssign: true,
        customerName: "Abena Boateng",
        customerEmail: "abena@household.com",
      });
      setResult(r);
      toast.success("Booking created", { description: `${r.code} · ${r.assignment.assigned ? "Cook assigned" : "Awaiting match"}` });
      setTimeout(() => document.getElementById("booking-result")?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    } catch (e) {
      toast.error("Could not create booking", { description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        {/* Left: filters + cook grid */}
        <div className="min-w-0">
          <SectionHeader
            title="Find your cook"
            description="Matched on distance, rating, availability, cuisine, price, language & your preferences."
          />

          {/* Filter bar */}
          <Card className="mb-4 p-3 sm:p-4">
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search cooks, cuisines, skills…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                {mealCats.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCuisine(cuisine === c.name ? "" : c.name)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${cuisine === c.name ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                  >
                    <span className="mr-1">{c.icon}</span>{c.name}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Region</Label>
                  <Select value={region || "all"} onValueChange={(v) => setRegion(v === "all" ? "" : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="All regions" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All regions</SelectItem>
                      {regions.map((r) => <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Max hourly rate</Label>
                    <span className="text-xs font-medium">{formatCurrency(maxRate, platform?.organization.currency)}<span className="text-muted-foreground">/hr</span></span>
                  </div>
                  <Slider value={[maxRate]} onValueChange={(v) => setMaxRate(v[0])} min={30} max={120} step={5} className="py-1" />
                </div>
              </div>
            </div>
          </Card>

          {/* Cook grid */}
          {cooksQ.isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-xl" />)}
            </div>
          ) : cooksQ.data && cooksQ.data.cooks.length > 0 ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{cooksQ.data.total} cook{cooksQ.data.total !== 1 ? "s" : ""} matched · ranked by fit</p>
                {cooksQ.data.matched && <Badge variant="secondary" className="gap-1 text-[10px]"><Sparkles className="h-3 w-3" /> Smart match</Badge>}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cooksQ.data.cooks.map((c) => (
                  <CookCard key={c.cookId} cook={c} onSelect={() => setProfileCook(c)} onBook={() => { setProfileCook(null); document.getElementById("booking-form")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />
                ))}
              </div>
            </>
          ) : (
            <EmptyState icon={ChefHat} title="No cooks match your filters" description="Try widening your rate range or choosing a different cuisine." />
          )}
        </div>

        {/* Right: booking form + result */}
        <div className="space-y-4">
          <Card id="booking-form" className="overflow-hidden">
            <CardHeader className="border-b border-border bg-muted/30 py-3">
              <CardTitle className="flex items-center gap-2 text-sm"><Calendar className="h-4 w-4 text-primary" /> Booking details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">Service</Label>
                <Select value={draft.serviceCode} onValueChange={(v) => setDraft({ serviceCode: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {services.map((s) => <SelectItem key={s.code} value={s.code}>
                      <span className="font-medium">{s.name}</span> <span className="text-xs text-muted-foreground">· {formatCurrency(s.basePrice, s.currency)}+</span>
                    </SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">Date & time</Label>
                <Input type="datetime-local" value={draft.scheduledFor} onChange={(e) => setDraft({ scheduledFor: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Party size</Label>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => setDraft({ partySize: Math.max(1, (draft.partySize ?? 4) - 1) })}><Users className="h-3.5 w-3.5" /></Button>
                    <div className="flex-1 text-center text-sm font-semibold">{draft.partySize}</div>
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => setDraft({ partySize: Math.min(50, (draft.partySize ?? 4) + 1) })}><Users className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Duration (min)</Label>
                  <Select value={String(draft.durationMins)} onValueChange={(v) => setDraft({ durationMins: Number(v) })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[60, 90, 120, 180, 240, 300].map((m) => <SelectItem key={m} value={String(m)}>{m} min</SelectItem>)}
                  </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">Address</Label>
                <Input value={draft.addressLine1} onChange={(e) => setDraft({ addressLine1: e.target.value })} placeholder="Street address" />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">Notes for the cook (optional)</Label>
                <Input value={draft.notes ?? ""} onChange={(e) => setDraft({ notes: e.target.value })} placeholder="Allergies, preferences, gate code…" />
              </div>
              <Button className="w-full gap-2" onClick={handleCreate} disabled={createBooking.isPending}>
                {createBooking.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Create booking & match
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">No charge until you confirm on Payswap.</p>
            </CardContent>
          </Card>

          {/* Result */}
          {result && (
            <Card id="booking-result" className="overflow-hidden border-primary/40">
              <CardHeader className="border-b border-border bg-emerald-50 py-3 dark:bg-emerald-950/30">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <CardTitle className="text-sm">Booking {result.code} created</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Service</div>
                    <div className="font-medium">{result.service.name}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">When</div>
                    <div className="font-medium">{formatDateTime(result.scheduledFor)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</div>
                    <Badge className={statusClass(result.status)}>{titleCase(result.status)}</Badge>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Quoted price</div>
                    <div className="font-bold text-primary">{formatCurrencyPrecise(result.quotedPrice, result.currency)}</div>
                  </div>
                </div>

                {result.assignment.assigned && result.candidates[0] && (
                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold">Auto-assigned cook</span>
                      <Badge className="bg-primary/10 text-primary">{Math.round((result.assignment.matchScore ?? 0) * 100)}% match</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-muted">
                        {result.candidates[0].avatarUrl && <Image src={result.candidates[0].avatarUrl} alt={result.candidates[0].name} fill className="object-cover" sizes="44px" />}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{result.candidates[0].name}</div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          {result.candidates[0].rating} · {result.candidates[0].distanceKm} km
                        </div>
                      </div>
                    </div>
                    <div className="mt-3">
                      <MatchBreakdown cook={result.candidates[0]} compact />
                    </div>
                  </div>
                )}

                {/* Payswap payment CTA */}
                <div className="rounded-lg bg-muted/60 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold"><Wallet className="h-3.5 w-3.5 text-primary" /> Payment via Payswap</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">Confirm to authorise {formatCurrencyPrecise(result.quotedPrice, result.currency)} on Payswap&rsquo;s secure page. The cook receives 80% via Payswap Transfer on success.</p>
                  <Button className="mt-3 w-full gap-2" onClick={() => setCheckoutOpen(true)}>
                    Pay {formatCurrencyPrecise(result.quotedPrice, result.currency)} with Payswap <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Recent bookings */}
      <section className="mt-10">
        <SectionHeader title="Recent bookings" description="All bookings across the organisation." />
        <Card className="overflow-hidden">
          {bookingsLoading ? (
            <div className="p-4"><Skeleton className="h-24 w-full" /></div>
          ) : bookingsData && bookingsData.bookings.length > 0 ? (
            <div className="divide-y divide-border">
              {bookingsData.bookings.slice(0, 8).map((b) => (
                <div key={b.code} className="flex items-center gap-3 p-3 sm:p-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {b.cook ? <ChefHat className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{b.code}</span>
                      <Badge className={statusClass(b.status)} variant="outline">{titleCase(b.status)}</Badge>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {b.service.name} · {b.cook ? b.cook.name : "Awaiting cook"} · {formatDateTime(b.scheduledFor)}
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold">{formatCurrency(b.quotedPrice, b.currency)}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={History} title="No bookings yet" description="Create your first booking above." />
          )}
        </Card>
      </section>

      {/* Cook profile dialog */}
      <CookProfileDialog cook={profileCook} onClose={() => setProfileCook(null)} />

      {/* Payswap checkout */}
      {result && (
        <CheckoutDialog
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          bookingCode={result.code}
          amount={result.quotedPrice}
          currency={result.currency}
          customerEmail="abena@household.com"
          onPaid={() => {
            toast.success("Booking confirmed", { description: "Your cook is booked. Check your messages for details." });
            setResult(null);
          }}
        />
      )}
    </div>
  );
}

function CookProfileDialog({ cook, onClose }: { cook: MatchedCook | null; onClose: () => void }) {
  return (
    <Dialog open={!!cook} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto scrollbar-thin">
        {cook && (
          <>
            <div className="relative -mx-6 -mt-6 h-40 overflow-hidden">
              {cook.avatarUrl && <Image src={cook.avatarUrl} alt={cook.name} fill className="object-cover" sizes="100vw" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <DialogHeader className="absolute bottom-0 left-0 right-0 p-4 text-white">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-emerald-400" />
                  <span className="text-[11px] font-medium uppercase tracking-wide">Verified cook</span>
                </div>
                <DialogTitle className="text-xl text-white">{cook.name}</DialogTitle>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-white/85">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  <span>{cook.rating} · {cook.completedJobs} jobs · {cook.responseTimeMins}m reply</span>
                </div>
              </DialogHeader>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{cook.bio}</p>

              <div className="flex flex-wrap gap-1.5">
                {cook.cuisines.map((c) => <Pill key={c} className="bg-primary/10 text-primary capitalize">{c}</Pill>)}
                {cook.skills.map((s) => <Pill key={s} className="bg-muted text-muted-foreground capitalize">{s.replace("_", " ")}</Pill>)}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Rate</div>
                  <div className="text-sm font-bold">{formatCurrency(cook.hourlyRate, cook.currency)}</div>
                </div>
                <div className="rounded-lg border border-border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Distance</div>
                  <div className="text-sm font-bold">{cook.distanceKm} km</div>
                </div>
                <div className="rounded-lg border border-border p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Match</div>
                  <div className="text-sm font-bold text-primary">{Math.round(cook.score * 100)}%</div>
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold">Why this cook matches you</div>
                <MatchBreakdown cook={cook} />
              </div>

              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                Background-checked · Food-safety certified · Insured
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
