"use client";

import { MapPin, Star, Calendar, UtensilsCrossed, Wallet, Languages, Heart } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { MatchedCook } from "@/lib/api";

const DIMENSIONS: { key: keyof MatchedCook["breakdown"]; label: string; icon: typeof MapPin }[] = [
  { key: "distance", label: "Distance", icon: MapPin },
  { key: "rating", label: "Rating", icon: Star },
  { key: "availability", label: "Availability", icon: Calendar },
  { key: "cuisine", label: "Cuisine fit", icon: UtensilsCrossed },
  { key: "price", label: "Price", icon: Wallet },
  { key: "language", label: "Language", icon: Languages },
  { key: "preference", label: "Preference", icon: Heart },
];

export function MatchBreakdown({ cook, compact }: { cook: MatchedCook; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-2" : "space-y-2.5"}>
      {DIMENSIONS.map((d) => {
        const value = cook.breakdown[d.key];
        const Icon = d.icon;
        return (
          <div key={d.key} className="flex items-center gap-2.5">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{d.label}</span>
            <Progress value={value * 100} className="h-1.5 flex-1" />
            <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums">{Math.round(value * 100)}</span>
          </div>
        );
      })}
    </div>
  );
}
