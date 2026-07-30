"use client";

import { useState } from "react";
import { FoundationShell, type ConsoleView } from "@/components/foundation-shell";
import { Providers } from "@/components/providers";
import { OverviewView, PackagesView, HealthView, EventsView, WorkersView, FlagsView, DocsView } from "@/components/foundation-views";

/**
 * Platform Foundation Console — the visible surface of Milestone 1.
 *
 * The bootstrap (config load + logger init) happens server-side inside the
 * `/api/v1/*` route handlers, which import `@eks/config` and
 * `@eks/observability` (Node-only modules). This client component only renders
 * the console UI and consumes the foundation APIs via TanStack Query.
 */
export default function Home() {
  const [view, setView] = useState<ConsoleView>("overview");

  return (
    <Providers>
      <FoundationShell active={view} onNavigate={(v) => setView(v)}>
        {view === "overview" && <OverviewView onNavigate={(v) => setView(v as ConsoleView)} />}
        {view === "packages" && <PackagesView />}
        {view === "health" && <HealthView />}
        {view === "events" && <EventsView />}
        {view === "workers" && <WorkersView />}
        {view === "flags" && <FlagsView />}
        {view === "docs" && <DocsView />}
      </FoundationShell>
    </Providers>
  );
}
