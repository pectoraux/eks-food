import { NextRequest } from "next/server";
import { queue } from "@eks/workers";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

/** GET /api/v1/workers — job-queue stats & dead-letter preview. */
export const GET = apiHandler(async (_req: NextRequest) => {
  const q = queue();
  return success({
    stats: q.stats(),
    deadLetter: q.deadLetter().slice(-10).map((j) => ({
      id: j.id, type: j.type, attempts: j.attempts, createdAt: j.createdAt,
    })),
  });
});
