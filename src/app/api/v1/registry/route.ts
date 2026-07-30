import { NextRequest } from "next/server";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { ExtensionRegistry } from "@eks/registry";

export const dynamic = "force-dynamic";

const registry = new ExtensionRegistry();

export const GET = apiHandler(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q") ?? undefined;
  const category = req.nextUrl.searchParams.get("category") ?? undefined;
  const extensions = await registry.list({ q, category, limit: 50 });
  return success(extensions);
});
