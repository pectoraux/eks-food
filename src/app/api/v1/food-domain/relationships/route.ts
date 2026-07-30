import { NextRequest } from "next/server";
import { DomainService } from "@eks/food-domain";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new DomainService();
export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const entityType = sp.get("entityType")!;
  const entityId = sp.get("entityId")!;
  const type = sp.get("type") ?? undefined;
  return success(await svc.relationships(entityType, entityId, type));
});
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  return success(await svc.createRelationship(body));
});
