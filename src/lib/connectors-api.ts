"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { error?: string; detail?: string })?.detail ?? (data as { error?: string })?.error ?? `request_failed (${res.status})`);
  return (data as { data?: T }).data ?? (data as T);
}

export interface ExtProvider { id: string; category: string; code: string; name: string; status: string; weight: number; capabilities: string; regions: string; health: { status: string; score: number; latencyMs: number; errorRate: number }[]; _count: { configurations: number }; }
export interface HealthProvider { id: string; code: string; name: string; category: string; status: string; score: number; latencyMs: number; errorRate: number; }
export interface SyncHistoryEntry { id: string; resource: string; mode: string; status: string; recordsSynced: number; durationMs: number; startedAt: string; completedAt?: string; }
export interface CacheEntry { id: string; key: string; ttlSec: number; stale: boolean; hitCount: number; expiresAt: string; lastAccessedAt: string; }

export function useProviders(category?: string) {
  return useQuery({ queryKey: ["ext-providers", category], queryFn: () => api<ExtProvider[]>(`/api/v1/providers${category ? `?category=${category}` : ""}`) });
}
export function useProviderHealth(category?: string) {
  return useQuery({ queryKey: ["provider-health", category], queryFn: () => api<HealthProvider[]>(`/api/v1/providers/health${category ? `?category=${category}` : ""}`) });
}
export function useSyncHistory(orgId?: string) {
  return useQuery({ queryKey: ["sync-history", orgId], queryFn: () => api<SyncHistoryEntry[]>(`/api/v1/providers/sync${orgId ? `?organizationId=${orgId}` : ""}`) });
}
export function useCacheEntries(orgId?: string) {
  return useQuery({ queryKey: ["cache-entries", orgId], queryFn: () => api<CacheEntry[]>(`/api/v1/providers/cache${orgId ? `?organizationId=${orgId}` : ""}`) });
}
export function useSeedConnectors() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (force: boolean) => api<{ ok: boolean } & Record<string, number>>(`/api/v1/seed-connectors${force ? "?force=1" : ""}`, { method: "POST" }), onSuccess: () => qc.invalidateQueries() });
}

// Connector action hooks
export function useMapsAction() {
  return useMutation({
    mutationFn: (input: { action: "geocode" | "route"; address?: string; origin?: { lat: number; lng: number }; destination?: { lat: number; lng: number }; organizationId: string }) =>
      api<unknown>("/api/v1/providers/maps", { method: "POST", body: JSON.stringify(input) }),
  });
}
export function useWeatherAction() {
  return useMutation({
    mutationFn: (input: { lat: number; lng: number; organizationId: string; type?: "current" | "hourly" | "daily" }) =>
      api<unknown>("/api/v1/providers/weather", { method: "POST", body: JSON.stringify(input) }),
  });
}
export function useNotifyAction() {
  return useMutation({
    mutationFn: (input: { organizationId: string; channel: "EMAIL" | "SMS" | "PUSH" | "IN_APP"; to: string; templateCode: string; variables?: Record<string, string> }) =>
      api<unknown>("/api/v1/providers/notifications", { method: "POST", body: JSON.stringify(input) }),
  });
}
