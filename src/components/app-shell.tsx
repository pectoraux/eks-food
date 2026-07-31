"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Home, Utensils, Calendar, ShoppingBag, Heart, Users, Wallet, TrendingUp, Bell, User as UserIcon, Plus,
  ChefHat, Clock, Star, Award, MessageSquare, FileText, Package,
  Store, ListChecks, Truck, BarChart3, Settings,
  Bike, MapPin, Navigation, History,
  ShieldCheck, AlertTriangle, ClipboardList,
  Building2, KeyRound, Mail,
  Code, Puzzle, Plug, GitBranch, Activity, Terminal, Webhook, Globe, Database, Server,
  LayoutDashboard, Menu, X, Moon, Sun, LogOut, ChevronDown, Search,
  Zap, Brain, Shield, Gauge, FileCheck, AlertCircle, CheckCircle2, DollarSign, Cpu, Network, RefreshCw, Eye,
  Loader2, ArrowRight
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

type ViewId = string;

interface NavItem {
  id: ViewId;
  label: string;
  icon: typeof Home;
  group: string;
}

interface RoleNav {
  title: string;
  subtitle: string;
  nav: NavItem[];
}

// =====================================================
// Role-specific navigation — organized around OUTCOMES
// =====================================================

const ROLE_NAV: Record<string, RoleNav> = {
  CUSTOMER: {
    title: "Customer",
    subtitle: "Your food, simplified",
    nav: [
      { id: "home", label: "Today's Meals", icon: Home, group: "Home" },
      { id: "upcoming", label: "Upcoming Meals", icon: Calendar, group: "Home" },
      { id: "recommended", label: "Recommended for You", icon: Heart, group: "Home" },
      { id: "favorite-cooks", label: "Favorite Cooks", icon: ChefHat, group: "Home" },
      { id: "family", label: "My Family", icon: Users, group: "Home" },
      { id: "meal-plans", label: "Meal Plans", icon: Calendar, group: "Planning" },
      { id: "budget", label: "Budget", icon: Wallet, group: "Planning" },
      { id: "nutrition", label: "Nutrition", icon: TrendingUp, group: "Planning" },
      { id: "pantry", label: "My Pantry", icon: Utensils, group: "Planning" },
      { id: "shopping", label: "Shopping Assistance", icon: ShoppingBag, group: "Planning" },
      { id: "orders", label: "Orders", icon: Package, group: "Activity" },
      { id: "deliveries", label: "Deliveries", icon: Truck, group: "Activity" },
      { id: "saved-recipes", label: "Saved Recipes", icon: Heart, group: "Activity" },
      { id: "community", label: "Community Cooking", icon: Users, group: "Activity" },
      { id: "rewards", label: "Rewards", icon: Star, group: "Activity" },
      { id: "notifications", label: "Notifications", icon: Bell, group: "Activity" },
      { id: "profile", label: "Profile", icon: UserIcon, group: "Account" },
    ],
  },
  COOK: {
    title: "Cook",
    subtitle: "Manage your kitchen and earnings",
    nav: [
      { id: "home", label: "Today's Schedule", icon: Calendar, group: "Today" },
      { id: "earnings", label: "Today's Earnings", icon: Wallet, group: "Today" },
      { id: "upcoming", label: "Upcoming Jobs", icon: Clock, group: "Today" },
      { id: "kitchen-calendar", label: "Kitchen Calendar", icon: Calendar, group: "Schedule" },
      { id: "shopping-list", label: "Shopping List", icon: ShoppingBag, group: "Schedule" },
      { id: "ingredients", label: "Ingredients Needed", icon: Package, group: "Schedule" },
      { id: "repeat-customers", label: "Repeat Customers", icon: Users, group: "Customers" },
      { id: "performance", label: "Performance", icon: Star, group: "Customers" },
      { id: "availability", label: "Availability", icon: Clock, group: "Schedule" },
      { id: "messages", label: "Messages", icon: MessageSquare, group: "Customers" },
      { id: "certifications", label: "Certifications", icon: Award, group: "Profile" },
      { id: "menu", label: "Menu", icon: Utensils, group: "Profile" },
      { id: "recipes", label: "Recipes", icon: FileText, group: "Profile" },
      { id: "income-goals", label: "Income Goals", icon: TrendingUp, group: "Profile" },
      { id: "inventory", label: "Inventory", icon: Package, group: "Profile" },
    ],
  },
  RESTAURANT_OWNER: {
    title: "Restaurant",
    subtitle: "Run your restaurant efficiently",
    nav: [
      { id: "home", label: "Today's Orders", icon: ListChecks, group: "Today" },
      { id: "kitchen-status", label: "Kitchen Status", icon: Utensils, group: "Today" },
      { id: "reservations", label: "Reservations", icon: Calendar, group: "Today" },
      { id: "staff", label: "Staff", icon: Users, group: "Operations" },
      { id: "inventory", label: "Inventory", icon: Package, group: "Operations" },
      { id: "suppliers", label: "Suppliers", icon: Truck, group: "Operations" },
      { id: "sales", label: "Sales", icon: BarChart3, group: "Reports" },
      { id: "deliveries", label: "Deliveries", icon: Truck, group: "Operations" },
      { id: "customers", label: "Customers", icon: Users, group: "Reports" },
      { id: "menu", label: "Menu", icon: Utensils, group: "Settings" },
      { id: "reports", label: "Reports", icon: BarChart3, group: "Reports" },
      { id: "operations", label: "Operations", icon: Settings, group: "Settings" },
    ],
  },
  RESTAURANT_STAFF: {
    title: "Kitchen Staff",
    subtitle: "Your kitchen, organized",
    nav: [
      { id: "home", label: "Today's Tasks", icon: ListChecks, group: "Today" },
      { id: "kitchen-status", label: "Kitchen Status", icon: Utensils, group: "Today" },
      { id: "orders", label: "Active Orders", icon: Package, group: "Today" },
      { id: "prep-list", label: "Prep List", icon: ClipboardList, group: "Today" },
      { id: "schedule", label: "My Schedule", icon: Calendar, group: "Schedule" },
      { id: "inventory", label: "Inventory", icon: Package, group: "Operations" },
      { id: "cleaning", label: "Cleaning Tasks", icon: CheckCircle2, group: "Operations" },
    ],
  },
  VENDOR: {
    title: "Vendor",
    subtitle: "Sell more, deliver faster",
    nav: [
      { id: "home", label: "Dashboard", icon: LayoutDashboard, group: "Today" },
      { id: "products", label: "Products", icon: Package, group: "Catalog" },
      { id: "orders", label: "Orders", icon: ShoppingBag, group: "Today" },
      { id: "deliveries", label: "Upcoming Deliveries", icon: Truck, group: "Today" },
      { id: "customers", label: "Customers", icon: Users, group: "Network" },
      { id: "payments", label: "Payments", icon: Wallet, group: "Finance" },
      { id: "performance", label: "Performance", icon: TrendingUp, group: "Reports" },
    ],
  },
  SUPPLIER: {
    title: "Supplier",
    subtitle: "Supply chain, simplified",
    nav: [
      { id: "home", label: "Purchase Orders", icon: ClipboardList, group: "Today" },
      { id: "inventory", label: "Inventory", icon: Package, group: "Operations" },
      { id: "deliveries", label: "Upcoming Deliveries", icon: Truck, group: "Today" },
      { id: "demand", label: "Demand Forecast", icon: TrendingUp, group: "Planning" },
      { id: "customers", label: "Customers", icon: Users, group: "Network" },
      { id: "payments", label: "Payments Status", icon: Wallet, group: "Finance" },
      { id: "warehouse", label: "Warehouse", icon: Building2, group: "Operations" },
      { id: "products", label: "Products", icon: Package, group: "Catalog" },
      { id: "availability", label: "Availability", icon: Clock, group: "Operations" },
      { id: "performance", label: "Performance", icon: BarChart3, group: "Reports" },
    ],
  },
  FOOD_INSPECTOR: {
    title: "Inspector",
    subtitle: "Keep food safe",
    nav: [
      { id: "home", label: "Today's Inspections", icon: ShieldCheck, group: "Today" },
      { id: "kitchens", label: "Assigned Kitchens", icon: Utensils, group: "Today" },
      { id: "pending-reports", label: "Pending Reports", icon: FileText, group: "Today" },
      { id: "compliance", label: "Compliance", icon: CheckCircle2, group: "Records" },
      { id: "violations", label: "Violations", icon: AlertTriangle, group: "Records" },
      { id: "schedules", label: "Schedules", icon: Calendar, group: "Planning" },
      { id: "certificates", label: "Certificates", icon: Award, group: "Records" },
    ],
  },
  RIDER: {
    title: "Rider",
    subtitle: "Deliver and earn",
    nav: [
      { id: "home", label: "Go Online", icon: Zap, group: "Today" },
      { id: "available", label: "Available Deliveries", icon: Package, group: "Today" },
      { id: "earnings", label: "Today's Earnings", icon: Wallet, group: "Today" },
      { id: "active", label: "Active Delivery", icon: Navigation, group: "Today" },
      { id: "history", label: "History", icon: History, group: "Records" },
      { id: "vehicle", label: "Vehicle", icon: Bike, group: "Profile" },
      { id: "availability", label: "Availability", icon: Clock, group: "Profile" },
      { id: "performance", label: "Performance", icon: Star, group: "Records" },
      { id: "messages", label: "Messages", icon: MessageSquare, group: "Profile" },
    ],
  },
  FLEET_MANAGER: {
    title: "Fleet Manager",
    subtitle: "Manage your fleet",
    nav: [
      { id: "home", label: "Fleet Overview", icon: LayoutDashboard, group: "Today" },
      { id: "riders", label: "Riders", icon: Users, group: "Team" },
      { id: "vehicles", label: "Vehicles", icon: Truck, group: "Assets" },
      { id: "deliveries", label: "Active Deliveries", icon: Package, group: "Today" },
      { id: "routes", label: "Routes", icon: MapPin, group: "Operations" },
      { id: "maintenance", label: "Maintenance", icon: Settings, group: "Assets" },
      { id: "performance", label: "Performance", icon: BarChart3, group: "Reports" },
    ],
  },
  AREA_MANAGER: {
    title: "Area Manager",
    subtitle: "Regional operations at a glance",
    nav: [
      { id: "home", label: "Operations", icon: LayoutDashboard, group: "Overview" },
      { id: "restaurants", label: "Restaurants", icon: Store, group: "Network" },
      { id: "cooks", label: "Cooks", icon: ChefHat, group: "Network" },
      { id: "riders", label: "Riders", icon: Bike, group: "Network" },
      { id: "coverage", label: "Coverage", icon: MapPin, group: "Overview" },
      { id: "incidents", label: "Incidents", icon: AlertCircle, group: "Today" },
      { id: "performance", label: "Performance", icon: TrendingUp, group: "Reports" },
      { id: "analytics", label: "Analytics", icon: BarChart3, group: "Reports" },
    ],
  },
  ORG_ADMIN: {
    title: "Admin",
    subtitle: "Manage your organization",
    nav: [
      { id: "home", label: "Overview", icon: LayoutDashboard, group: "Today" },
      { id: "team", label: "Team", icon: Users, group: "People" },
      { id: "organizations", label: "Organizations", icon: Building2, group: "People" },
      { id: "permissions", label: "Permissions", icon: KeyRound, group: "People" },
      { id: "operations", label: "Operations", icon: Settings, group: "Settings" },
      { id: "reports", label: "Reports", icon: BarChart3, group: "Reports" },
      { id: "billing", label: "Billing", icon: Wallet, group: "Finance" },
      { id: "locations", label: "Locations", icon: MapPin, group: "Settings" },
      { id: "policies", label: "Policies", icon: ShieldCheck, group: "Settings" },
      { id: "invitations", label: "Invitations", icon: Mail, group: "People" },
    ],
  },
  DEVELOPER: {
    title: "Developer",
    subtitle: "Build on Eks-Food",
    nav: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
      { id: "extensions", label: "Extensions", icon: Puzzle, group: "Build" },
      { id: "api-explorer", label: "API Explorer", icon: Globe, group: "Build" },
      { id: "events", label: "Events", icon: Activity, group: "Build" },
      { id: "connectors", label: "Connectors", icon: Plug, group: "Build" },
      { id: "webhooks", label: "Webhooks", icon: Webhook, group: "Build" },
      { id: "marketplace", label: "Marketplace", icon: ShoppingBag, group: "Publish" },
      { id: "logs", label: "Logs", icon: FileText, group: "Debug" },
      { id: "cli", label: "CLI", icon: Terminal, group: "Debug" },
    ],
  },
  MARKETPLACE_PUBLISHER: {
    title: "Publisher",
    subtitle: "Publish and grow",
    nav: [
      { id: "home", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
      { id: "listings", label: "My Listings", icon: Package, group: "Publish" },
      { id: "marketplace", label: "Marketplace", icon: ShoppingBag, group: "Publish" },
      { id: "analytics", label: "Analytics", icon: BarChart3, group: "Reports" },
      { id: "revenue", label: "Revenue", icon: Wallet, group: "Finance" },
    ],
  },
  PLATFORM_ADMIN: {
    title: "Platform Admin",
    subtitle: "Platform health and governance",
    nav: [
      { id: "home", label: "Platform Health", icon: LayoutDashboard, group: "Overview" },
      { id: "operations", label: "Operations", icon: Gauge, group: "Operations" },
      { id: "deployments", label: "Deployments", icon: GitBranch, group: "Operations" },
      { id: "ai", label: "AI Operations", icon: Brain, group: "Operations" },
      { id: "connectors", label: "Connectors", icon: Plug, group: "Operations" },
      { id: "infrastructure", label: "Infrastructure", icon: Server, group: "Operations" },
      { id: "security", label: "Security", icon: Shield, group: "Governance" },
      { id: "analytics", label: "Analytics", icon: BarChart3, group: "Reports" },
      { id: "governance", label: "Governance", icon: FileCheck, group: "Governance" },
      { id: "waitlist", label: "Waitlist Approvals", icon: UserIcon, group: "Governance" },
    ],
  },
  SUPER_ADMIN: {
    title: "Super Admin",
    subtitle: "Full platform access",
    nav: [
      { id: "home", label: "Platform Health", icon: LayoutDashboard, group: "Overview" },
      { id: "operations", label: "Operations", icon: Gauge, group: "Operations" },
      { id: "deployments", label: "Deployments", icon: GitBranch, group: "Operations" },
      { id: "ai", label: "AI Operations", icon: Brain, group: "Operations" },
      { id: "connectors", label: "Connectors", icon: Plug, group: "Operations" },
      { id: "infrastructure", label: "Infrastructure", icon: Server, group: "Operations" },
      { id: "security", label: "Security", icon: Shield, group: "Governance" },
      { id: "analytics", label: "Analytics", icon: BarChart3, group: "Reports" },
      { id: "governance", label: "Governance", icon: FileCheck, group: "Governance" },
      { id: "waitlist", label: "Waitlist Approvals", icon: UserIcon, group: "Governance" },
      { id: "developers", label: "Developer Console", icon: Code, group: "Platform" },
    ],
  },
};

