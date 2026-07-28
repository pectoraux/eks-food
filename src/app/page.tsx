"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { useAppStore } from "@/lib/store";
import { useSeed } from "@/lib/api";
import { OverviewModule } from "@/components/modules/overview-module";
import { BookACookModule } from "@/components/modules/book-a-cook-module";
import { CookWorkspaceModule } from "@/components/modules/cook-workspace-module";
import { AdminConfigModule } from "@/components/modules/admin-config-module";
import { FoodIntelligenceModule } from "@/components/modules/food-intelligence-module";
import { AIAssistantModule } from "@/components/modules/ai-assistant-module";

export default function Home() {
  return (
    <Providers>
      <AppShell>
        <ModuleRouter />
      </AppShell>
    </Providers>
  );
}

function ModuleRouter() {
  const activeModule = useAppStore((s) => s.activeModule);
  const seed = useSeed();

  // Auto-seed on first load if the platform isn't initialised.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/seed");
        const data = await res.json();
        if (!cancelled && data?.seeded === false) {
          seed.mutate(false);
        }
      } catch {
        /* ignore — user can seed manually */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  switch (activeModule) {
    case "overview":
      return <OverviewModule />;
    case "book":
      return <BookACookModule />;
    case "cook":
      return <CookWorkspaceModule />;
    case "admin":
      return <AdminConfigModule />;
    case "intelligence":
      return <FoodIntelligenceModule />;
    case "assistant":
      return <AIAssistantModule />;
    default:
      return <OverviewModule />;
  }
}
