import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const POST = apiHandler(async (req: NextRequest) => {
  const body = (await req.json()) as {
    email: string;
    name: string;
    phone?: string;
    country?: string;
    requestedRoles?: string[];
    requestedOrganization?: string;
    referralCode?: string;
  };

  if (!body.email || !body.name) {
    return Response.json({ error: "email and name are required" }, { status: 400 });
  }

  // Check for duplicate
  const existing = await db.waitlistEntry.findUnique({ where: { email: body.email } });
  if (existing) {
    return Response.json(
      { error: "You're already on the waitlist!", status: existing.status },
      { status: 409 },
    );
  }

  const code = `EKS-WL-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const entry = await db.waitlistEntry.create({
    data: {
      code,
      email: body.email,
      name: body.name,
      phone: body.phone ?? null,
      country: body.country ?? "Ghana",
      requestedRoles: JSON.stringify(body.requestedRoles ?? ["CUSTOMER"]),
      requestedOrganization: body.requestedOrganization ?? null,
      referralCode: body.referralCode ?? null,
      status: "PENDING",
      source: "WEB",
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
  });

  return success({ ok: true, code: entry.code, status: entry.status });
});

export const GET = apiHandler(async (req: NextRequest) => {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50");
  const entries = await db.waitlistEntry.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return success(entries);
});
