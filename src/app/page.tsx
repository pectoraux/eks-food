"use client";

import { useState, useEffect } from "react";
import { DevShell, type DevView } from "@/components/dev-shell";
import { Providers } from "@/components/providers";
import { DashboardView, ExtensionsView, ConnectorsView, WorkflowsView, EventsView, ManifestsView, CliView, PublishersView, LogsView, ReplayView, RuntimeView } from "@/components/dev-views";
import { ConnectorRegistryView, SyncMonitorView, WebhookExplorerView, PollingExplorerView, SchemaExplorerView, HealthDashboardView, CredentialsView, PoliciesView } from "@/components/integration-views";

/**
 * Eks-Food Developer Console — the visible surface of Milestones 3 + 4.
 * Extension management + Universal Connector Platform.
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

  // Auto-seed both the Developer Platform (M3) and Connector Platform (M4).
  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/v1/seed-developer", { method: "POST" });
        await fetch("/api/v1/seed-integration", { method: "POST" });
      } catch {
        /* ignore */
      }
    })();
  }, []);

  return (
    <DevShell active={view} onNavigate={(v) => setView(v)}>
      {/* M3 views */}
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
      {/* M4 views */}
      {view === "conn-registry" && <ConnectorRegistryView />}
      {view === "sync-monitor" && <SyncMonitorView />}
      {view === "webhook-explorer" && <WebhookExplorerView />}
      {view === "polling-explorer" && <PollingExplorerView />}
      {view === "schema-explorer" && <SchemaExplorerView />}
      {view === "health-dashboard" && <HealthDashboardView />}
      {view === "credentials" && <CredentialsView />}
      {view === "policies" && <PoliciesView />}
    </DevShell>
  );
}
