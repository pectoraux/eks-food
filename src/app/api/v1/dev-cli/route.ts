import { NextRequest } from "next/server";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { runCommand } from "@eks/dev-cli";

export const dynamic = "force-dynamic";

/** POST /api/v1/dev-cli — run a CLI command. Body: { argv: ["create", "com.acme.x"] } */
export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json() as { argv?: string[] };
  const argv = body.argv ?? [];
  const result = await runCommand(argv);
  return success(result);
});
