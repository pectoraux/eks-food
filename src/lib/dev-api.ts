"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { error?: string; detail?: string })?.detail ?? (data as { error?: string })?.error ?? `request_failed (${res.status})`);
  return (data as { data?: T }).data ?? (data as T);
}

export interface DevExtension { id: string; identifier: string; name: string; description?: string; status: string; visibility: string; category?: string; tags: string; publisher: { handle: string; name: string; verificationStatus: string }; latestVersion?: { version: string; checksum: string }; _count: { installations: number; versions: number }; }
export interface DevConnector { id: string; code: string; name: string; description?: string; supportsWebhooks: boolean; supportsPolling: boolean; defaultSyncIntervalSec: number; active: boolean; _count: { configurations: number }; }
export interface DevConnectorExec { id: string; kind: string; status: string; durationMs: number; attempts: number; errorMessage?: string; startedAt: string; completedAt?: string; }
export interface DevWorkflow { id: string; name: string; description?: string; active: boolean; version: number; _count: { executions: number }; }
export interface DevWorkflowExec { id: string; status: string; stepsCompleted: string; stepsFailed: string; errorMessage?: string; startedAt: string; durationMs?: number; }
export interface DevPublisher { id: string; handle: string; name: string; description?: string; verificationStatus: string; contactEmail?: string; _count: { extensions: number; packages: number }; }
export interface DevEventReplay { id: string; eventId: string; eventType: string; mode: string; status: string; createdAt: string; }
export interface DevManifestValidation { valid: boolean; errors: string[]; manifest?: unknown }

export function useDevExtensions() { return useQuery({ queryKey: ["dev-extensions"], queryFn: () => api<DevExtension[]>("/api/v1/extensions") }); }
export function useDevConnectors() { return useQuery({ queryKey: ["dev-connectors"], queryFn: () => api<DevConnector[]>("/api/v1/connectors") }); }
export function useDevWorkflows(orgId?: string) { return useQuery({ queryKey: ["dev-workflows", orgId], queryFn: () => api<DevWorkflow[]>(`/api/v1/workflows${orgId ? `?organizationId=${orgId}` : ""}`) }); }
export function useDevPublishers() { return useQuery({ queryKey: ["dev-publishers"], queryFn: () => api<DevPublisher[]>("/api/v1/publishers") }); }
export function useDevReplays(orgId?: string) { return useQuery({ queryKey: ["dev-replays", orgId], queryFn: () => api<DevEventReplay[]>(`/api/v1/replay${orgId ? `?organizationId=${orgId}` : ""}`) }); }
export function useSeedDeveloper() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (force: boolean) => api<{ ok: boolean } & Record<string, number>>(`/api/v1/seed-developer${force ? "?force=1" : ""}`, { method: "POST" }), onSuccess: () => qc.invalidateQueries() });
}
export function useValidateManifest() {
  return useMutation({
    mutationFn: (manifest: unknown) => api<DevManifestValidation>("/api/v1/manifests", { method: "POST", body: JSON.stringify({ manifest }) }),
  });
}
export function useRunCli() {
  return useMutation({
    mutationFn: (argv: string[]) => api<{ success: boolean; message: string; data?: unknown }>("/api/v1/dev-cli", { method: "POST", body: JSON.stringify({ argv }) }),
  });
}
export function useWorkflowExecutions(workflowId?: string) {
  return useQuery({ enabled: !!workflowId, queryKey: ["workflow-execs", workflowId], queryFn: () => api<DevWorkflowExec[]>(`/api/v1/workflows/${workflowId}`) });
}
