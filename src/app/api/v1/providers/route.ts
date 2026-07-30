import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category");
  const where = category ? { category } : {};
  const providers = await db.externalProvider.findMany({
    where,
    include: { health: { orderBy: { reportedAt: "desc" }, take: 1 }, capabilities2: { where: { supported: true } }, _count: { select: { configurations: true } } },
    orderBy: { category: "asc" },
  });
  return success(providers);
});
