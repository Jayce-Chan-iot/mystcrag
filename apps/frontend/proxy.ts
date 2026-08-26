/**
 * Next.js 16 proxy.ts for Auth0 SDK network boundary.
 *
 * Contract: this file is the sole network boundary for Auth0 SDK in Next.js 16.
 * It handles rolling session cookie reissue for all matched routes.
 * Auth callback is delegated to the SDK middleware.
 * The matcher must be wide enough to support rolling session cookie reissue.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client } from "./src/lib/auth/auth0-server";

// Matcher for Auth0 SDK routes and rolling session
export const config = {
  matcher: [
    "/auth/:path*",
    "/api/:path*"
  ]
};

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Delegate /auth/callback to the Auth0 SDK middleware for OAuth code exchange.
  // Other /auth/** paths are handled by our custom route handlers.
  if (pathname === "/auth/callback") {
    try {
      const auth0Client = getAuth0Client();
      return await auth0Client.middleware(request);
    } catch (error) {
      console.error("Auth0 callback middleware error:", error);
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Authentication callback failed." } },
        { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
      );
    }
  }

  // For /api/** routes, check session and add indicator header
  if (pathname.startsWith("/api/")) {
    try {
      const auth0Client = getAuth0Client();
      const session = await auth0Client.getSession(request);
      if (session) {
        const response = NextResponse.next({
          request: {
            headers: new Headers(request.headers)
          }
        });
        response.headers.set("x-mystcrag-session", "authenticated");
        return response;
      }
    } catch {
      // Session check failure should not block the request.
      // BFF route handler will handle authentication.
    }
  }

  // Pass through all other requests
  return NextResponse.next();
}
