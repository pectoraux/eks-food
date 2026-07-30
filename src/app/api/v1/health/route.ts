import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req: NextRequest) => {
  const category = req.nextUrl.searchParams.get("category");
  const where = category ? { category } : {};
  const providers = await db.externalProvider.findMany({
    where,
    include: { health: { orderBy: { reportedAt: "desc" }, take: 1 } },
  });
  return success(providers.map((p) => ({
    id: p.id, code: p.code, name: p.name, category: p.category,
    status: p.health[0]?.status ?? "HEALTHY",
    score: p.health[0]?.score ?? 100,
    latencyMs: p.health[0]?.latencyMs ?? 0,
    errorRate: p.health[0]?.errorRate ?? 0,
  })));
});
