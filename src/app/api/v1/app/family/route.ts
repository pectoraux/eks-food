import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";

/** GET /api/v1/app/family?userId=... — list family members */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  let household = await db.household.findFirst({ where: { name: { contains: userId } } });
  if (!household) return success([]);

  const members = await db.householdMember.findMany({
    where: { householdId: household.id },
  });

  return success(members.map((m) => ({
    id: m.id,
    role: m.role,
    dietaryRestrictions: JSON.parse(m.dietaryRestrictions || "[]"),
    allergies: JSON.parse(m.allergies || "[]"),
    favoriteFoods: JSON.parse(m.favoriteFoods || "[]"),
    dislikedFoods: JSON.parse(m.dislikedFoods || "[]"),
  })));
}
