"use client";

import { useState, useEffect } from "react";
import { IAMShell, type IAMView } from "@/components/iam-shell";
import { Providers } from "@/components/providers";
import { DashboardView, LoginView, UsersView, OrganizationsView, RolesView, PermissionsView, SessionsView, AuditView, InvitationsView, ProfileView, MFAView } from "@/components/iam-views";

/**
 * Eks-Food IAM Console — the visible surface of Milestone 2.
 * Admin Console + User Portal for the enterprise Identity & Access platform.
 */
export default function Home() {
  return (
    <Providers>
      <IAMConsole />
    </Providers>
  );
}

function IAMConsole() {
  const [view, setView] = useState<IAMView>("dashboard");

  // Auto-seed the IAM platform on first load so the console has data.
  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/v1/seed-identity", { method: "POST" });
      } catch {
        /* ignore — user can seed manually */
      }
    })();
  }, []);

  return (
    <IAMShell active={view} onNavigate={(v) => setView(v)}>
      {view === "dashboard" && <DashboardView onNavigate={(v) => setView(v as IAMView)} />}
      {view === "login" && <LoginView onNavigate={(v) => setView(v as IAMView)} />}
      {view === "users" && <UsersView />}
      {view === "organizations" && <OrganizationsView />}
      {view === "roles" && <RolesView />}
      {view === "permissions" && <PermissionsView />}
      {view === "sessions" && <SessionsView />}
      {view === "audit" && <AuditView />}
      {view === "invitations" && <InvitationsView />}
      {view === "profile" && <ProfileView />}
      {view === "mfa" && <MFAView />}
    </IAMShell>
  );
}
