import { NextRequest } from "next/server";
import { z } from "zod";
import { OrganizationService } from "@eks/organizations";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

const svc = new OrganizationService();

export const GET = apiHandler(async () => {
  const orgs = await svc.list();
  return success(orgs);
});

const CreateSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  country: z.string().min(2),
  baseCurrency: z.string().optional(),
  typeCode: z.string().optional(),
  creatorUserId: z.string().min(1),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = CreateSchema.parse(body);
  const result = await svc.create(input);
  return success(result, { status: 201 });
});
