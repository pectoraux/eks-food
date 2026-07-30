import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/payswap/payouts?cookId=
 * Returns worker payout history (Payswap Transfers). Eks-Food only stores the
 * Payswap Transfer IDs and statuses — never bank/mobile money credentials.
 */
export async function GET(req: NextRequest) {
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  if (!org) return NextResponse.json({ error: "not_seeded" }, { status: 422 });

  const cookId = req.nextUrl.searchParams.get("cookId");
  let payeeUserId: string | undefined;
  if (cookId) {
    const cook = await db.cook.findUnique({ where: { id: cookId } });
    payeeUserId = cook?.userId;
  }

  const transfers = await db.payswapTransfer.findMany({
    where: { organizationId: org.id, ...(payeeUserId ? { payeeUserId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const totalPaid = await db.payswapTransfer.aggregate({
    where: { organizationId: org.id, status: "PAID", ...(payeeUserId ? { payeeUserId } : {}) },
    _sum: { amount: true },
  });

  return NextResponse.json({
    payouts: transfers.map((t) => ({
      payswapId: t.payswapId,
      payeeUserId: t.payeeUserId,
      amount: t.amount,
      currency: t.currency,
      status: t.status,
      metadata: JSON.parse(t.metadata),
      createdAt: t.createdAt,
    })),
    totalPaid: totalPaid._sum.amount ?? 0,
  });
}
