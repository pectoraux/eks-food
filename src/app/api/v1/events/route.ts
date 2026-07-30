import { NextRequest } from "next/server";
import { outbox } from "@eks/events";
import { dlq } from "@eks/events";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

/** GET /api/v1/events — outbox & dead-letter queue observability. */
export const GET = apiHandler(async (_req: NextRequest) => {
  return success({
    outbox: outbox().stats(),
    deadLetterQueue: {
      size: dlq().size(),
      entries: dlq().list().slice(-20).map((e) => ({
        eventId: e.event.eventId,
        eventType: e.event.eventType,
        subscriptionId: e.subscriptionId,
        attempts: e.attempts,
        deadLetteredAt: e.deadLetteredAt,
        error: e instanceof Error ? e.message : String(e.error),
      })),
    },
  });
});
