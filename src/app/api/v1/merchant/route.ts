import { NextRequest } from "next/server";
import { z } from "zod";
import { MerchantConnector } from "@eks/connectors";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const merch = new MerchantConnector();
const Schema = z.object({ connectionId: z.string() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await merch.importContract(input.connectionId));
});
