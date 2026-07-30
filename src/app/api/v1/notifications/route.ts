import { NextRequest } from "next/server";
import { z } from "zod";
import { NotificationConnector } from "@eks/connectors";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const notif = new NotificationConnector();
const Schema = z.object({ organizationId: z.string(), channel: z.enum(["EMAIL", "SMS", "PUSH", "IN_APP"]), to: z.string(), templateCode: z.string(), variables: z.record(z.string(), z.string()).default({}) });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await notif.send(input));
});
