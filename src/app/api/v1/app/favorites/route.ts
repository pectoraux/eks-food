import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";

/** GET /api/v1/app/favorites?userId=... — list user's favorite cooks */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  // Get the customer record for this user
  const customer = await db.customer.findUnique({ where: { userId } });
  if (!customer) return success([]);

  const favorites = await db.favorite.findMany({
    where: { customerId: customer.id },
    include: { cook: { include: { user: true } } },
    orderBy: { createdAt: "desc" },
  });

  return success(favorites.map((f) => ({
    id: f.id,
    cookId: f.cookId,
    cookName: f.cook?.user?.name ?? "Unknown",
    cuisine: f.cook?.cuisines ?? "",
    rating: f.cook?.rating ?? 0,
    createdAt: f.createdAt,
  })));
}

/** POST /api/v1/app/favorites — add a cook to favorites */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { userId: string; cookId: string };
  const customer = await db.customer.findUnique({ where: { userId: body.userId } });
  if (!customer) return Response.json({ error: "Customer not found" }, { status: 404 });

  try {
    const fav = await db.favorite.create({
      data: { customerId: customer.id, cookId: body.cookId },
    });
    return success({ ok: true, id: fav.id });
  } catch {
    return Response.json({ error: "Already favorited or cook not found" }, { status: 409 });
  }
}

/** DELETE /api/v1/app/favorites?id=... — remove from favorites */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await db.favorite.delete({ where: { id } }).catch(() => {});
  return success({ ok: true });
}
