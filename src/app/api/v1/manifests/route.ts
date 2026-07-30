import { NextRequest } from "next/server";
import { z } from "zod";
import { ManifestValidator } from "@eks/registry";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

const validator = new ManifestValidator();

const Schema = z.object({ manifest: z.record(z.string(), z.unknown()) });

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  const result = validator.validate(input.manifest);
  return success(result);
});
