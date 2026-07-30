import { NextRequest } from "next/server";
import { OrganizationService } from "@eks/organizations";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

const svc = new OrganizationService();

export const GET = apiHandler(async (_req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
  const { id } = await ctx.params;
  return success(await svc.get(id));
});
