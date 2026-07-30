"use client";

import { useState, type ReactNode } from "react";
import { Shield, Users, Building2, KeyRound, ScrollText, LogIn, LogOut, Menu, X, Moon, Sun, UserCog, Ticket, LayoutDashboard, Cookie } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMe, useLogout, useSeedIdentity } from "@/lib/iam-api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type IAMView = "dashboard" | "users" | "organizations" | "roles" | "permissions" | "sessions" | "audit" | "invitations" | "login" | "profile" | "mfa";

const ADMIN_NAV: { id: IAMView; label: string; icon: typeof Users }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "users", label: "User Management", icon: Users },
  { id: "organizations", label: "Organizations", icon: Building2 },
  { id: "roles", label: "Role Management", icon: KeyRound },
  { id: "permissions", label: "Permission Explorer", icon: Shield },
  { id: "sessions", label: "Session Explorer", icon: Cookie },
  { id: "invitations", label: "Invitations", icon: Ticket },
  { id: "audit", label: "Audit Viewer", icon: ScrollText },
];

const PORTAL_NAV: { id: IAMView; label: string; icon: typeof Users }[] = [
  { id: "profile", label: "Profile", icon: UserCog },
  { id: "mfa", label: "Security & MFA", icon: Shield },
];

export function IAMShell({ active, onNavigate, children }: { active: IAMView; onNavigate: (v: IAMView) => void; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: me } = useMe();
  const logout = useLogout();
  const seed = useSeedIdentity();
  const isLoggedIn = !!me?.user;

  const navItem = (item: { id: IAMView; label: string; icon: typeof Users }) => {
    const Icon = item.icon;
    const isActive = active === item.id;
    return (
      <button
        key={item.id}
        onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
        className={cn("group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all", isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}
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
        <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">
          <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Admin Console</div>
          {ADMIN_NAV.map(navItem)}
          {isLoggedIn && (
            <>
              <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">User Portal</div>
              {PORTAL_NAV.map(navItem)}
            </>
          )}
        </nav>
        <SidebarFooter isLoggedIn={isLoggedIn} onLogout={() => logout.mutate()} onSeed={() => { seed.mutate(true); toast.success("IAM platform seeded"); }} onLogin={() => onNavigate("login")} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex items-center justify-between"><Brand /><Button variant="ghost" size="icon" className="mr-2" onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /></Button></div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">{ADMIN_NAV.map(navItem)}{isLoggedIn && PORTAL_NAV.map(navItem)}</nav>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} isLoggedIn={isLoggedIn} userEmail={me?.user?.email} onNavigate={onNavigate} onLogout={() => logout.mutate()} />
        <main className="flex-1 overflow-x-hidden">{children}</main>
        <footer className="mt-auto border-t border-border bg-background/60 px-4 py-3 text-center text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Eks-Food</span> · Milestone 2 — Identity &amp; Access Management · RBAC + ABAC · Multi-tenant · {310 + 0} tests passing
        </footer>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg brand-gradient text-white shadow-sm"><Shield className="h-5 w-5" /></div>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold tracking-tight">Eks-Food IAM</div>
        <div className="truncate text-[11px] text-muted-foreground">Identity &amp; Access · M2</div>
      </div>
    </div>
  );
}

function SidebarFooter({ isLoggedIn, onLogout, onSeed, onLogin }: { isLoggedIn: boolean; onLogout: () => void; onSeed: () => void; onLogin: () => void }) {
  return (
    <div className="border-t border-sidebar-border p-3 space-y-2">
      {isLoggedIn ? (
        <Button variant="outline" className="w-full gap-2" onClick={onLogout}><LogOut className="h-4 w-4" /> Sign out</Button>
      ) : (
        <Button className="w-full gap-2" onClick={onLogin}><LogIn className="h-4 w-4" /> Sign in</Button>
      )}
      <Button variant="ghost" size="sm" className="w-full text-xs" onClick={onSeed}>Re-seed IAM data</Button>
    </div>
  );
}

function TopBar({ onMenu, isLoggedIn, userEmail, onNavigate, onLogout }: { onMenu: () => void; isLoggedIn: boolean; userEmail?: string; onNavigate: (v: IAMView) => void; onLogout: () => void }) {
  const { theme, setTheme } = useTheme();
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 brand-glass lg:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open menu"><Menu className="h-5 w-5" /></Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight sm:text-lg">Identity &amp; Access Management</h1>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">RBAC + ABAC · Multi-tenant · Enterprise sessions · MFA · Audit</p>
      </div>
      {isLoggedIn ? (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => onNavigate("profile")}><UserCog className="h-4 w-4" /><span className="hidden sm:inline truncate max-w-[120px]">{userEmail}</span></Button>
          <Button variant="ghost" size="icon" onClick={onLogout} aria-label="Sign out"><LogOut className="h-4 w-4" /></Button>
        </div>
      ) : (
        <Button size="sm" className="gap-2" onClick={() => onNavigate("login")}><LogIn className="h-4 w-4" /> Sign in</Button>
      )}
      <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme"><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></Button>
    </header>
  );
}
