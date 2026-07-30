"use client";

import { useQuery } from "@tanstack/react-query";

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `request_failed (${res.status})`);
  return (data as { data?: T }).data ?? (data as T);
}

export interface HealthReport {
  status: "healthy" | "degraded" | "unhealthy";
  checks: Array<{ name: string; kind: string; healthy: boolean; latencyMs: number; detail?: string }>;
  timestamp: string;
  uptimeMs: number;
}

export interface PackageInfo {
  name: string; path: string; responsibility: string; status: "operational";
}
export interface PackagesResponse {
  environment: string; isProduction: boolean; packages: PackageInfo[];
  config: { loaded: boolean; error: string | null };
  boundedContexts: number;
}

export interface EventStats {
  outbox: { pending: number; published: number; failed: number; total: number };
  deadLetterQueue: {
    size: number;
    entries: Array<{ eventId: string; eventType: string; subscriptionId: string; attempts: number; deadLetteredAt: string }>;
  };
}

export interface FlagInfo {
  key: string; enabled: boolean; evaluation: { key: string; enabled: boolean; reason: string };
}

export interface WorkerStats {
  stats: { pending: number; active: number; completed: number; failed: number; deadLettered: number };
  deadLetter: Array<{ id: string; type: string; attempts: number; createdAt: number }>;
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: () => api<HealthReport>("/api/v1/health"), refetchInterval: 5000 });
}
export function usePackages() {
  return useQuery({ queryKey: ["packages"], queryFn: () => api<PackagesResponse>("/api/v1/packages"), staleTime: 30000 });
}
export function useEventStats() {
  return useQuery({ queryKey: ["event-stats"], queryFn: () => api<EventStats>("/api/v1/events"), refetchInterval: 4000 });
}
export function useFlags() {
  return useQuery({ queryKey: ["flags"], queryFn: () => api<FlagInfo[]>("/api/v1/features"), staleTime: 10000 });
}
export function useWorkerStats() {
  return useQuery({ queryKey: ["worker-stats"], queryFn: () => api<WorkerStats>("/api/v1/workers"), refetchInterval: 4000 });
}
