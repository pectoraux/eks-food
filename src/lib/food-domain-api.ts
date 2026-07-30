"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { error?: string; detail?: string })?.detail ?? (data as { error?: string })?.error ?? `request_failed (${res.status})`);
  return (data as { data?: T }).data ?? (data as T);
}

export interface GraphMetrics { nodes: number; edges: number; edgeTypes: Record<string, number>; }
export interface SearchResults { results: readonly { id: string; entityType: string; name: string; description?: string; score: number }[]; total: number; }
export interface TraversalResult { visited: readonly string[]; path: readonly string[]; depth: number; }
export interface PathResult { found: boolean; path: readonly string[]; hops: number; totalWeight: number; }

export function useEntities(entityType: string, orgId?: string) {
  return useQuery({ queryKey: ["fd-entities", entityType, orgId], queryFn: () => api<unknown[]>(`/api/v1/food-domain/entities?entityType=${entityType}${orgId ? `&organizationId=${orgId}` : ""}`) });
}
export function useGraphMetrics(orgId?: string) {
  return useQuery({ queryKey: ["graph-metrics", orgId], queryFn: () => api<GraphMetrics>(`/api/v1/food-domain/graph?action=metrics${orgId ? `&organizationId=${orgId}` : ""}`) });
}
export function useGraphNeighbors(entityType?: string, entityId?: string, edgeType?: string) {
  return useQuery({ enabled: !!entityType && !!entityId, queryKey: ["graph-neighbors", entityType, entityId, edgeType], queryFn: () => api<unknown[]>(`/api/v1/food-domain/graph?action=neighbors&entityType=${entityType}&entityId=${entityId}${edgeType ? `&edgeType=${edgeType}` : ""}`) });
}
export function useGraphTraverse(entityType?: string, entityId?: string, maxDepth?: number) {
  return useQuery({ enabled: !!entityType && !!entityId, queryKey: ["graph-traverse", entityType, entityId, maxDepth], queryFn: () => api<TraversalResult>(`/api/v1/food-domain/graph?action=traverse&entityType=${entityType}&entityId=${entityId}&maxDepth=${maxDepth ?? 3}`) });
}
export function useGraphShortestPath(from?: { type: string; id: string }, to?: { type: string; id: string }) {
  return useQuery({ enabled: !!from && !!to, queryKey: ["graph-path", from, to], queryFn: () => api<PathResult>(`/api/v1/food-domain/graph?action=shortestPath&entityType=${from!.type}&entityId=${from!.id}&toEntityType=${to!.type}&toEntityId=${to!.id}`) });
}
export function useSearch(q: string, entityType?: string) {
  return useQuery({ enabled: q.length >= 2, queryKey: ["fd-search", q, entityType], queryFn: () => api<SearchResults>(`/api/v1/food-domain/search?q=${encodeURIComponent(q)}${entityType ? `&entityType=${entityType}` : ""}`) });
}
export function useAutocomplete(prefix: string) {
  return useQuery({ enabled: prefix.length >= 2, queryKey: ["fd-autocomplete", prefix], queryFn: () => api<readonly { name: string; entityType: string }[]>(`/api/v1/food-domain/search?q=${encodeURIComponent(prefix)}&autocomplete=1`) });
}
export function useRelationships(entityType?: string, entityId?: string) {
  return useQuery({ enabled: !!entityType && !!entityId, queryKey: ["fd-relationships", entityType, entityId], queryFn: () => api<unknown[]>(`/api/v1/food-domain/relationships?entityType=${entityType}&entityId=${entityId}`) });
}
export function useSeedFoodDomain() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (force: boolean) => api<{ ok: boolean } & Record<string, number>>(`/api/v1/food-domain/seed${force ? "?force=1" : ""}`, { method: "POST" }), onSuccess: () => qc.invalidateQueries() });
}
