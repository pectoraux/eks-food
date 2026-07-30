import { NextRequest } from "next/server";
import { z } from "zod";
import { InventoryService } from "@eks/fims";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new InventoryService();
const Schema = z.object({
  inventoryId: z.string(), type: z.enum(["RECEIVE","TRANSFER","CONSUME","ADJUST","WASTE","SPOILAGE","RETURN"]),
  quantity: z.number().positive(), unit: z.string().optional(), batchId: z.string().optional(),
  fromLocationId: z.string().optional(), toLocationId: z.string().optional(), reason: z.string().optional(),
  performedById: z.string().optional(),
});
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  return success(await svc.recordMovement(input));
});
