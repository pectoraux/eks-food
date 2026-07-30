import { NextRequest } from "next/server";
import { DomainService } from "@eks/food-domain";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new DomainService();
export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const entityType = sp.get("entityType") ?? "INGREDIENT";
  const orgId = sp.get("organizationId") ?? undefined;
  const limit = Math.min(50, Number(sp.get("limit") ?? 20));
  const offset = Number(sp.get("offset") ?? 0);
  return success(await svc.list(entityType, orgId, limit, offset));
});
