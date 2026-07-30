import { NextRequest } from "next/server";
import { GraphEngine } from "@eks/food-domain";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const graph = new GraphEngine();
export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action");
  const orgId = sp.get("organizationId") ?? undefined;
  if (action === "metrics") return success(await graph.metrics(orgId));
  const entityType = sp.get("entityType")!;
  const entityId = sp.get("entityId")!;
  if (action === "neighbors") return success(await graph.neighbors(entityType, entityId, sp.get("edgeType") ?? undefined));
  if (action === "traverse") return success(await graph.traverse(entityType, entityId, Number(sp.get("maxDepth") ?? 3), sp.get("edgeType") ?? undefined));
  if (action === "shortestPath") return success(await graph.shortestPath(entityType, entityId, sp.get("toEntityType")!, sp.get("toEntityId")!));
  return success({ error: "Unknown action" });
});
