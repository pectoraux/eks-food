import { NextRequest } from "next/server";
import { z } from "zod";
import { InvitationService } from "@eks/organizations";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

const svc = new InvitationService();

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  if (!orgId) return success([]);
  return success(await svc.list(orgId));
});

const Schema = z.object({ organizationId: z.string(), email: z.string().email(), roleCode: z.string(), invitedById: z.string() });

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  const result = await svc.create(input.organizationId, input.email, input.roleCode, input.invitedById);
  return success({ id: result.invitation.id, email: input.email, expiresAt: result.invitation.expiresAt, rawToken: result.rawToken }, { status: 201 });
});
