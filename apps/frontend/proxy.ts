/**
 * Next.js 16 proxy.ts for Auth0 SDK network boundary.
 *
 * Contract: this file is the sole network boundary for Auth0 SDK in Next.js 16.
 * - Uses a broad matcher to enable rolling session cookie reissue on all page navigations.
 * - Excludes static assets, image optimization, and metadata files.
 * - Calls auth0.middleware(request) for page navigations to enable session rolling.
 * - Explicitly blocks unauthorized SDK paths (profile, access-token, connect, etc.).
 * - GET /auth/logout is NOT delegated to SDK default GET logout.
 * - POST /auth/logout is handled by the frozen Contract wrapper (route handler).
 * - /auth/callback is handled by its own route handler (not delegated here).
 * - Error logs never output raw Auth0 errors, code/state/query, tokens, or claims.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client } from "./src/features/auth/server/auth0-server";

// Broad matcher for rolling session support.
// Excludes static assets, image optimization, and metadata files.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ]
};

// SDK paths that must be explicitly blocked (dummy paths configured in SDK)
const BLOCKED_SDK_PATHS = new Set([
  "/auth/__sdk_login",
  "/auth/__sdk_logout",
  "/auth/__sdk_profile",
  "/auth/__sdk_access_token",
  "/auth/__sdk_bcl"
]);

// Paths that should NOT go through SDK middleware
// (they are handled by their own route handlers)
const PASSTHROUGH_PATHS = new Set([
  "/auth/callback",
  "/auth/login",
  "/auth/logout",
  "/auth/session"
]);

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Block unauthorized SDK paths — return 404 to hide their existence
  if (BLOCKED_SDK_PATHS.has(pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  // Auth route handlers are managed by their own route files.
  // Do NOT delegate to SDK middleware for these paths.
  if (PASSTHROUGH_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // API routes pass through — BFF route handler manages auth
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // For all other requests (page navigations), delegate to SDK middleware
  // for rolling session cookie reissue.
  // The SDK reads the existing session, extends it, and sets new cookies
  // in the response. This is how rolling session actually works.
  try {
    const auth0Client = getAuth0Client();
    return await auth0Client.middleware(request);
  } catch {
    // Session rolling failure — pass through without blocking the request.
    // Do NOT log raw error details (may contain tokens or claims).
    console.error("Auth0 session rolling failed");
    return NextResponse.next();
  }
}
