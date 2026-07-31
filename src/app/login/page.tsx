"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sun, Moon, ArrowRight, Utensils, Loader2, User as UserIcon, Home, ChefHat, Store, ShoppingBag, Truck, ShieldCheck, Bike, Car, MapPin, Building2, Code, Package, Shield } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryClient, QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";

const ICONS: Record<string, typeof Home> = {
  Home, Utensils, Store, ChefHat, ShoppingBag, Truck, ShieldCheck, Bike, Car, MapPin, Building2, Code, Package, Shield, User: UserIcon,
};

interface DemoAccount {
  id: string;
  role: string;
  displayName: string;
  description: string;
  responsibilities: string[];
  availableTools: string[];
  aiTeam?: string;
  workflows: string[];
  icon: string;
  sortOrder: number;
}

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

export default function LoginPage() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={new QueryClient()}>
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
          <LoginContent />
        </Suspense>
        <SonnerToaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const redirect = searchParams.get("redirect") ?? "/";

  const { data: demoAccounts, isLoading } = useQuery<DemoAccount[]>({
    queryKey: ["demo-accounts"],
    queryFn: () => api("/api/v1/auth/demo-accounts"),
  });

  const demoLogin = useMutation({
    mutationFn: (role: string) =>
      api("/api/v1/auth/demo-login", {
        method: "POST",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      toast.success("Logged in successfully!");
      router.push(redirect);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const prodLogin = useMutation({
    mutationFn: () =>
      api("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    onSuccess: () => {
      toast.success("Welcome back!");
      router.push(redirect);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* Left panel */}
      <div className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-orange-600 via-red-600 to-pink-700 p-8 text-white lg:w-1/2 lg:p-12">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-10 right-10 h-96 w-96 rounded-full bg-yellow-300 blur-3xl" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
              <Utensils className="h-7 w-7" />
            </div>
            <span className="text-2xl font-bold tracking-tight">Eks-Food</span>
          </div>
        </div>
        <div className="relative z-10 my-12">
          <h1 className="mb-4 text-4xl font-bold leading-tight lg:text-5xl">
            Cooking-as-a-Service for Africa
          </h1>
          <p className="max-w-md text-lg text-white/80">
            The Food Services Operating System connecting households with trusted cooks,
            restaurants, suppliers, and riders across the continent.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-white/10 p-3 backdrop-blur-sm">
              <div className="text-2xl font-bold">14</div>
              <div className="text-xs text-white/70">User Roles</div>
            </div>
            <div className="rounded-lg bg-white/10 p-3 backdrop-blur-sm">
              <div className="text-2xl font-bold">24</div>
              <div className="text-xs text-white/70">AI Agents</div>
            </div>
            <div className="rounded-lg bg-white/10 p-3 backdrop-blur-sm">
              <div className="text-2xl font-bold">130+</div>
              <div className="text-xs text-white/70">Console Views</div>
            </div>
          </div>
        </div>
        <div className="relative z-10 text-sm text-white/60">© 2025 Eks-Food. All rights reserved.</div>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 flex-col p-6 lg:p-12">
        <div className="mb-8 flex items-center justify-end gap-3">
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
            <Sun className="h-4 w-4 dark:hidden" />
            <Moon className="hidden h-4 w-4 dark:block" />
          </Button>
        </div>

        <div className="mx-auto w-full max-w-2xl flex-1">
          <h2 className="mb-2 text-3xl font-bold tracking-tight">Welcome back</h2>
          <p className="mb-8 text-muted-foreground">Sign in to your account or try a demo role.</p>

          <Tabs defaultValue="demo">
            <TabsList className="mb-6 grid w-full grid-cols-2">
              <TabsTrigger value="demo">Demo Accounts</TabsTrigger>
              <TabsTrigger value="production">Production Login</TabsTrigger>
            </TabsList>

            <TabsContent value="demo" className="space-y-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {demoAccounts?.map((account) => {
                    const Icon = ICONS[account.icon] ?? UserIcon;
                    return (
                      <Card key={account.id} className="group cursor-pointer transition-all hover:border-primary hover:shadow-md" onClick={() => demoLogin.mutate(account.role)}>
                        <CardHeader className="pb-3">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <CardTitle className="text-base">{account.displayName}</CardTitle>
                              <CardDescription className="mt-1 line-clamp-2 text-xs">{account.description}</CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="mb-3 flex flex-wrap gap-1">
                            {account.responsibilities.slice(0, 3).map((r) => (
                              <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                            ))}
                          </div>
                          {account.aiTeam && <p className="mb-2 text-[11px] text-muted-foreground">🤖 {account.aiTeam}</p>}
                          <Button size="sm" className="w-full gap-2" disabled={demoLogin.isPending} onClick={(e) => { e.stopPropagation(); demoLogin.mutate(account.role); }}>
                            {demoLogin.isPending && demoLogin.variables === account.role ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>Continue as {account.role.replace(/_/g, " ")}<ArrowRight className="h-4 w-4" /></>
                            )}
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="production">
              <Card>
                <CardHeader>
                  <CardTitle>Sign in</CardTitle>
                  <CardDescription>Enter your credentials to access the platform.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && prodLogin.mutate()} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && prodLogin.mutate()} />
                  </div>
                  <Button className="w-full" disabled={prodLogin.isPending || !email || !password} onClick={() => prodLogin.mutate()}>
                    {prodLogin.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sign in
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
