"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

/* ------------------------------------------------------------------ */
/* Fetch helpers                                                       */
/* ------------------------------------------------------------------ */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.error ?? data?.message ?? `request_failed (${res.status})`;
    throw new Error(typeof message === "string" ? message : "request_failed");
  }
  return data as T;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface PlatformResponse {
  organization: { slug: string; name: string; country: string; currency: string };
  principal: { userId: string; name: string; roles: string[] };
  services: Service[];
  mealCategories: MealCategory[];
  regions: Region[];
  pricingRules: PricingRule[];
  featureFlags: FeatureFlag[];
  kpis: {
    verifiedCooks: number;
    customers: number;
    totalBookings: number;
    completedBookings: number;
    grossPaymentVolume: number;
    workerPayouts: number;
  };
}
export interface Service {
  id: string; code: string; name: string; description: string;
  basePrice: number; currency: string; estimatedMins: number; active: boolean;
}
export interface MealCategory { id: string; name: string; icon: string | null; active: boolean; sortOrder: number; }
export interface Region { id: string; name: string; country: string; active: boolean; }
export interface PricingRule { id: string; name: string; kind: string; config: Record<string, unknown>; active: boolean; }
export interface FeatureFlag { id: string; key: string; enabled: boolean; config: Record<string, unknown>; }

export interface MatchedCook {
  cookId: string; userId: string; name: string; avatarUrl: string | null; bio: string;
  cuisines: string[]; skills: string[]; languages: string[];
  hourlyRate: number; currency: string; rating: number; totalJobs: number;
  completedJobs: number; responseTimeMins: number; verificationStatus: string;
  homeRegion: string | null; distanceKm: number; score: number;
  breakdown: { distance: number; rating: number; availability: number; cuisine: number; price: number; language: number; preference: number; };
}

export interface BookingResult {
  code: string; bookingId: string; status: string; quotedPrice: number; currency: string;
  service: { code: string; name: string }; scheduledFor: string;
  assignment: { assigned: boolean; cookId?: string; matchScore?: number; reason: string };
  candidates: MatchedCook[];
  payment: { payswapId: string; clientSecret: string; status: string };
}

export interface BookingListItem {
  code: string; bookingType: string; status: string; scheduledFor: string;
  durationMins: number; partySize: number; region: string; quotedPrice: number; currency: string;
  matchScore: number | null; service: { code: string; name: string };
  customer: { name: string };
  cook: { name: string; avatarUrl: string | null; rating: number } | null;
}

export interface CookWorkspace {
  profile: {
    cookId: string; name: string; avatarUrl: string | null; bio: string;
    cuisines: string[]; skills: string[]; languages: string[];
    hourlyRate: number; rating: number; totalJobs: number; completedJobs: number;
    responseTimeMins: number; verificationStatus: string; homeRegion: string | null;
    availabilityMode: string;
    certifications: { title: string; issuer: string; status: string; expiresAt: string | null }[];
  };
  upcoming: {
    code: string; status: string; scheduledFor: string; durationMins: number;
    partySize: number; region: string; service: string; customerName: string;
    quotedPrice: number; matchScore: number | null;
  }[];
  completed: { code: string; scheduledFor: string; service: string; customerName: string; quotedPrice: number }[];
  income: {
    totalPaid: number; payoutCount: number; currency: string;
    lastPayouts: { payswapId: string; amount: number; status: string; createdAt: string; metadata: Record<string, unknown> }[];
  };
  performance: {
    weekly: { week: string; earnings: number; jobs: number }[];
    completionRate: number; rating: number; responseTimeMins: number;
  };
}

