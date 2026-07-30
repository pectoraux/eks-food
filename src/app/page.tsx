"use client";

import { useState, useEffect } from "react";
import { DevShell, type DevView } from "@/components/dev-shell";
import { Providers } from "@/components/providers";
import { DashboardView, ExtensionsView, ConnectorsView, WorkflowsView, EventsView, ManifestsView, CliView, PublishersView, LogsView, ReplayView, RuntimeView } from "@/components/dev-views";

/**
 * Eks-Food Developer Console — the visible surface of Milestone 3.
 * Extension management, event replay, connector inspection, API explorer,
 * runtime monitoring, and manifest validation.
 */
export default function Home() {
  return (
    <Providers>
      <DevConsole />
    </Providers>
  );
}

function DevConsole() {
  const [view, setView] = useState<DevView>("dashboard");

  // Auto-seed the Developer Platform on first load.
  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/v1/seed-developer", { method: "POST" });
      } catch {
        /* ignore */
      }
    })();
  }, []);

  return (
    <DevShell active={view} onNavigate={(v) => setView(v)}>
      {view === "dashboard" && <DashboardView onNavigate={(v) => setView(v as DevView)} />}
      {view === "extensions" && <ExtensionsView />}
      {view === "connectors" && <ConnectorsView />}
      {view === "workflows" && <WorkflowsView />}
      {view === "events" && <EventsView />}
      {view === "manifests" && <ManifestsView />}
      {view === "cli" && <CliView />}
      {view === "publishers" && <PublishersView />}
      {view === "logs" && <LogsView />}
      {view === "replay" && <ReplayView />}
      {view === "runtime" && <RuntimeView />}
    </DevShell>
  );
}
