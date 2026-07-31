"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";

export default function Home() {
  return (
    <Providers>
      <AppShell />
    </Providers>
  );
}