export interface AnalyticsResponse {
  regionHeatmap: { region: string; avgDemand: number; bookings: number; avgPrice: number }[];
  cuisineTrends: { cuisine: string; bookings: number; avgPrice: number }[];
  hourly: { hour: number; bookings: number }[];
  daily: { day: string; bookings: number }[];
  operations: {
    byStatus: { status: string; count: number }[];
    grossPaymentVolume: number; workerPayouts: number;
    completionRate: number; cancellationRate: number; totalBookings: number;
  };
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

export function usePlatform() {
  return useQuery({
    queryKey: ["platform"],
    queryFn: () => api<PlatformResponse>("/api/platform"),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useSeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean) => api<{ ok: boolean } & Record<string, number>>(`/api/seed${force ? "?force=1" : ""}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      qc.invalidateQueries({ queryKey: ["cooks"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
}

export function useCooks(params: { lat?: number; lng?: number; cuisine?: string; region?: string; maxRate?: number; q?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params.lat !== undefined) qs.set("lat", String(params.lat));
  if (params.lng !== undefined) qs.set("lng", String(params.lng));
  if (params.cuisine) qs.set("cuisine", params.cuisine);
  if (params.region) qs.set("region", params.region);
  if (params.maxRate !== undefined) qs.set("maxRate", String(params.maxRate));
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));
  return useQuery({
    queryKey: ["cooks", qs.toString()],
    queryFn: () => api<{ cooks: MatchedCook[]; total: number; matched: boolean }>(`/api/cooks?${qs.toString()}`),
    staleTime: 15_000,
  });
}

export function useCookDetail(id: string | null) {
  return useQuery({
    enabled: !!id,
    queryKey: ["cook", id],
    queryFn: () => api<unknown>(`/api/cooks/${id}`),
  });
}

export function useBookings() {
  return useQuery({
    queryKey: ["bookings"],
    queryFn: () => api<{ bookings: BookingListItem[] }>("/api/bookings"),
    staleTime: 10_000,
  });
}

export interface CreateBookingInput {
  serviceCode: string; bookingType: string; scheduledFor: string;
  durationMins: number; partySize: number; addressLine1: string;
  city: string; region: string; lat: number; lng: number;
  notes?: string; cuisines?: string[]; languages?: string[]; autoAssign?: boolean;
  customerName?: string; customerEmail?: string;
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBookingInput) => api<BookingResult>("/api/bookings", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookings"] }),
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: ({ bookingCode, customerEmail }: { bookingCode: string; customerEmail?: string }) =>
      api<{ sessionId: string; paymentId: string; amount: number; currency: string; status: string }>("/api/payswap/checkout", { method: "POST", body: JSON.stringify({ bookingCode, customerEmail }) }),
  });
}

export function useConfirmPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ payswapId, method, provider }: { payswapId: string; method: "mobile_money" | "card" | "bank_transfer"; provider?: string }) =>
      api<{ payswapId: string; status: string; amount: number; currency: string; bookingCode: string | null; payoutInitiated: boolean }>("/api/payswap/confirm", { method: "POST", body: JSON.stringify({ payswapId, method, provider }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["payouts"] });
    },
  });
}

export function useCookWorkspace(cookId: string | null) {
  return useQuery({
    enabled: !!cookId,
    queryKey: ["cook-workspace", cookId],
    queryFn: () => api<CookWorkspace>(`/api/cook-workspace?cookId=${cookId}`),
    staleTime: 10_000,
  });
}

export function useAnalytics() {
  return useQuery({
    queryKey: ["analytics"],
    queryFn: () => api<AnalyticsResponse>("/api/analytics"),
    staleTime: 30_000,
  });
}

export function useAdminConfig() {
  return useQuery({
    queryKey: ["admin-config"],
    queryFn: () => api<{
      services: Service[]; mealCategories: MealCategory[]; regions: Region[];
      pricingRules: PricingRule[]; featureFlags: FeatureFlag[];
    }>("/api/admin/config"),
    staleTime: 10_000,
  });
}

export function useToggleFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      api<{ key: string; enabled: boolean }>("/api/admin/flags", { method: "PATCH", body: JSON.stringify({ key, enabled }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-config"] });
      qc.invalidateQueries({ queryKey: ["platform"] });
    },
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; name: string; description: string; basePrice: number; estimatedMins: number; active: boolean }) =>
      api<Service>("/api/admin/services", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-config"] });
      qc.invalidateQueries({ queryKey: ["platform"] });
    },
  });
}

export interface ChatMessage { role: "user" | "assistant"; content: string }

export function useAIAssistant() {
  return useMutation({
    mutationFn: ({ message, history, context }: { message: string; history: ChatMessage[]; context: "customer" | "cook" | "manager" | "admin" | "general" }) =>
      api<{ reply: string; context: string }>("/api/ai-assistant", { method: "POST", body: JSON.stringify({ message, history, context }) }),
  });
}
