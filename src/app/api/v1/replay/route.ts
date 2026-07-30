import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildDeveloperEvent } from "@eks/developer";
import { outbox } from "@eks/events";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { asUUID } from "@eks/common";

export const dynamic = "force-dynamic";

const Schema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  organizationId: z.string(),
  mode: z.enum(["DRY_RUN", "EXECUTE"]).default("DRY_RUN"),
  originalPayload: z.record(z.string(), z.unknown()).default({}),
  requestedById: z.string(),
});

export const GET = apiHandler(async (req: NextRequest) => {
  const orgId = req.nextUrl.searchParams.get("organizationId");
  const where = orgId ? { organizationId: orgId } : {};
  const replays = await db.eventReplay.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
  return success(replays);
});

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json();
  const input = Schema.parse(body);
  const replay = await db.eventReplay.create({
    data: {
      organizationId: input.organizationId,
      eventId: input.eventId,
      eventType: input.eventType,
      mode: input.mode,
      status: "COMPLETED",
      originalPayload: JSON.stringify(input.originalPayload),
      result: JSON.stringify({ replayed: input.mode === "EXECUTE", handlers: 0 }),
      requestedById: input.requestedById,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  if (input.mode === "EXECUTE") {
    const event = buildDeveloperEvent("EventReplayed", asUUID(replay.id), { eventType: input.eventType, organizationId: input.organizationId });
    await outbox().stage(event);
  }
  return success(replay, { status: 201 });
});