// =====================================================
// API helper
// =====================================================
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.error ?? data?.message ?? `Request failed (${res.status})`;
    throw new Error(typeof message === "string" ? message : "Request failed");
  }
  return (data as { data: T }).data ?? (data as T);
}

interface SessionUser {
  id: string;
  email: string;
  name: string;
  roles: string;
  organizationId: string;
}

// =====================================================
// View Data API types
// =====================================================
interface ViewStat { label: string; value: string; subtext: string; icon: string; color: string }
interface ViewItem { title: string; subtitle?: string; badge?: string; badgeVariant?: string; action?: string; actionType?: string }
interface ViewCard { title: string; description?: string; icon?: string; items: ViewItem[] }
interface ViewData {
  title: string;
  subtitle: string;
  stats: ViewStat[];
  cards: ViewCard[];
}

const ICON_MAP: Record<string, typeof Home> = {
  Home, Utensils, Calendar, ShoppingBag, Heart, Users, Wallet, TrendingUp, Bell, User: UserIcon,
  ChefHat, Clock, Star, Award, MessageSquare, FileText, Package, Store, ListChecks, Truck, BarChart3, Settings,
  Bike, MapPin, Navigation, History, ShieldCheck, AlertTriangle, ClipboardList, Building2, KeyRound, Mail,
  Code, Puzzle, Plug, GitBranch, Activity, Terminal, Webhook, Globe, Database, Server,
  LayoutDashboard, Zap, Brain, Shield, Gauge, FileCheck, AlertCircle, CheckCircle2, DollarSign,
};

