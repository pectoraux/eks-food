"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { error?: string; detail?: string })?.detail ?? (data as { error?: string })?.error ?? `request_failed (${res.status})`);
  return (data as { data?: T }).data ?? (data as T);
}

export interface IntConnector { id: string; name: string; status: string; config: string; syncState: string; lastSyncAt?: string; connectorDef: { code: string; name: string }; credential: { name: string; authType: string } | null; _count: { executions: number; syncJobs: number; webhookEndpoints: number; pollingJobs: number }; }
export interface IntSyncJob { id: string; mode: string; status: string; recordsProcessed: number; recordsCreated: number; recordsUpdated: number; recordsFailed: number; conflicts: number; durationMs?: number; startedAt: string; completedAt?: string; _count: { checkpoints: number }; config: { connectorDef: { code: string } }; }
export interface IntWebhookEndpoint { id: string; url: string; eventTypes: string; active: boolean; verified: boolean; _count: { deliveries: number }; config: { connectorDef: { code: string } }; }
export interface IntWebhookDelivery { id: string; eventId: string; eventType: string; status: string; responseStatus?: number; attempts: number; errorMessage?: string; deliveredAt?: string; firstAttemptAt: string; }
export interface IntPollingJob { id: string; resource: string; intervalSec: number; adaptive: boolean; lastCursor?: string; lastRecordCount: number; status: string; lastPollAt?: string; config: { connectorDef: { code: string } }; }
export interface IntSchema { id: string; identifier: string; name: string; format: string; latestVersion?: { version: string }; _count: { versions: number }; }
export interface IntHealth { configId: string; status: string; latencyMs: number; errorRate: number; retryRate: number; throughput: number; syncLagSec: number; availability: number; reportedAt: string; }
export interface IntCredential { id: string; name: string; authType: string; active: boolean; expiresAt?: string; lastRotatedAt?: string; lastUsedAt?: string; }
export interface IntPolicies { retry: readonly { id: string; name: string; maxAttempts: number; baseDelayMs: number; budget: number; circuitBreaker: boolean }[]; rateLimit: readonly { id: string; name: string; capacity: number; refillRate: number; concurrencyLimit: number }[]; }

export function useIntConnectors(orgId?: string) { return useQuery({ queryKey: ["int-connectors", orgId], queryFn: () => api<IntConnector[]>(`/api/v1/integrations/connectors${orgId ? `?organizationId=${orgId}` : ""}`) }); }
export function useIntSyncJobs(orgId?: string) { return useQuery({ queryKey: ["int-sync", orgId], queryFn: () => api<IntSyncJob[]>(`/api/v1/integrations/sync${orgId ? `?organizationId=${orgId}` : ""}`) }); }
export function useIntWebhooks(orgId?: string) { return useQuery({ queryKey: ["int-webhooks", orgId], queryFn: () => api<IntWebhookEndpoint[]>(`/api/v1/integrations/webhooks${orgId ? `?organizationId=${orgId}` : ""}`) }); }
export function useIntWebhookDeliveries(endpointId?: string) { return useQuery({ enabled: !!endpointId, queryKey: ["int-deliveries", endpointId], queryFn: () => api<IntWebhookDelivery[]>(`/api/v1/integrations/webhook-deliveries?endpointId=${endpointId}`) }); }
export function useIntPolling(configId?: string) { return useQuery({ enabled: !!configId, queryKey: ["int-polling", configId], queryFn: () => api<IntPollingJob[]>(`/api/v1/integrations/polling?configId=${configId}`) }); }
export function useIntSchemas() { return useQuery({ queryKey: ["int-schemas"], queryFn: () => api<IntSchema[]>("/api/v1/integrations/schemas") }); }
export function useIntHealth(orgId?: string) { return useQuery({ queryKey: ["int-health", orgId], queryFn: () => api<IntHealth[]>(`/api/v1/integrations/health${orgId ? `?organizationId=${orgId}` : ""}`) }); }
export function useIntCredentials(orgId?: string) { return useQuery({ queryKey: ["int-credentials", orgId], queryFn: () => api<IntCredential[]>(`/api/v1/integrations/credentials${orgId ? `?organizationId=${orgId}` : ""}`) }); }
export function useIntPolicies() { return useQuery({ queryKey: ["int-policies"], queryFn: () => api<IntPolicies>("/api/v1/integrations/policies") }); }
export function useSeedIntegration() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (force: boolean) => api<{ ok: boolean } & Record<string, number>>(`/api/v1/seed-integration${force ? "?force=1" : ""}`, { method: "POST" }), onSuccess: () => qc.invalidateQueries() });
}
