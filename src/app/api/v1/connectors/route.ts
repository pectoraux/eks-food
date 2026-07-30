import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const connectors = await db.connectorDefinition.findMany({
    include: { _count: { select: { configurations: true } } },
    orderBy: { code: "asc" },
  });
  return success(connectors);
});
