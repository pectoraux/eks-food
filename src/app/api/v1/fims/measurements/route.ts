import { NextRequest } from "next/server";
import { MeasurementConverter } from "@eks/fims";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const converter = new MeasurementConverter();
export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action");
  if (action === "units") return success(converter.listUnits());
  const value = Number(sp.get("value"));
  const from = sp.get("from")!;
  const to = sp.get("to")!;
  const ingredient = sp.get("ingredient") ?? undefined;
  return success(converter.convert(value, from, to, ingredient));
});
