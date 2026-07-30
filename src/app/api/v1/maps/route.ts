import { NextRequest } from "next/server";
import { z } from "zod";
import { MapsConnector } from "@eks/connectors";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const maps = new MapsConnector();
const GeocodeSchema = z.object({ address: z.string(), region: z.string().optional(), organizationId: z.string() });
const RouteSchema = z.object({ origin: z.object({ lat: z.number(), lng: z.number() }), destination: z.object({ lat: z.number(), lng: z.number() }), organizationId: z.string() });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const action = body.action as string;
  if (action === "geocode") { const input = GeocodeSchema.parse(body); return success(await maps.geocode(input)); }
  if (action === "route") { const input = RouteSchema.parse(body); return success(await maps.route(input)); }
  return success({ error: "Unknown action" });
});
