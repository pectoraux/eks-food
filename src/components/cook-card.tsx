"use client";

import Image from "next/image";
import { MapPin, Clock, BadgeCheck, Languages, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RatingStars, Pill } from "@/components/shared";
import { formatCurrency } from "@/lib/format";
import type { MatchedCook } from "@/lib/api";

export function CookCard({ cook, onSelect, onBook }: { cook: MatchedCook; onSelect?: () => void; onBook?: () => void }) {
  return (
    <Card className="group flex flex-col overflow-hidden transition-all hover:shadow-md">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {cook.avatarUrl ? (
          <Image src={cook.avatarUrl} alt={cook.name} fill className="object-cover transition-transform duration-300 group-hover:scale-105" sizes="(max-width: 768px) 100vw, 33vw" />
        ) : null}
        <div className="absolute left-2 top-2 flex gap-1.5">
          <Pill className="bg-emerald-500 text-white shadow"><BadgeCheck className="h-3 w-3" /> Verified</Pill>
          {cook.score >= 0.85 && <Pill className="bg-primary text-primary-foreground shadow">Top match</Pill>}
        </div>
        <div className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
          {Math.round(cook.score * 100)}% match
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{cook.name}</h3>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              <span className="font-medium text-foreground">{cook.rating.toFixed(1)}</span>
              <span>· {cook.completedJobs} jobs</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold">{formatCurrency(cook.hourlyRate, cook.currency)}<span className="text-xs font-normal text-muted-foreground">/hr</span></div>
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{cook.bio}</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {cook.cuisines.slice(0, 3).map((c) => (
            <Pill key={c} className="bg-primary/10 text-primary">{c}</Pill>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {cook.distanceKm} km</span>
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> ~{cook.responseTimeMins}m reply</span>
          {cook.languages.length > 0 && (
            <span className="inline-flex items-center gap-1"><Languages className="h-3 w-3" /> {cook.languages.join("/")}</span>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          {onSelect && <Button variant="outline" size="sm" className="flex-1" onClick={onSelect}>View profile</Button>}
          {onBook && <Button size="sm" className="flex-1" onClick={onBook}>Book</Button>}
        </div>
      </div>
    </Card>
  );
}
