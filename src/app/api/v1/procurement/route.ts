import { NextRequest } from "next/server";
import { z } from "zod";
import { ProcurementConnector } from "@eks/connectors";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const proc = new ProcurementConnector();
const Schema = z.object({ connectionId: z.string() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await proc.syncCatalog(input));
});
