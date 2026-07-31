import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth middleware — redirects unauthenticated users to /login.
 *
 * Exempt paths:
 *  - /login (the login page itself)
 *  - /api/v1/auth/* (login, demo-login, register, waitlist, seed)
 *  - /api/v1/health/* (health checks)
 *  - /_next/* (Next.js assets)
 *  - /favicon.ico
 *  - /globals.css
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow these paths
  const exemptPaths = ["/login", "/api/v1/auth", "/api/v1/health", "/api/v1/app", "/api/v1/seed", "/_next", "/favicon.ico", "/globals.css"];
  if (exemptPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for session cookie (works on both localhost and production)
  const isProduction = process.env.NODE_ENV === "production";
  const cookieName = isProduction ? "__Host-eks_access" : "eks_access";
  const sessionToken = req.cookies.get(cookieName)?.value;

  if (!sessionToken) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
