"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { error?: string; detail?: string })?.detail ?? (data as { error?: string })?.error ?? `request_failed (${res.status})`);
  return (data as { data?: T }).data ?? (data as T);
}

export interface FimsCatalogItem { id: string; code: string; name: string; itemType: string; status: string; barcode?: string; sku?: string; _count: { variants: number; nutritionFacts: number }; }
export interface FimsWasteRecord { id: string; type: string; quantity: number; unit: string; reason?: string; createdAt: string; }
export interface FimsMovement { id: string; type: string; quantity: number; unit: string; createdAt: string; metadata: string; }

export function useCatalogSearch(q?: string, itemType?: string) {
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (itemType) qs.set("itemType", itemType);
  qs.set("limit", "50");
  return useQuery({ queryKey: ["fims-catalog", q, itemType], queryFn: () => api<{ items: FimsCatalogItem[]; total: number }>(`/api/v1/fims/catalog?${qs}`) });
}
export function useMeasurementUnits() {
  return useQuery({ queryKey: ["fims-units"], queryFn: () => api<readonly { code: string; name: string; type: string; base: string; factor: number }[]>("/api/v1/fims/measurements?action=units") });
}
export function useWasteRecords(orgId?: string) {
  return useQuery({ queryKey: ["fims-waste", orgId], queryFn: () => api<FimsWasteRecord[]>(`/api/v1/fims/waste${orgId ? `?organizationId=${orgId}` : ""}`) });
}
export function useScaleRecipe() {
  return useMutation({
    mutationFn: (input: { recipeId: string; originalServings: number; targetServings: number; ingredients: { ingredientId: string; name: string; quantity: number; unit: string }[] }) =>
      api<unknown>("/api/v1/fims/recipes/scale", { method: "POST", body: JSON.stringify(input) }),
  });
}
export function useConvertMeasurement() {
  return useMutation({
    mutationFn: (input: { value: number; from: string; to: string; ingredient?: string }) => {
      const qs = new URLSearchParams({ value: String(input.value), from: input.from, to: input.to });
      if (input.ingredient) qs.set("ingredient", input.ingredient);
      return api<unknown>(`/api/v1/fims/measurements?${qs}`);
    },
  });
}
export function useCalculateNutrition() {
  return useMutation({
    mutationFn: (input: { ingredients: unknown[]; servings: number }) =>
      api<unknown>("/api/v1/fims/nutrition", { method: "POST", body: JSON.stringify(input) }),
  });
}
export function useSeedFims() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (force: boolean) => api<{ ok: boolean } & Record<string, number>>(`/api/v1/fims/seed${force ? "?force=1" : ""}`, { method: "POST" }), onSuccess: () => qc.invalidateQueries() });
}
