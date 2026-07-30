"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ModuleId =
  | "overview"
  | "book"
  | "cook"
  | "admin"
  | "intelligence"
  | "assistant";

export interface BookingDraft {
  serviceCode?: string;
  bookingType?: string;
  scheduledFor?: string;
  durationMins?: number;
  partySize?: number;
  addressLine1?: string;
  city?: string;
  region?: string;
  lat?: number;
  lng?: number;
  notes?: string;
  cuisines?: string[];
  languages?: string[];
}

interface AppState {
  activeModule: ModuleId;
  setActiveModule: (m: ModuleId) => void;

  selectedCookId: string | null;
  setSelectedCook: (id: string | null) => void;

  activeCookId: string | null; // for Cook Workspace
  setActiveCookId: (id: string | null) => void;

  bookingDraft: BookingDraft;
  setBookingDraft: (d: Partial<BookingDraft>) => void;
  resetBookingDraft: () => void;

  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const defaultDraft: BookingDraft = {
  serviceCode: "IN_HOME_COOKING",
  bookingType: "SCHEDULED",
  scheduledFor: defaultFutureDate(),
  durationMins: 120,
  partySize: 4,
  addressLine1: "12 Liberation Road",
  city: "Accra",
  region: "East Legon",
  lat: 5.645,
  lng: -0.181,
  cuisines: ["ghanaian"],
  languages: ["en"],
};

function defaultFutureDate() {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(18, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeModule: "overview",
      setActiveModule: (m) => set({ activeModule: m }),

      selectedCookId: null,
      setSelectedCook: (id) => set({ selectedCookId: id }),

      activeCookId: null,
      setActiveCookId: (id) => set({ activeCookId: id }),

      bookingDraft: defaultDraft,
      setBookingDraft: (d) => set((s) => ({ bookingDraft: { ...s.bookingDraft, ...d } })),
      resetBookingDraft: () => set({ bookingDraft: defaultDraft }),

      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: "eks-food-store",
      partialize: (s) => ({
        activeModule: s.activeModule,
        activeCookId: s.activeCookId,
        bookingDraft: s.bookingDraft,
      }),
    }
  )
);
