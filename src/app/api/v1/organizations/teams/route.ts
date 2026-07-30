import { NextRequest } from "next/server";
import { z } from "zod";
import { TeamService } from "@eks/organizations";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

const svc = new TeamService();

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  if (!orgId) return success([]);
  return success(await svc.list(orgId));
});

const Schema = z.object({ organizationId: z.string(), name: z.string(), kind: z.string(), description: z.string().optional(), creatorUserId: z.string() });

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await svc.create(input.organizationId, input.name, input.kind, input.creatorUserId, input.description), { status: 201 });
});
