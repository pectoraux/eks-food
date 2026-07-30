import { NextRequest } from "next/server";
import { seedIdentity } from "@/lib/seed-identity";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = await seedIdentity(force);
  return success({ ok: true, ...result });
}

export async function GET() {
  return success({ note: "POST to seed the IAM platform" });
}
