import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Eks-Food — Food Services Operating System",
  description:
    "Eks-Food is the Food Services Operating System for Africa. Cooking-as-a-Service that connects households with trusted cooks, with a roadmap into procurement, shared cooking, marketplaces, inspections, ready meals, and food intelligence.",
  keywords: ["Eks-Food", "cooking as a service", "Africa", "food platform", "cooks", "food intelligence"],
  authors: [{ name: "Eks-Food" }],
  openGraph: {
    title: "Eks-Food — Food Services Operating System",
    description: "Cooking-as-a-Service for Africa. Hire trusted cooks, manage food operations, and scale across markets.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
          <Toaster />
          <SonnerToaster position="top-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
