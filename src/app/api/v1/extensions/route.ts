import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? undefined;
  const category = sp.get("category") ?? undefined;
  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (q) where.OR = [{ name: { contains: q } }, { description: { contains: q } }, { identifier: { contains: q } }];
  const extensions = await db.extension.findMany({
    where,
    include: { publisher: true, latestVersion: true, _count: { select: { installations: true, versions: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return success(extensions);
});
