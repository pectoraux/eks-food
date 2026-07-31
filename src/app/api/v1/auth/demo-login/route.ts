import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { createHash, randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { role?: string };
    const role = body.role;
    if (!role) {
      return Response.json({ error: "role is required" }, { status: 400 });
    }

    // Find the demo account
    const demoAccount = await db.demoAccount.findUnique({
      where: { role },
    });

    if (!demoAccount || !demoAccount.active) {
      return Response.json({ error: `No demo account found for role: ${role}` }, { status: 404 });
    }

    // Fetch the user separately (no relation defined on DemoAccount)
    const user = await db.user.findUnique({
      where: { id: demoAccount.userId },
    });

    if (!user) {
      return Response.json({ error: `Demo user not found` }, { status: 404 });
    }

    // Create a session
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

    await db.session.create({
      data: {
        userId: demoAccount.userId,
        organizationId: demoAccount.organizationId,
        tokenHash,
        userAgent: req.headers.get("user-agent") ?? null,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        riskScore: "LOW",
        trustedDevice: true,
        expiresAt,
      },
    });

    // Update last login
    await db.user.update({
      where: { id: demoAccount.userId },
      data: { lastLoginAt: new Date() },
    });

    const isProduction = process.env.NODE_ENV === "production";
    const cookieName = isProduction ? "__Host-eks_access" : "eks_access";
    const secureFlag = isProduction ? "; Secure" : "";

    const res = success({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        organizationId: user.organizationId,
      },
      role: demoAccount.role,
      displayName: demoAccount.displayName,
      organizationId: demoAccount.organizationId,
    });

    res.headers.set(
      "set-cookie",
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secureFlag}`,
    );

    return res;
  } catch (error) {
    console.error("demo-login error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message, stack: error instanceof Error ? error.stack : undefined }, { status: 500 });
  }
}
