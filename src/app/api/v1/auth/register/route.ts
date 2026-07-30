import { NextRequest } from "next/server";
import { z } from "zod";
import { register } from "@eks/auth";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

const Schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  phone: z.string().optional(),
  organizationId: z.string().min(1),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  const result = await register(input);
  return success(result, { status: 201 });
});
