import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";

/** GET /api/v1/app/meal-plans?userId=... — list meal plans */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const household = await db.household.findFirst({ where: { name: { contains: userId } } }).catch(() => null);
  if (!household) return success([]);

  const plans = await db.mealPlan.findMany({
    where: { householdId: household.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  }).catch(() => []);

  return success(plans.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    startDate: p.startDate,
    endDate: p.endDate,
    status: p.status,
  })));
}

/** POST /api/v1/app/meal-plans — create a meal plan */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId: string;
      name: string;
      type?: string;
      startDate: string;
      endDate: string;
    };

    const user = await db.user.findUnique({ where: { id: body.userId } });
    if (!user) return Response.json({ error: "User not found" }, { status: 404 });

    // Find or create household
    let household = await db.household.findFirst({ where: { name: { contains: body.userId } } }).catch(() => null);
    if (!household) {
      household = await db.household.create({
        data: { organizationId: user.organizationId, name: `Household-${body.userId}` },
      });
    }

    const plan = await db.mealPlan.create({
      data: {
        householdId: household.id,
        organizationId: household.organizationId,
        name: body.name,
        type: body.type ?? "WEEKLY",
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        status: "DRAFT",
      },
    });

    return success({ ok: true, id: plan.id, name: plan.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
