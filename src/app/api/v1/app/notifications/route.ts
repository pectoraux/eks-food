import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";

/** GET /api/v1/app/notifications?userId=... — list notifications */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const notifications = await db.notificationLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
  }).catch(() => []);

  return success(notifications.map((n) => {
    const payload = JSON.parse(n.payload || "{}");
    return {
      id: n.id,
      type: n.templateCode,
      title: payload.title ?? n.templateCode,
      body: payload.body ?? "",
      readAt: payload.readAt ?? null,
      createdAt: n.createdAt,
    };
  }));
}
