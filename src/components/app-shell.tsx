"use client";

import { useState, type ReactNode } from "react";
import {
  LayoutDashboard, UtensilsCrossed, ChefHat, Settings2, BarChart3,
  Sparkles, Menu, X, Flame, Moon, Sun, Github,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore, type ModuleId } from "@/lib/store";
import { usePlatform } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV: { id: ModuleId; label: string; icon: typeof LayoutDashboard; desc: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, desc: "Platform vision & KPIs" },
  { id: "book", label: "Book a Cook", icon: UtensilsCrossed, desc: "Customer booking flow" },
  { id: "cook", label: "Cook Workspace", icon: ChefHat, desc: "Jobs, income, performance" },
  { id: "admin", label: "Admin Console", icon: Settings2, desc: "Config & feature flags" },
  { id: "intelligence", label: "Food Intelligence", icon: BarChart3, desc: "Demand & trends" },
  { id: "assistant", label: "AI Assistant", icon: Sparkles, desc: "Platform copilot" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { activeModule, setActiveModule } = useAppStore();
  const { data: platform } = usePlatform();

  const navItem = (item: (typeof NAV)[number]) => {
    const Icon = item.icon;
    const active = activeModule === item.id;
    return (
      <button
        key={item.id}
        onClick={() => { setActiveModule(item.id); setMobileOpen(false); }}
        className={cn(
          "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all",
          active
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className={cn("h-4.5 w-4.5 shrink-0", active ? "" : "text-muted-foreground group-hover:text-foreground")} style={{ width: 18, height: 18 }} />
        <span className="flex-1 truncate font-medium">{item.label}</span>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/80" />}
      </button>
    );
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Sidebar — desktop */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <SidebarBrand org={platform?.organization} />
        <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">
          {NAV.map(navItem)}
        </nav>
        <SidebarFooter platform={platform} />
      </aside>

      {/* Sidebar — mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex items-center justify-between">
              <SidebarBrand org={platform?.organization} />
              <Button variant="ghost" size="icon" className="mr-2" onClick={() => setMobileOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">
              {NAV.map(navItem)}
            </nav>
            <SidebarFooter platform={platform} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-x-hidden">{children}</main>
        <Footer />
      </div>
    </div>
  );
}

function SidebarBrand({ org }: { org?: { name: string; country: string } }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg brand-gradient text-white shadow-sm">
        <Flame className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold tracking-tight">Eks-Food</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {org ? `${org.name} · ${org.country}` : "Food Services OS"}
        </div>
      </div>
    </div>
  );
}

function SidebarFooter({ platform }: { platform?: { kpis?: { verifiedCooks: number } } }) {
  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="rounded-lg bg-sidebar-accent/60 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Live network</span>
          <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Online
          </Badge>
        </div>
        <div className="mt-1.5 text-lg font-bold">{platform?.kpis?.verifiedCooks ?? "—"}<span className="ml-1 text-xs font-normal text-muted-foreground">verified cooks</span></div>
      </div>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { theme, setTheme } = useTheme();
  const activeModule = useAppStore((s) => s.activeModule);
  const current = NAV.find((n) => n.id === activeModule);
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 brand-glass lg:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight sm:text-lg">{current?.label}</h1>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">{current?.desc}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        aria-label="Toggle theme"
      >
        <Sun className="h-4 w-4 dark:hidden" />
        <Moon className="hidden h-4 w-4 dark:block" />
      </Button>
      <a href="https://github.com" target="_blank" rel="noreferrer" className="hidden sm:block">
        <Button variant="ghost" size="icon" aria-label="Source">
          <Github className="h-4 w-4" />
        </Button>
      </a>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-background/60 px-4 py-4 text-center text-xs text-muted-foreground lg:px-6">
      <p>
        <span className="font-semibold text-foreground">Eks-Food</span> — Food Services Operating System ·
        Payments secured by <span className="font-medium text-foreground">Payswap</span> ·
        Cooking-as-a-Service for Africa
      </p>
    </footer>
  );
}
