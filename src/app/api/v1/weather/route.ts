import { NextRequest } from "next/server";
import { z } from "zod";
import { WeatherConnector } from "@eks/connectors";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const weather = new WeatherConnector();
const Schema = z.object({ lat: z.number(), lng: z.number(), organizationId: z.string(), type: z.enum(["current", "hourly", "daily"]).default("current") });
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  if (input.type === "hourly") return success(await weather.hourlyForecast(input));
  if (input.type === "daily") return success(await weather.dailyForecast(input));
  return success(await weather.current(input));
});
