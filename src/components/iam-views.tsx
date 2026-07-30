"use client";

import { useState } from "react";
import {
  Users, Building2, KeyRound, Shield, ScrollText, Cookie, Ticket, LayoutDashboard,
  LogIn, UserCog, CheckCircle2, AlertCircle, Clock, ShieldCheck, Loader2, Copy,
  Smartphone, Key, Plus, Trash2, Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUsers, useRoles, usePermissions, useOrganizations, useOrgTypes, useMemberships, useTeams, useInvitations, useSessions, useAudit, useLogin, useRegister, useMe, useLogout, useRevokeSession, useCreateInvitation, useCreateTeam, useEnrollMFA, useVerifyMFA } from "@/lib/iam-api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ============ Dashboard ============ */
export function DashboardView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { data: users } = useUsers();
  const { data: orgs } = useOrganizations();
  const { data: roles } = useRoles();
  const { data: perms } = usePermissions();
  const { data: audit } = useAudit(5);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-border brand-gradient p-8 text-white shadow-sm">
        <div className="relative z-10 max-w-3xl">
          <Badge className="mb-3 border-white/20 bg-white/15 text-white backdrop-blur">Milestone 2 · IAM</Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Enterprise Identity &amp; Access Management</h1>
          <p className="mt-3 text-sm text-white/85 sm:text-base">
            Multi-tenant IAM with RBAC + ABAC authorization, enterprise sessions, MFA, organizations, teams,
            invitations, and an immutable audit trail. Every identity action emits versioned domain events.
          </p>
        </div>
        <Shield className="absolute -right-8 -top-8 h-64 w-64 text-white/10" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi icon={Users} label="Users" value={users?.length ?? "—"} sub="Across all tenants" onClick={() => onNavigate("users")} />
        <Kpi icon={Building2} label="Organizations" value={orgs?.length ?? "—"} sub="Multi-tenant" onClick={() => onNavigate("organizations")} />
        <Kpi icon={KeyRound} label="Roles" value={roles?.length ?? "—"} sub="Global + org-scoped" onClick={() => onNavigate("roles")} />
        <Kpi icon={Shield} label="Permissions" value={perms?.length ?? "—"} sub="Across 13 resources" onClick={() => onNavigate("permissions")} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader className="p-0"><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> IAM capabilities</CardTitle></CardHeader>
          <CardContent className="p-0 pt-3 space-y-1.5 text-sm">
            <Cap ok label="Email/password (Argon2id)" />
            <Cap ok label="MFA — TOTP + recovery codes" />
            <Cap ok label="Magic-link & passkey abstractions" />
            <Cap ok label="Refresh-token rotation (replay detection)" />
            <Cap ok label="Brute-force protection (progressive lockout)" />
            <Cap ok label="RBAC — global + org + team roles" />
            <Cap ok label="ABAC — ownership, scope, time, features" />
            <Cap ok label="Multi-tenant isolation (organizationId)" />
            <Cap ok label="Organizations, teams, invitations" />
            <Cap ok label="Immutable audit trail + domain events" />
            <Cap ok label="Notification abstraction (4 channels)" />
            <Cap ok label="Identity verification framework" />
          </CardContent>
        </Card>
        <Card className="p-5">
          <CardHeader className="p-0"><CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4 text-primary" /> Recent audit events</CardTitle></CardHeader>
          <CardContent className="p-0 pt-3">
            {audit?.items.length ? (
              <div className="space-y-2">
                {audit.items.slice(0, 6).map((e) => (
                  <div key={e.id} className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="text-[10px]">{e.action}</Badge>
                    <span className="text-muted-foreground truncate">{e.entityType}</span>
                    <span className="ml-auto text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground">No audit events yet. Sign in to generate them.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { t: "Session Explorer", d: "Active sessions, revoke, risk scores.", v: "sessions", icon: Cookie },
          { t: "Audit Viewer", d: "Immutable, filterable audit trail.", v: "audit", icon: ScrollText },
          { t: "Invitations", d: "Email invitations with role assignment.", v: "invitations", icon: Ticket },
          { t: "Organizations", d: "Multi-tenant org management.", v: "organizations", icon: Building2 },
        ].map((q) => (
          <button key={q.v} onClick={() => onNavigate(q.v)} className="group flex flex-col gap-2 rounded-xl border border-border p-4 text-left transition-colors hover:bg-muted/50">
            <q.icon className="h-5 w-5 text-primary" />
            <div className="text-sm font-semibold">{q.t}</div>
            <div className="text-xs text-muted-foreground">{q.d}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, onClick }: { icon: typeof Users; label: string; value: React.ReactNode; sub?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="text-left">
      <Card className="p-4 transition-all hover:shadow-md sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold sm:text-3xl">{value}</div>{sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}</div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
        </div>
      </Card>
    </button>
  );
}
function Cap({ ok, label }: { ok: boolean; label: string }) {
  return <div className="flex items-center gap-2">{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertCircle className="h-4 w-4 text-amber-500" />}<span className="text-muted-foreground">{label}</span></div>;
}

/* ============ Login ============ */
export function LoginView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const login = useLogin();
  const [email, setEmail] = useState("admin@eks.demo");
  const [password, setPassword] = useState("AdminPass123!");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const result = await login.mutateAsync({ email, password });
      if ("mfaRequired" in result && result.mfaRequired) {
        setError("MFA required — enter your TOTP code.");
      } else {
        toast.success("Signed in", { description: (result as { user: { name: string } }).user.name });
        onNavigate("dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md items-center px-4 py-8">
      <Card className="w-full overflow-hidden">
        <div className="brand-gradient p-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20"><Shield className="h-6 w-6" /></div>
          <h2 className="text-xl font-bold">Sign in to Eks-Food</h2>
          <p className="mt-1 text-xs text-white/80">Enterprise Identity &amp; Access Management</p>
        </div>
        <CardContent className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <div className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
            <Button type="submit" className="w-full gap-2" disabled={login.isPending}>
              {login.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in
            </Button>
          </form>
          <div className="mt-4 rounded-lg bg-muted/60 p-3 text-xs">
            <div className="font-semibold">Demo credentials:</div>
            <div className="mt-1 text-muted-foreground">
              <div>admin@eks.demo / AdminPass123! (Owner)</div>
              <div>manager@eks.demo / Manager123! (Manager)</div>
              <div>cook@eks.demo / CookPass123! (Member)</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============ Users ============ */
export function UsersView() {
  const { data, isLoading } = useUsers();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="User Management" description="All users across every tenant. Status, memberships, sessions, identities." />
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {data.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-3 sm:p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">{u.name.charAt(0)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{u.name}</span><Badge className={statusColor(u.status)} variant="outline">{u.status}</Badge></div>
                <div className="truncate text-xs text-muted-foreground">{u.email} · {u.roles}</div>
                <div className="text-[11px] text-muted-foreground">{u._count.memberships} memberships · {u._count.sessions} sessions · {u._count.identities} identities</div>
              </div>
              {u.lastLoginAt && <div className="hidden text-xs text-muted-foreground sm:block">Last login {new Date(u.lastLoginAt).toLocaleDateString()}</div>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Organizations ============ */
export function OrganizationsView() {
  const { data, isLoading } = useOrganizations();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Organizations" description="First-class tenant entities. Extensible types — data, not code." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((o) => (
          <Card key={o.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-sm font-bold">{o.name}</div><code className="text-[10px] text-muted-foreground">{o.slug}</code></div>
              <Badge className={statusColor(o.status)} variant="outline">{o.status}</Badge>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              {o.type && <Badge variant="secondary" className="text-[10px]">{o.type.name}</Badge>}
              <span>{o.country}</span><span>·</span><span>{o.baseCurrency}</span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{o._count.memberships} members</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Roles ============ */
export function RolesView() {
  const { data: orgs } = useOrganizations();
  const orgId = orgs?.[0]?.id;
  const { data, isLoading } = useRoles(orgId);
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Role Management" description="Global + organization-scoped roles. System roles are immutable; custom roles can be created." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div><div className="flex items-center gap-2"><code className="text-sm font-bold text-primary">{r.code}</code>{r.isSystem && <Badge variant="secondary" className="text-[10px]">system</Badge>}</div><div className="mt-0.5 text-xs text-muted-foreground">{r.name}</div></div>
              <Badge variant="outline" className="text-[10px]">{r.scope}</Badge>
            </div>
            {r.description && <p className="mt-2 text-xs text-muted-foreground">{r.description}</p>}
            <div className="mt-2 text-[11px] text-muted-foreground">{r._count.rolePermissions} permissions · {r._count.memberships} members</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============ Permissions ============ */
export function PermissionsView() {
  const { data, isLoading } = usePermissions();
  if (isLoading || !data) return <LoadingGrid />;
  const resources = [...new Set(data.map((p) => p.resource))].sort();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Permission Explorer" description={`${data.length} permissions across ${resources.length} resources. The single source of truth for authorization.`} />
      {resources.map((res) => (
        <Card key={res} className="p-4">
          <div className="mb-2 flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Shield className="h-4 w-4" /></div><h3 className="text-sm font-semibold capitalize">{res}</h3></div>
          <div className="flex flex-wrap gap-1.5">
            {data.filter((p) => p.resource === res).map((p) => (
              <div key={p.id} className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
                <code className="font-mono text-primary">{p.code}</code>
                <span className="text-muted-foreground">{p.name}</span>
                <Badge variant="secondary" className="text-[9px]">{p._count.rolePermissions} roles</Badge>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ============ Sessions ============ */
export function SessionsView() {
  const { data, isLoading } = useSessions();
  const revoke = useRevokeSession();
  if (isLoading || !data) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Session Explorer" description="Active & revoked sessions. Refresh-token rotation with replay detection." />
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {data.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No sessions. Sign in to create one.</div>}
          {data.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3 sm:p-4">
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", s.revokedAt ? "bg-muted text-muted-foreground" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300")}>
                <Cookie className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="text-xs font-mono">{s.id.slice(0, 16)}…</span>{s.revokedAt ? <Badge variant="outline" className="text-[10px]">revoked</Badge> : <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 text-[10px]">active</Badge>}</div>
                <div className="truncate text-[11px] text-muted-foreground">{s.userAgent ?? "unknown"} · {s.ipAddress ?? "unknown"}</div>
                <div className="text-[11px] text-muted-foreground">Risk: <span className={s.riskScore === "HIGH" ? "text-rose-600" : s.riskScore === "MEDIUM" ? "text-amber-600" : "text-emerald-600"}>{s.riskScore}</span> · Last active {new Date(s.lastActiveAt).toLocaleString()}</div>
              </div>
              {!s.revokedAt && <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => { revoke.mutate(s.id); toast.success("Session revoked"); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Audit ============ */
export function AuditView() {
  const { data, isLoading } = useAudit(100);
  const [filter, setFilter] = useState("");
  if (isLoading || !data) return <LoadingGrid />;
  const filtered = filter ? data.items.filter((e) => e.action.toLowerCase().includes(filter.toLowerCase()) || e.entityType.toLowerCase().includes(filter.toLowerCase())) : data.items;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Audit Viewer" description={`${data.total} immutable audit entries. Every identity action is recorded.`} />
      <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by action or entity type…" className="pl-9" /></div>
      <Card className="overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-border scrollbar-thin">
          {filtered.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No matching audit entries.</div>}
          {filtered.map((e) => (
            <div key={e.id} className="flex items-start gap-3 p-3 text-xs">
              <Badge variant="outline" className="text-[10px] shrink-0">{e.action}</Badge>
              <div className="min-w-0 flex-1"><div className="text-muted-foreground">{e.entityType}{e.entityId && ` · ${e.entityId.slice(0, 12)}`}</div>{e.actorUserId && <div className="text-muted-foreground">by {e.actorUserId.slice(0, 12)}</div>}</div>
              <div className="text-muted-foreground shrink-0">{new Date(e.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Invitations ============ */
export function InvitationsView() {
  const { data: orgs } = useOrganizations();
  const orgId = orgs?.[0]?.id;
  const { data: roles } = useRoles(orgId);
  const { data: invs, isLoading } = useInvitations(orgId);
  const create = useCreateInvitation();
  const [email, setEmail] = useState("");
  const [roleCode, setRoleCode] = useState("MEMBER");
  const [lastToken, setLastToken] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    try {
      const r = await create.mutateAsync({ organizationId: orgId, email, roleCode, invitedById: "seed-admin" });
      setLastToken(r.rawToken);
      toast.success("Invitation sent", { description: email });
      setEmail("");
    } catch (err) { toast.error("Failed", { description: err instanceof Error ? err.message : undefined }); }
  };

  if (isLoading || !invs) return <LoadingGrid />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Invitations" description="Email invitations with role assignment. Single-use, expiring tokens." />
      <Card className="p-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="invitee@example.com" required /></div>
          <div className="min-w-[160px]"><Label>Role</Label><Select value={roleCode} onValueChange={setRoleCode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{roles?.map((r) => <SelectItem key={r.id} value={r.code}>{r.code}</SelectItem>)}</SelectContent></Select></div>
          <Button type="submit" disabled={create.isPending} className="gap-2"><Plus className="h-4 w-4" /> Invite</Button>
        </form>
        {lastToken && <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-2.5 text-xs dark:bg-amber-950/30"><Ticket className="h-3.5 w-3.5 text-amber-600" /><span className="flex-1 truncate font-mono">{lastToken}</span><Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(lastToken); toast.success("Copied"); }}><Copy className="h-3 w-3" /></Button></div>}
      </Card>
      <Card className="overflow-hidden">
        <div className="divide-y divide-border">
          {invs.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No invitations.</div>}
          {invs.map((i) => (
            <div key={i.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Ticket className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{i.email}</div><div className="text-xs text-muted-foreground">{i.role.name} · expires {new Date(i.expiresAt).toLocaleDateString()}</div></div>
              <Badge className={i.status === "PENDING" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : statusColor(i.status)} variant="outline">{i.status}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ============ Profile ============ */
export function ProfileView() {
  const { data: me } = useMe();
  if (!me?.user) return <div className="p-8 text-center text-sm text-muted-foreground">Sign in to view your profile.</div>;
  const u = me.user;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Profile" description="Your account details & preferences." />
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-2xl font-bold text-primary">{u.name.charAt(0)}</div>
          <div><h3 className="text-lg font-bold">{u.name}</h3><p className="text-sm text-muted-foreground">{u.email}</p><Badge className={statusColor(u.status)} variant="outline">{u.status}</Badge></div>
        </div>
      </Card>
      <Card className="p-6">
        <h3 className="text-sm font-semibold">Localization preferences</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <Pref label="Language" value="English" /><Pref label="Timezone" value="Africa/Accra" /><Pref label="Currency" value="GHS" /><Pref label="Date format" value="YYYY-MM-DD" />
        </div>
      </Card>
    </div>
  );
}
function Pref({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[11px] uppercase text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}

/* ============ MFA ============ */
export function MFAView() {
  const enroll = useEnrollMFA();
  const verify = useVerifyMFA();
  const [token, setToken] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [uri, setUri] = useState<string | null>(null);

  const startEnroll = async () => {
    try {
      const r = await enroll.mutateAsync("user@eks.demo");
      setUri(r.otpauthUri); setRecovery(r.recoveryCodes);
      toast.success("TOTP secret generated");
    } catch (e) { toast.error("Enrollment failed", { description: e instanceof Error ? e.message : undefined }); }
  };
  const confirm = async () => {
    try {
      await verify.mutateAsync(token);
      toast.success("MFA enabled");
      setToken(""); setUri(null);
    } catch (e) { toast.error("Invalid code"); }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:px-8 lg:py-8 space-y-4">
      <Header title="Security & MFA" description="Enroll TOTP, generate recovery codes, manage factors." />
      <Card className="p-6">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Smartphone className="h-5 w-5" /></div><div><h3 className="text-sm font-semibold">Authenticator app (TOTP)</h3><p className="text-xs text-muted-foreground">Use Google Authenticator, Authy, or 1Password.</p></div></div>
        {!uri && !recovery && <Button className="mt-4 gap-2" onClick={startEnroll} disabled={enroll.isPending}>{enroll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Enroll TOTP</Button>}
        {uri && <div className="mt-4 space-y-3"><div className="rounded-lg bg-muted/60 p-3 text-xs"><div className="font-semibold">Scan this URI in your authenticator:</div><code className="mt-1 block break-all font-mono text-[10px]">{uri}</code></div></div>}
        {recovery && <div className="mt-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30"><div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300"><Key className="h-3.5 w-3.5" /> Recovery codes (store safely — shown once)</div><div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">{recovery.map((c, i) => <div key={i}>{c}</div>)}</div></div>}
        {uri && <div className="mt-4 flex items-end gap-2"><div className="flex-1"><Label>Enter 6-digit code</Label><Input value={token} onChange={(e) => setToken(e.target.value)} maxLength={6} placeholder="123456" /></div><Button onClick={confirm} disabled={token.length !== 6 || verify.isPending} className="gap-2">{verify.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verify & enable</Button></div>}
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
function statusColor(s: string): string {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    SUSPENDED: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    LOCKED: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    DELETED: "bg-muted text-muted-foreground",
    ACCEPTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    REVOKED: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    EXPIRED: "bg-muted text-muted-foreground",
  };
  return map[s] ?? "bg-muted text-muted-foreground";
}
