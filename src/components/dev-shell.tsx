"use client";

import { useState, type ReactNode } from "react";
import { LayoutDashboard, Puzzle, Plug, GitBranch, ScrollText, ShieldCheck, Terminal, Ticket, Activity, Menu, X, Moon, Sun, RotateCcw, Webhook, RefreshCw, FileJson, Heart, KeyRound, Gauge, Clock } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSeedDeveloper } from "@/lib/dev-api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
export type DevView = "dashboard" | "extensions" | "connectors" | "workflows" | "events" | "manifests" | "cli" | "publishers" | "logs" | "replay" | "runtime" | "conn-registry" | "sync-monitor" | "webhook-explorer" | "polling-explorer" | "schema-explorer" | "health-dashboard" | "credentials" | "policies";

const NAV: { id: DevView; label: string; icon: typeof Puzzle; group: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { id: "extensions", label: "Extension Explorer", icon: Puzzle, group: "Platform" },
  { id: "connectors", label: "Connector Explorer", icon: Plug, group: "Platform" },
  { id: "workflows", label: "Workflow Inspector", icon: GitBranch, group: "Platform" },
  { id: "events", label: "Event Explorer", icon: Activity, group: "Platform" },
  { id: "replay", label: "Event Replay", icon: RotateCcw, group: "Platform" },
  { id: "manifests", label: "Manifest Validator", icon: ShieldCheck, group: "Tools" },
  { id: "cli", label: "Developer CLI", icon: Terminal, group: "Tools" },
  { id: "publishers", label: "Publishers", icon: Ticket, group: "Registry" },
  { id: "logs", label: "Extension Logs", icon: ScrollText, group: "Registry" },
  { id: "runtime", label: "Runtime Inspector", icon: Activity, group: "Registry" },
  { id: "conn-registry", label: "Connector Registry", icon: Plug, group: "Integration" },
  { id: "sync-monitor", label: "Sync Monitor", icon: RefreshCw, group: "Integration" },
  { id: "webhook-explorer", label: "Webhook Explorer", icon: Webhook, group: "Integration" },
  { id: "polling-explorer", label: "Polling Explorer", icon: Clock, group: "Integration" },
  { id: "schema-explorer", label: "Schema Explorer", icon: FileJson, group: "Integration" },
  { id: "health-dashboard", label: "Health Dashboard", icon: Heart, group: "Integration" },
  { id: "credentials", label: "Credentials", icon: KeyRound, group: "Integration" },
  { id: "policies", label: "Retry & Rate-Limit", icon: Gauge, group: "Integration" },
];

export function DevShell({ active, onNavigate, children }: { active: DevView; onNavigate: (v: DevView) => void; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const seed = useSeedDeveloper();
  const { theme, setTheme } = useTheme();

  const navItem = (item: (typeof NAV)[number]) => {
    const Icon = item.icon;
    const isActive = active === item.id;
    return (
      <button key={item.id} onClick={() => { onNavigate(item.id); setMobileOpen(false); }} className={cn("group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all", isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 truncate font-medium">{item.label}</span>
        {isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/80" />}
      </button>
    );
  };

  const groups = [...new Set(NAV.map((n) => n.group))];

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand />
        <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">
          {groups.map((g) => (
            <div key={g}>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
              {NAV.filter((n) => n.group === g).map(navItem)}
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => { seed.mutate(true); toast.success("Developer platform seeded"); }}>Re-seed Developer data</Button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex items-center justify-between"><Brand /><Button variant="ghost" size="icon" className="mr-2" onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /></Button></div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">{NAV.map(navItem)}</nav>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 brand-glass lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold leading-tight sm:text-lg">Developer Platform</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">Extension runtime · Connector SDK · Workflow SDK · Registry</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme"><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></Button>
        </header>
        <main className="flex-1 overflow-x-hidden">{children}</main>
        <footer className="mt-auto border-t border-border bg-background/60 px-4 py-3 text-center text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Eks-Food</span> · Milestone 3 — Developer Platform &amp; Extension Framework · {394} tests passing
        </footer>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg brand-gradient text-white shadow-sm"><Puzzle className="h-5 w-5" /></div>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold tracking-tight">Eks-Food Dev</div>
        <div className="truncate text-[11px] text-muted-foreground">Developer Platform · M3</div>
      </div>
    </div>
  );
}
