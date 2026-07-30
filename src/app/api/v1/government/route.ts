import { NextRequest } from "next/server";
import { z } from "zod";
import { GovernmentConnector } from "@eks/connectors";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const gov = new GovernmentConnector();
const Schema = z.object({ organizationId: z.string(), verificationType: z.string(), entityId: z.string(), country: z.string().optional() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await gov.verify(input));
});
