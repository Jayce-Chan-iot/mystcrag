/**
 * Routing policy for the Next.js 16 network boundary (proxy.ts).
 *
 * Frozen contract: only the four public auth endpoints exist under /auth/**. Every
 * other /auth/** path — including SDK connect/MFA/passwordless/passkey/profile/
 * access-token routes — fails closed with 404. The SDK handler also hard-codes
 * `/me/` and `/my-org/` browser endpoints, which are blocked here because they cannot
 * be disabled via SDK route options.
 *
 * API routes are never delegated to SDK middleware: the custom BFF route handler is
 * the sole authority for /api/**. Page navigations fall through to SDK middleware for
 * rolling-session cookie reissue.
 */

export type ProxyDecision =
  | { kind: "not-found" }
  | { kind: "passthrough" }
  | { kind: "sdk-rolling" };

// The frozen contract allowlist — the only public endpoints under /auth/**.
const AUTH_ALLOWLIST = new Set([
  "/auth/login",
  "/auth/callback",
  "/auth/logout",
  "/auth/session"
]);

export function decideProxyRoute(pathname: string): ProxyDecision {
  // /auth/** allowlist — unknown paths fail closed with 404 (never SDK middleware).
  if (pathname === "/auth" || pathname.startsWith("/auth/")) {
    return AUTH_ALLOWLIST.has(pathname)
      ? { kind: "passthrough" }
      : { kind: "not-found" };
  }

  // Hard-coded SDK browser endpoints that route options cannot disable.
  if (
    pathname === "/me" ||
    pathname.startsWith("/me/") ||
    pathname === "/my-org" ||
    pathname.startsWith("/my-org/")
  ) {
    return { kind: "not-found" };
  }

  // API routes are handled exclusively by the custom BFF route handler.
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return { kind: "passthrough" };
  }

  // Page navigations: SDK middleware reissues the rolling session cookie.
  return { kind: "sdk-rolling" };
}
