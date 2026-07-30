import { NextRequest } from "next/server";
import { seedCustomer } from "@/lib/seed-customer";
import { success } from "@eks/api/response";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = await seedCustomer(force);
  return success({ ok: true, ...result });
}
export async function GET() { return success({ note: "POST to seed customer platform" }); }
