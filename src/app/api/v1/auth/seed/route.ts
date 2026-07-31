import { NextRequest } from "next/server";
import { seedAuth } from "@/lib/seed-auth";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = await seedAuth(force);
  return success(result);
}

export async function GET() {
  return success({ note: "POST to seed auth data" });
}
