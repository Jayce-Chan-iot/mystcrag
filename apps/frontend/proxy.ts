/**
 * Next.js 16 proxy.ts for Auth0 SDK network boundary.
 *
 * Contract: this file is the sole network boundary for Auth0 SDK in Next.js 16.
 * - Uses a broad matcher to enable rolling session cookie reissue on page navigations.
 * - Excludes static assets, image optimization, and metadata files.
 * - `/auth/**` is fail-closed against an allowlist: only /auth/login, /auth/callback,
 *   /auth/logout and /auth/session exist; every other path (SDK connect, MFA,
 *   passwordless, passkey, profile, access-token, ...) returns 404.
 * - The SDK's hard-coded `/me/` and `/my-org/` browser endpoints are blocked here.
 * - API routes are never delegated to SDK middleware; the custom BFF route handler is
 *   the sole authority for /api/**.
 * - Page navigations call auth0.middleware(request) for rolling session reissue.
 * - Error logs never output raw Auth0 errors, code/state/query, tokens, or claims.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client } from "./src/features/auth/server/auth0-server";
import { decideProxyRoute } from "./src/features/auth/server/proxy-routes";

// Broad matcher for rolling session support.
// Excludes static assets, image optimization, and metadata files.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ]
};

export default async function proxy(request: NextRequest) {
  const decision = decideProxyRoute(request.nextUrl.pathname);

  if (decision.kind === "not-found") {
    // Fail closed — hide the existence of every non-allowlisted auth/SDK path.
    return new NextResponse(null, { status: 404 });
  }

  if (decision.kind === "passthrough") {
    // /auth allowlist endpoints and /api/** are handled by their own route handlers.
    return NextResponse.next();
  }

  // Page navigations: delegate to SDK middleware for rolling session cookie reissue.
  // The SDK reads the existing session, extends it, and sets the new cookie in the
  // response. Rolling never extends the absolute expiry (enforced by the SDK store).
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
