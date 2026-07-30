import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
export const GET = apiHandler(async (req: NextRequest) => {
  const invId = req.nextUrl.searchParams.get("inventoryId");
  const where = invId ? { inventoryId: invId } : {};
  return success(await db.inventoryBatch.findMany({ where, orderBy: { receivedAt: "desc" }, take: 50 }));
});
