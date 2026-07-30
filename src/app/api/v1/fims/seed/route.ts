import { NextRequest } from "next/server";
import { seedFims } from "@/lib/seed-fims";
import { success } from "@eks/api/response";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = await seedFims(force);
  return success({ ok: true, ...result });
}
export async function GET() { return success({ note: "POST to seed FIMS" }); }
