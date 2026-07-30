import { NextRequest } from "next/server";
import { flags } from "@eks/features";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

/** GET /api/v1/features — all feature flags with evaluation. */
export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("orgId") ?? undefined;
  const all = await flags().all();
  return success(
    all.map((f) => ({ ...f, evaluation: flags().evaluate(f.key, orgId) }))
  );
});
