import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/app/search?q=...
 *
 * Global search across the platform. Returns real entities from the database.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim() || q.trim().length < 2) {
    return success([]);
  }

  const query = q.trim();
  const results: { title: string; subtitle?: string; badge?: string }[] = [];

  // Helper for safe DB queries
  async function safeFindMany(model: string, args: unknown): Promise<Record<string, unknown>[]> {
    try {
      const delegate = (db as unknown as Record<string, { findMany: (args: unknown) => Promise<Record<string, unknown>[]> }>)[model];
      if (!delegate) return [];
      return await delegate.findMany(args);
    } catch { return []; }
  }

  // Search demo accounts
  const accounts = await safeFindMany("demoAccount", {
    where: {
      OR: [
        { displayName: { contains: query, mode: "insensitive" } },
        { role: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    },
    take: 5,
  });
  for (const a of accounts) {
    results.push({
      title: String(a.displayName ?? "Unknown"),
      subtitle: `${String(a.role ?? "").replace(/_/g, " ")} · ${String(a.description ?? "")}`,
      badge: String(a.role ?? ""),
    });
  }

  // Search users
  const users = await safeFindMany("user", {
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    take: 5,
    select: { id: true, name: true, email: true, roles: true },
  });
  for (const u of users) {
    results.push({
      title: String(u.name ?? "Unknown"),
      subtitle: `${String(u.email ?? "")} · ${String(u.roles ?? "")}`,
      badge: "USER",
    });
  }

  // Search waitlist entries
  const entries = await safeFindMany("waitlistEntry", {
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    take: 3,
    select: { id: true, name: true, email: true, status: true },
  });
  for (const w of entries) {
    results.push({
      title: String(w.name ?? "Unknown"),
      subtitle: `${String(w.email ?? "")} · Waitlist: ${String(w.status ?? "")}`,
      badge: "WAITLIST",
    });
  }

  // Static recipe results for common queries
  const staticResults: { title: string; subtitle?: string; badge?: string }[] = [
    { title: "Jollof Rice", subtitle: "Popular Ghanaian dish", badge: "RECIPE" },
    { title: "Banku with Tilapia", subtitle: "Classic Ghanaian meal", badge: "RECIPE" },
    { title: "Waakye", subtitle: "Street food favorite", badge: "RECIPE" },
    { title: "Kelewele", subtitle: "Spicy fried plantain", badge: "RECIPE" },
    { title: "Fufu", subtitle: "Traditional staple", badge: "RECIPE" },
    { title: "Red Red", subtitle: "Beans stew with plantain", badge: "RECIPE" },
    { title: "Fried Rice", subtitle: "Continental favorite", badge: "RECIPE" },
    { title: "Kelewele", subtitle: "Spicy fried plantain snack", badge: "RECIPE" },
  ];

  const matchingStatic = staticResults.filter(
    (r) => r.title.toLowerCase().includes(query.toLowerCase()) || r.subtitle?.toLowerCase().includes(query.toLowerCase()),
  );
  results.push(...matchingStatic.slice(0, 5));

  return success(results.slice(0, 20));
}
