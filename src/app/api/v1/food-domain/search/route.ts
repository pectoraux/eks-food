import { NextRequest } from "next/server";
import { SearchEngine } from "@eks/food-domain";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
export const dynamic = "force-dynamic";
const search = new SearchEngine();
export const GET = apiHandler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  if (sp.get("autocomplete") === "1") return success(await search.autocomplete(q, 10));
  return success(await search.search({ q, entityType: sp.get("entityType") ?? undefined, limit: Number(sp.get("limit") ?? 20) }));
});
