import { NextRequest } from "next/server";
import { z } from "zod";
import { CalendarConnector } from "@eks/connectors";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const cal = new CalendarConnector();
const Schema = z.object({ connectionId: z.string(), action: z.enum(["list", "availability"]) });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  if (input.action === "list") return success(await cal.listEvents(input.connectionId));
  return success(await cal.checkAvailability(input.connectionId, new Date(), new Date(Date.now() + 86400000)));
});