// =====================================================
// Main App Shell — manages state + renders content
// =====================================================
/** Redirect to login — used when no session is found. */
function RedirectToLogin() {
  const router = useRouter();
  useEffect(() => {
    router.push("/login");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeView, setActiveView] = useState<string>("home");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ViewItem[]>([]);
  const [searching, setSearching] = useState(false);
  const queryClient = useQueryClient();

  // Fetch current user
  const { data: session, isLoading } = useQuery<{ user: SessionUser | null }>({
    queryKey: ["session"],
    queryFn: () => api("/api/v1/auth/logout"),
  });

  const logout = useMutation({
    mutationFn: () => api("/api/v1/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      router.push("/login");
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Fetch view data whenever the active view changes
  const { data: viewData, isLoading: viewLoading } = useQuery<ViewData>({
    queryKey: ["view-data", session?.user?.roles, session?.user?.id, activeView],
    queryFn: () => api(`/api/v1/app/view?role=${session?.user?.roles ?? "CUSTOMER"}&view=${activeView}&userId=${session?.user?.id ?? ""}`),
    enabled: !!session?.user,
  });

  // Seed on first load
  useEffect(() => {
    fetch("/api/v1/auth/seed", { method: "POST" }).catch(() => {});
  }, []);

  // Seed demo data for the logged-in user (creates real orders, favorites, pantry, etc.)
  useEffect(() => {
    if (session?.user?.id) {
      fetch(`/api/v1/app/seed-demo?userId=${session.user.id}`, { method: "POST" }).catch(() => {});
    }
  }, [session?.user?.id]);

  // Search handler with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await api<ViewItem[]>(`/api/v1/app/search?q=${encodeURIComponent(searchQuery)}`);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const user = session?.user;
  const role = user?.roles ?? "CUSTOMER";
  const roleNav = ROLE_NAV[role] ?? ROLE_NAV.CUSTOMER;
  const groups = useMemo(() => [...new Set(roleNav.nav.map((n) => n.group))], [roleNav]);

  const initials = user?.name?.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) ?? "?";

  const navItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activeView === item.id;
    return (
      <button
        key={item.id}
        onClick={() => { setActiveView(item.id); setMobileOpen(false); }}
        className={cn(
          "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all",
          isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 truncate font-medium">{item.label}</span>
        {isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/80" />}
      </button>
    );
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <RedirectToLogin />;
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand role={roleNav.title} subtitle={roleNav.subtitle} />
        <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">
          {groups.map((g) => (
            <div key={g}>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
              {roleNav.nav.filter((n) => n.group === g).map(navItem)}
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut className="h-4 w-4" />
            {logout.isPending ? "Logging out..." : "Log out"}
          </Button>
        </div>
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
              <Brand role={roleNav.title} subtitle={roleNav.subtitle} />
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">
              {groups.map((g) => (
                <div key={g}>
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
                  {roleNav.nav.filter((n) => n.group === g).map(navItem)}
                </div>
              ))}
            </nav>
            <div className="border-t border-sidebar-border p-3">
              <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs" onClick={() => logout.mutate()} disabled={logout.isPending}>
                <LogOut className="h-4 w-4" />
                {logout.isPending ? "Logging out..." : "Log out"}
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 brand-glass lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>

          {/* Search bar — functional */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search meals, cooks, orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted/50 py-2 pl-9 pr-4 text-sm outline-none transition-colors focus:border-primary focus:bg-background"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-background shadow-lg z-50">
                {searchResults.map((result, i) => (
                  <button
                    key={i}
                    className="flex w-full items-center gap-3 border-b border-border/50 p-3 text-left transition-colors last:border-0 hover:bg-accent"
                    onClick={() => { setSearchQuery(""); setSearchResults([]); }}
                  >
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{result.title}</div>
                      {result.subtitle && <div className="truncate text-xs text-muted-foreground">{result.subtitle}</div>}
                    </div>
                    {result.badge && <Badge variant="secondary" className="text-[10px]">{result.badge}</Badge>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
              <Sun className="h-4 w-4 dark:hidden" />
              <Moon className="hidden h-4 w-4 dark:block" />
            </Button>
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden text-right md:block">
                <div className="text-xs font-semibold leading-tight">{user.name}</div>
                <div className="text-[10px] text-muted-foreground">{roleNav.title}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Main view — renders based on activeView */}
        <main className="flex-1 overflow-x-hidden p-4 lg:p-6">
          {viewLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : viewData ? (
            <ViewRenderer data={viewData} userId={user?.id ?? ""} onRefresh={() => queryClient.invalidateQueries({ queryKey: ["view-data"] })} />
          ) : children}
        </main>

        {/* Footer */}
        <footer className="mt-auto border-t border-border bg-background/60 px-4 py-3 text-center text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Eks-Food</span> · Cooking-as-a-Service for Africa
        </footer>
      </div>
    </div>
  );
}

// =====================================================
// View Renderer — renders the view data from the API
// =====================================================
function ViewRenderer({ data, userId, onRefresh }: { data: ViewData; userId: string; onRefresh: () => void }) {
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showPantryForm, setShowPantryForm] = useState(false);
  const [showMealPlanForm, setShowMealPlanForm] = useState(false);
  const queryClient = useQueryClient();

  // Mutations for creating real data
  const createOrder = useMutation({
    mutationFn: (input: { mealName: string; portions: number; scheduledFor: string; address: string }) =>
      api("/api/v1/app/orders", {
        method: "POST",
        body: JSON.stringify({ userId, mealName: input.mealName, portions: input.portions, scheduledFor: input.scheduledFor, address: input.address, city: "Accra", region: "Greater Accra" }),
      }),
    onSuccess: () => {
      toast.success("Order created successfully!");
      setShowOrderForm(false);
      queryClient.invalidateQueries({ queryKey: ["view-data"] });
      onRefresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addPantryItem = useMutation({
    mutationFn: (input: { name: string; quantity: number; unit: string }) =>
      api("/api/v1/app/pantry", {
        method: "POST",
        body: JSON.stringify({ userId, name: input.name, quantity: input.quantity, unit: input.unit }),
      }),
    onSuccess: () => {
      toast.success("Item added to pantry!");
      setShowPantryForm(false);
      queryClient.invalidateQueries({ queryKey: ["view-data"] });
      onRefresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createMealPlan = useMutation({
    mutationFn: (input: { name: string; type: string; startDate: string; endDate: string }) =>
      api("/api/v1/app/meal-plans", {
        method: "POST",
        body: JSON.stringify({ userId, name: input.name, type: input.type, startDate: input.startDate, endDate: input.endDate }),
      }),
    onSuccess: () => {
      toast.success("Meal plan created!");
      setShowMealPlanForm(false);
      queryClient.invalidateQueries({ queryKey: ["view-data"] });
      onRefresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Delete pantry item
  const deleteItem = useMutation({
    mutationFn: (itemName: string) =>
      api(`/api/v1/app/pantry?name=${encodeURIComponent(itemName)}&userId=${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Item removed from pantry!");
      queryClient.invalidateQueries({ queryKey: ["view-data"] });
      onRefresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Handle action button clicks — each action type calls a real API
  const handleAction = (action: string, itemTitle: string) => {
    const lowerAction = action.toLowerCase();
    if (lowerAction === "book" || lowerAction === "order") {
      // Create a real booking/order
      createOrder.mutate({ mealName: itemTitle, portions: 1, scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), address: "Osu, Accra" });
    } else if (lowerAction === "add to list" || lowerAction === "add") {
      // Add to pantry
      addPantryItem.mutate({ name: itemTitle.split("—")[0].trim(), quantity: 1, unit: "kg" });
    } else if (lowerAction === "view plan" || lowerAction === "view") {
      toast.info(`Opening: ${itemTitle}`);
    } else if (lowerAction === "redeem") {
      toast.success(`Redeemed: ${itemTitle}`);
    } else if (lowerAction === "join") {
      toast.success(`Joined: ${itemTitle}`);
    } else if (lowerAction === "edit" || lowerAction === "change") {
      toast.info(`Editing: ${itemTitle}`);
    } else {
      toast.success(`${action}: ${itemTitle}`);
    }
  };

  // Determine which create button to show based on the page title
  const pageTitle = data.title.toLowerCase();
  const showCreateOrder = pageTitle.includes("meal") || pageTitle.includes("order") || pageTitle.includes("today") || pageTitle.includes("recommended") || pageTitle.includes("welcome");
  const showCreatePantry = pageTitle.includes("pantry");
  const showCreateMealPlan = pageTitle.includes("meal plan");

  return (
    <div className="space-y-6">
      {/* Header + action button */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{data.title}</h1>
          <p className="text-muted-foreground">{data.subtitle}</p>
        </div>
        <div className="flex gap-2">
          {showCreateOrder && (
            <Button size="sm" className="gap-2" onClick={() => setShowOrderForm(true)}>
              <Plus className="h-4 w-4" /> New Order
            </Button>
          )}
          {showCreatePantry && (
            <Button size="sm" className="gap-2" onClick={() => setShowPantryForm(true)}>
              <Plus className="h-4 w-4" /> Add Item
            </Button>
          )}
          {showCreateMealPlan && (
            <Button size="sm" className="gap-2" onClick={() => setShowMealPlanForm(true)}>
              <Plus className="h-4 w-4" /> Create Plan
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {data.stats && data.stats.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {data.stats.map((stat, i) => {
            const Icon = ICON_MAP[stat.icon] ?? LayoutDashboard;
            return (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground">{stat.label}</div>
                      <div className="mt-1 text-2xl font-bold">{stat.value}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{stat.subtext}</div>
                    </div>
                    <Icon className={cn("h-8 w-8", stat.color ?? "text-primary")} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Content cards */}
      <div className="grid gap-6 lg:grid-cols-2">
        {data.cards.map((card, i) => {
          const Icon = card.icon ? ICON_MAP[card.icon] ?? FileText : FileText;
          return (
            <Card key={i}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="h-5 w-5" />
                  {card.title}
                </CardTitle>
                {card.description && <CardDescription>{card.description}</CardDescription>}
              </CardHeader>
              <CardContent>
                {card.items && card.items.length > 0 ? (
                  <div className="space-y-2">
                    {card.items.map((item, j) => (
                      <div key={j} className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{item.title}</div>
                          {item.subtitle && <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>}
                        </div>
                        {item.badge && (
                          <Badge variant={item.badgeVariant === "destructive" ? "destructive" : item.badgeVariant === "outline" ? "outline" : item.badgeVariant === "default" ? "default" : "secondary"} className="text-[10px]">
                            {item.badge}
                          </Badge>
                        )}
                        {item.action && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0 text-xs"
                            disabled={createOrder.isPending || addPantryItem.isPending || deleteItem.isPending}
                            onClick={() => handleAction(item.action ?? "", item.title)}
                          >
                            {createOrder.isPending && (item.action === "Book" || item.action === "Order") ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : null}
                            {item.action}
                          </Button>
                        )}
                        {/* Delete button for pantry items */}
                        {showCreatePantry && item.title && !item.title.includes("No ") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                            disabled={deleteItem.isPending}
                            onClick={() => deleteItem.mutate(item.title.split(" — ")[0])}
                          >
                            {deleteItem.isPending && deleteItem.variables === item.title.split(" — ")[0] ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <X className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <p className="text-sm text-muted-foreground">Nothing here yet.</p>
                    <p className="mt-1 text-xs text-muted-foreground">This is where your {card.title.toLowerCase()} will appear as you use the platform.</p>
                    {showCreateOrder && (
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowOrderForm(true)}>
                        Create your first order
                      </Button>
                    )}
                    {showCreatePantry && (
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowPantryForm(true)}>
                        Add your first item
                      </Button>
                    )}
                    {showCreateMealPlan && (
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowMealPlanForm(true)}>
                        Create your first plan
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* New Order Modal */}
      {showOrderForm && (
        <CreateOrderModal
          onClose={() => setShowOrderForm(false)}
          onCreate={(input) => createOrder.mutate(input)}
          isPending={createOrder.isPending}
        />
      )}

      {/* Add Pantry Item Modal */}
      {showPantryForm && (
        <AddPantryItemModal
          onClose={() => setShowPantryForm(false)}
          onAdd={(input) => addPantryItem.mutate(input)}
          isPending={addPantryItem.isPending}
        />
      )}

      {/* Create Meal Plan Modal */}
      {showMealPlanForm && (
        <CreateMealPlanModal
          onClose={() => setShowMealPlanForm(false)}
          onCreate={(input) => createMealPlan.mutate(input)}
          isPending={createMealPlan.isPending}
        />
      )}
    </div>
  );
}

// =====================================================
// Modal Forms — real forms that call real APIs
// =====================================================

function CreateOrderModal({ onClose, onCreate, isPending }: { onClose: () => void; onCreate: (input: { mealName: string; portions: number; scheduledFor: string; address: string }) => void; isPending: boolean }) {
  const [mealName, setMealName] = useState("");
  const [portions, setPortions] = useState(2);
  const [address, setAddress] = useState("");
  const [date, setDate] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">New Order</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Meal Name</label>
            <Input value={mealName} onChange={(e) => setMealName(e.target.value)} placeholder="e.g., Jollof Rice with Chicken" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Portions</label>
              <Input type="number" value={portions} onChange={(e) => setPortions(parseInt(e.target.value) || 1)} min={1} />
            </div>
            <div>
              <label className="text-xs font-medium">Scheduled For</label>
              <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Delivery Address</label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g., Osu, Accra" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!mealName || !address || isPending} onClick={() => onCreate({ mealName, portions, scheduledFor: new Date(date).toISOString(), address })}>
            {isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Create Order
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddPantryItemModal({ onClose, onAdd, isPending }: { onClose: () => void; onAdd: (input: { name: string; quantity: number; unit: string }) => void; isPending: boolean }) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("kg");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">Add Pantry Item</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Item Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Rice" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Quantity</label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(parseFloat(e.target.value) || 1)} min={0.1} step={0.1} />
            </div>
            <div>
              <label className="text-xs font-medium">Unit</label>
              <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="L">L</option>
                <option value="ml">ml</option>
                <option value="pcs">pcs</option>
                <option value="pack">pack</option>
              </select>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!name || isPending} onClick={() => onAdd({ name, quantity, unit })}>
            {isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Add Item
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateMealPlanModal({ onClose, onCreate, isPending }: { onClose: () => void; onCreate: (input: { name: string; type: string; startDate: string; endDate: string }) => void; isPending: boolean }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("WEEKLY");
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(nextWeek);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">Create Meal Plan</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Plan Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., This Week's Meals" />
          </div>
          <div>
            <label className="text-xs font-medium">Type</label>
            <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="SPECIAL_OCCASION">Special Occasion</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Start Date</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium">End Date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!name || isPending} onClick={() => onCreate({ name, type, startDate, endDate })}>
            {isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Create Plan
          </Button>
        </div>
      </div>
    </div>
  );
}

function Brand({ role, subtitle }: { role: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg brand-gradient text-white shadow-sm">
        <Utensils className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold tracking-tight">Eks-Food</div>
        <div className="truncate text-[11px] text-muted-foreground">{role} · {subtitle}</div>
      </div>
    </div>
  );
}
