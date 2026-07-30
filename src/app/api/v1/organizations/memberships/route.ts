import { NextRequest } from "next/server";
import { z } from "zod";
import { MembershipService } from "@eks/organizations";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

const svc = new MembershipService();

const Schema = z.object({
  organizationId: z.string(),
  userId: z.string().optional(),
  roleCode: z.string().optional(),
  action: z.enum(["add", "remove", "changeRole", "suspend"]).optional(),
});

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const userId = req.nextUrl.searchParams.get("userId");
  if (userId) return success(await svc.listForUser(userId));
  if (orgId) return success(await svc.listForOrg(orgId));
  return success([]);
});

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  const actorId = req.headers.get("x-eks-actor") ?? "system";
  if (input.action === "add" && input.userId && input.roleCode) {
    return success(await svc.add(input.userId, input.organizationId, input.roleCode, actorId), { status: 201 });
  }
  if (input.action === "remove" && input.userId) {
    return success(await svc.remove(input.userId, input.organizationId, actorId));
  }
  if (input.action === "changeRole" && input.userId && input.roleCode) {
    return success(await svc.changeRole(input.userId, input.organizationId, input.roleCode, actorId));
  }
  if (input.action === "suspend" && input.userId) {
    return success(await svc.suspend(input.userId, input.organizationId, actorId, "manual"));
  }
  return success({ ok: false });
});
