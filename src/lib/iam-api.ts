"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { error?: string; detail?: string })?.detail ?? (data as { error?: string })?.error ?? `request_failed (${res.status})`);
  return (data as { data?: T }).data ?? (data as T);
}

/* Types */
export interface IAMUser { id: string; email: string; name: string; phone?: string; status: string; organizationId: string; roles: string; lastLoginAt?: string; createdAt: string; deletedAt?: string | null; _count: { memberships: number; sessions: number; identities: number }; }
export interface IAMRole { id: string; organizationId: string | null; code: string; name: string; description?: string; scope: string; isSystem: boolean; active: boolean; _count: { memberships: number; rolePermissions: number }; }
export interface IAMPermission { id: string; code: string; name: string; resource: string; description?: string; _count: { rolePermissions: number; policies: number }; }
export interface IAMOrg { id: string; slug: string; name: string; country: string; baseCurrency: string; status: string; type?: { code: string; name: string }; _count: { memberships: number }; }
export interface IAMMembership { id: string; userId: string; organizationId: string; status: string; user: { id: string; email: string; name: string }; role: { id: string; code: string; name: string }; }
export interface IAMTeam { id: string; organizationId: string; name: string; kind: string; description?: string; active: boolean; _count: { members: number }; }
export interface IAMInvitation { id: string; email: string; status: string; expiresAt: string; createdAt: string; role: { code: string; name: string }; }
export interface IAMSession { id: string; userId: string; organizationId: string; expiresAt: string; lastActiveAt: string; ipAddress: string | null; userAgent: string | null; trustedDevice: boolean; riskScore: string; revokedAt: string | null; }
export interface IAMAuditEntry { id: string; organizationId: string; actorUserId: string | null; action: string; entityType: string; entityId: string | null; metadata: string; createdAt: string; }
export interface IAMOrgType { id: string; code: string; name: string; description?: string; }
export interface LoginResult { user: { id: string; email: string; name: string; organizationId: string; status: string }; session: IAMSession; mfaRequired: false; }
export interface MeResult { user: { id: string; email: string; name: string; organizationId: string; status: string; avatarUrl?: string } | null; session?: IAMSession }

/* Auth hooks */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; organizationId?: string }) =>
      api<LoginResult | { mfaRequired: true; challengeToken: string }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/api/v1/auth/logout", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.clear(); },
  });
}
export function useRegister() {
  return useMutation({
    mutationFn: (input: { email: string; password: string; name: string; organizationId: string }) =>
      api<{ userId: string }>("/api/v1/auth/register", { method: "POST", body: JSON.stringify(input) }),
  });
}
export function useMe() { return useQuery({ queryKey: ["me"], queryFn: () => api<MeResult>("/api/v1/auth/logout") }); }

/* Admin hooks */
export function useUsers() { return useQuery({ queryKey: ["iam-users"], queryFn: () => api<IAMUser[]>("/api/v1/users") }); }
export function useRoles(orgId?: string) { return useQuery({ queryKey: ["iam-roles", orgId], queryFn: () => api<IAMRole[]>(`/api/v1/roles${orgId ? `?organizationId=${orgId}` : ""}`) }); }
export function usePermissions() { return useQuery({ queryKey: ["iam-permissions"], queryFn: () => api<IAMPermission[]>("/api/v1/permissions") }); }
export function useOrganizations() { return useQuery({ queryKey: ["iam-orgs"], queryFn: () => api<IAMOrg[]>("/api/v1/organizations") }); }
export function useOrgTypes() { return useQuery({ queryKey: ["iam-org-types"], queryFn: () => api<IAMOrgType[]>("/api/v1/organizations/types") }); }
export function useMemberships(orgId?: string) { return useQuery({ enabled: !!orgId, queryKey: ["iam-memberships", orgId], queryFn: () => api<IAMMembership[]>(`/api/v1/organizations/memberships?organizationId=${orgId}`) }); }
export function useTeams(orgId?: string) { return useQuery({ enabled: !!orgId, queryKey: ["iam-teams", orgId], queryFn: () => api<IAMTeam[]>(`/api/v1/organizations/teams?organizationId=${orgId}`) }); }
export function useInvitations(orgId?: string) { return useQuery({ enabled: !!orgId, queryKey: ["iam-invitations", orgId], queryFn: () => api<IAMInvitation[]>(`/api/v1/organizations/invitations?organizationId=${orgId}`) }); }
export function useSessions() { return useQuery({ queryKey: ["iam-sessions"], queryFn: () => api<IAMSession[]>("/api/v1/sessions") }); }
export function useAudit(limit = 50) { return useQuery({ queryKey: ["iam-audit", limit], queryFn: () => api<{ items: IAMAuditEntry[]; total: number }>(`/api/v1/audit?limit=${limit}`) }); }

export function useSeedIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean) => api<{ ok: boolean } & Record<string, number>>(`/api/v1/seed-identity${force ? "?force=1" : ""}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api<{ revoked: number }>(`/api/v1/sessions?id=${sessionId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["iam-sessions"] }),
  });
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { organizationId: string; email: string; roleCode: string; invitedById: string }) =>
      api<{ id: string; email: string; rawToken: string }>("/api/v1/organizations/invitations", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["iam-invitations"] }),
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { organizationId: string; name: string; kind: string; creatorUserId: string; description?: string }) =>
      api<IAMTeam>("/api/v1/organizations/teams", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["iam-teams"] }),
  });
}

export function useEnrollMFA() {
  return useMutation({
    mutationFn: (email: string) => api<{ otpauthUri: string; recoveryCodes: string[] }>("/api/v1/mfa/enroll", { method: "POST", body: JSON.stringify({ email }) }),
  });
}
export function useVerifyMFA() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api<{ enabled: boolean }>("/api/v1/mfa/verify", { method: "POST", body: JSON.stringify({ token }) }),
    onSuccess: () => qc.invalidateQueries(),
  });
}
