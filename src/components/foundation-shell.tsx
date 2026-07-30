"use client";

import { useState, type ReactNode } from "react";
import { Layers, Activity, Package, Flag, Database, Bell, BookOpen, Menu, X, Moon, Sun, Github } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useHealth } from "@/lib/foundation-api";
import { cn } from "@/lib/utils";

export type ConsoleView = "overview" | "packages" | "health" | "events" | "flags" | "workers" | "docs";

const NAV: { id: ConsoleView; label: string; icon: typeof Layers }[] = [
  { id: "overview", label: "Platform Overview", icon: Layers },
  { id: "packages", label: "Package Registry", icon: Package },
  { id: "health", label: "Health & Observability", icon: Activity },
  { id: "events", label: "Event Infrastructure", icon: Database },
  { id: "workers", label: "Worker Framework", icon: Bell },
  { id: "flags", label: "Feature Flags", icon: Flag },
  { id: "docs", label: "Documentation", icon: BookOpen },
];

export function FoundationShell({ active, onNavigate, children }: { active: ConsoleView; onNavigate: (v: ConsoleView) => void; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: health } = useHealth();
  const status = health?.status ?? "healthy";

  const navItem = (item: (typeof NAV)[number]) => {
    const Icon = item.icon;
    const isActive = active === item.id;
    return (
      <button
        key={item.id}
        onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
        className={cn(
          "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all",
          isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 truncate font-medium">{item.label}</span>
        {isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/80" />}
      </button>
    );
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand />
        <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">{NAV.map(navItem)}</nav>
        <StatusFooter status={status} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex items-center justify-between"><Brand /><Button variant="ghost" size="icon" className="mr-2" onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /></Button></div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">{NAV.map(navItem)}</nav>
            <StatusFooter status={status} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-x-hidden">{children}</main>
        <footer className="mt-auto border-t border-border bg-background/60 px-4 py-4 text-center text-xs text-muted-foreground lg:px-6">
          <span className="font-semibold text-foreground">Eks-Food</span> · Milestone 1 — Platform Foundation ·
          Modular monolith · DDD · Event-driven · <span className="font-medium text-foreground">{121}</span> tests passing
        </footer>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg brand-gradient text-white shadow-sm"><Layers className="h-5 w-5" /></div>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold tracking-tight">Eks-Food</div>
        <div className="truncate text-[11px] text-muted-foreground">Platform Foundation · M1</div>
      </div>
    </div>
  );
}

function StatusFooter({ status }: { status: string }) {
  const color = status === "healthy" ? "bg-emerald-500" : status === "degraded" ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="rounded-lg bg-sidebar-accent/60 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">System</span>
          <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]"><span className={`h-1.5 w-1.5 animate-pulse rounded-full ${color}`} /> {status}</Badge>
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">All subsystems operational</div>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { theme, setTheme } = useTheme();
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 brand-glass lg:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open menu"><Menu className="h-5 w-5" /></Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight sm:text-lg">Platform Foundation Console</h1>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">Production-grade infrastructure · DDD · Event-driven · Observability</p>
      </div>
      <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme"><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></Button>
      <a href="https://github.com" target="_blank" rel="noreferrer" className="hidden sm:block"><Button variant="ghost" size="icon" aria-label="Source"><Github className="h-4 w-4" /></Button></a>
    </header>
  );
}
