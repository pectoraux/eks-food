"use client";

import { useState, useEffect } from "react";
import { DevShell, type DevView } from "@/components/dev-shell";
import { Providers } from "@/components/providers";
import { DashboardView, ExtensionsView, ConnectorsView, WorkflowsView, EventsView, ManifestsView, CliView, PublishersView, LogsView, ReplayView, RuntimeView } from "@/components/dev-views";
import { ConnectorRegistryView, SyncMonitorView, WebhookExplorerView, PollingExplorerView, SchemaExplorerView, HealthDashboardView, CredentialsView, PoliciesView } from "@/components/integration-views";
import { ProviderRegistryView, ConnectorHealthView, SyncDashboardView, CacheInspectorView, ApiExplorerView } from "@/components/connectors-views";
import { GraphExplorerView, SearchView, EntityBrowserView } from "@/components/food-domain-views";
import { CatalogExplorerView, RecipeDebuggerView, MeasurementConverterView, WasteDashboardView } from "@/components/fims-views";

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
        await fetch("/api/v1/seed-connectors", { method: "POST" });
        await fetch("/api/v1/food-domain/seed", { method: "POST" });
        await fetch("/api/v1/fims/seed", { method: "POST" });
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
      {/* M5 views */}
      {view === "provider-registry" && <ProviderRegistryView />}
      {view === "connector-health" && <ConnectorHealthView />}
      {view === "sync-dashboard" && <SyncDashboardView />}
      {view === "cache-inspector" && <CacheInspectorView />}
      {view === "api-explorer" && <ApiExplorerView />}
      {/* M6 views */}
      {view === "graph-explorer" && <GraphExplorerView />}
      {view === "fd-search" && <SearchView />}
      {view === "entity-browser" && <EntityBrowserView />}
      {/* M7 views */}
      {view === "fims-catalog" && <CatalogExplorerView />}
      {view === "fims-recipe" && <RecipeDebuggerView />}
      {view === "fims-measurement" && <MeasurementConverterView />}
      {view === "fims-waste" && <WasteDashboardView />}
    </DevShell>
  );
}
