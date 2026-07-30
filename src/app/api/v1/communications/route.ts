import { NextRequest } from "next/server";
import { z } from "zod";
import { CommunicationConnector } from "@eks/connectors";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const comm = new CommunicationConnector();
const Schema = z.object({ organizationId: z.string(), channel: z.enum(["VOICE", "CHAT", "EMAIL", "SMS"]), to: z.string(), message: z.string() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await comm.deliver(input));
});
