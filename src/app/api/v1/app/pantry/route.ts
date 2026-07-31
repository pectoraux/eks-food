import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";

/** GET /api/v1/app/pantry?userId=... — list pantry items */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const user = await db.user.findUnique({ where: { id: userId } }).catch(() => null);
  if (!user) return success([]);

  // Find or create household
  let household = await db.household.findFirst({ where: { name: { contains: userId.substring(0, 8) } } }).catch(() => null);
  if (!household) {
    household = await db.household.create({
      data: { organizationId: user.organizationId, name: `Household-${userId}` },
    }).catch(() => null);
  }
  if (!household) return success([]);

  // Find or create pantry
  let pantry = await db.pantry.findUnique({ where: { householdId: household.id } }).catch(() => null);
  if (!pantry) {
    pantry = await db.pantry.create({
      data: { householdId: household.id, organizationId: household.organizationId, name: "Main Pantry" },
    }).catch(() => null);
  }
  if (!pantry) return success([]);

  const items = await db.pantryItem.findMany({
    where: { pantryId: pantry.id, status: { not: "REMOVED" } },
    orderBy: { createdAt: "desc" },
  }).catch(() => []);

  return success(items.map((i) => ({
    id: i.id,
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    status: i.status,
    expirationDate: i.expirationDate,
  })));
}

/** POST /api/v1/app/pantry — add item to pantry */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId: string;
      name: string;
      quantity: number;
      unit: string;
      expirationDate?: string;
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

    // Find or create pantry
    let pantry = await db.pantry.findUnique({ where: { householdId: household.id } }).catch(() => null);
    if (!pantry) {
      pantry = await db.pantry.create({
        data: { householdId: household.id, organizationId: household.organizationId, name: "Main Pantry" },
      });
    }

    const item = await db.pantryItem.create({
      data: {
        pantryId: pantry.id,
        name: body.name,
        quantity: body.quantity,
        unit: body.unit,
        status: "IN_STOCK",
        expirationDate: body.expirationDate ? new Date(body.expirationDate) : null,
        addedById: body.userId,
      },
    });

    return success({ ok: true, id: item.id, name: item.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/v1/app/pantry?id=...&name=...&userId=... — remove item */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const name = req.nextUrl.searchParams.get("name");
    const userId = req.nextUrl.searchParams.get("userId");

    if (id) {
      await db.pantryItem.update({ where: { id }, data: { status: "REMOVED" } }).catch(() => {});
      return success({ ok: true });
    }

    if (name && userId) {
      // Find the user's household and pantry
      const household = await db.household.findFirst({ where: { name: { contains: userId } } }).catch(() => null);
      if (!household) return Response.json({ error: "Household not found" }, { status: 404 });

      const pantry = await db.pantry.findUnique({ where: { householdId: household.id } }).catch(() => null);
      if (!pantry) return Response.json({ error: "Pantry not found" }, { status: 404 });

      // Find the item by name and mark as removed
      const item = await db.pantryItem.findFirst({
        where: { pantryId: pantry.id, name: name, status: { not: "REMOVED" } },
      }).catch(() => null);

      if (!item) return Response.json({ error: "Item not found" }, { status: 404 });

      await db.pantryItem.update({ where: { id: item.id }, data: { status: "REMOVED" } });
      return success({ ok: true, name: item.name });
    }

    return Response.json({ error: "id or (name + userId) required" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
