/**
 * Next.js 16 proxy.ts for the Authing OIDC BFF network boundary.
 *
 * - Broad matcher enables rolling session cookie reissue on page navigations.
 * - `/auth/**` is fail-closed against an allowlist.
 * - API routes are never delegated here; the custom BFF route handler owns /api/**.
 * - Page navigations roll the encrypted session cookie. Failures return a stable 500.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthConfig,
  generateRequestId,
  touchSession
} from "./src/features/auth/server/oidc-server";
import { decideProxyRoute } from "./src/features/auth/server/proxy-routes";
import { handleProxyPageRolling } from "./src/features/auth/server/proxy-page";
import { logAuthEvent } from "./src/features/auth/server/auth-events";
import { detectAuthMode } from "./src/features/auth/server/runtime-auth";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ]
};

export default async function proxy(request: NextRequest) {
  const decision = decideProxyRoute(request.nextUrl.pathname);

  if (decision.kind === "not-found") {
    return new NextResponse(null, { status: 404 });
  }

  if (decision.kind === "passthrough") {
    return NextResponse.next();
  }

  try {
    if (detectAuthMode(getAuthConfig()) === "desktop") {
      return NextResponse.next();
    }
  } catch {
    // Config resolution failure: fall through to the fail-closed rolling path.
  }

  return handleProxyPageRolling(request, {
    middleware: async (pageRequest) => {
      const cookies = await touchSession(pageRequest);
      const response = NextResponse.next();
      for (const cookie of cookies) {
        response.headers.append("Set-Cookie", cookie);
      }
      return response;
    },
    generateRequestId,
    logAuthEvent
  });
}
