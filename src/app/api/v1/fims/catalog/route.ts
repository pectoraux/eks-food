import { NextRequest } from "next/server";
import { CatalogService } from "@eks/fims";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const svc = new CatalogService();
export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  return success(await svc.search({
    q: sp.get("q") ?? undefined, itemType: sp.get("itemType") ?? undefined,
    barcode: sp.get("barcode") ?? undefined, sku: sp.get("sku") ?? undefined,
    category: sp.get("category") ?? undefined, allergen: sp.get("allergen") ?? undefined,
    dietary: sp.get("dietary") ?? undefined, limit: Number(sp.get("limit") ?? 20), offset: Number(sp.get("offset") ?? 0),
  }));
});
