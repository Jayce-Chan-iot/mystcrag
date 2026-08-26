/**
 * POST /auth/logout — active logout with CSRF protection.
 *
 * Frozen contract:
 * - Validates the exact Origin BEFORE any other step; missing/mismatched Origin fails
 *   closed with 403 FORBIDDEN and never touches cookies.
 * - Immediately clears the local session and transaction cookies. Cookie names are
 *   matched against Auth0 Next.js SDK 4.27.0 real behavior (session main cookie,
 *   `{name}__{index}` chunks, `__txn_{state}` transaction cookies) instead of guessed
 *   lists, and deletion attributes mirror creation attributes.
 * - Returns a real 303 See Other to the server-constructed Auth0/OIDC logout URL built
 *   only from the validated issuer, client id and allowlisted post-logout URL. No
 *   token or session material is ever placed in the URL.
 * - Never returns a 200 inline-script HTML page. The client keeps a top-level POST form
 *   navigation, and the browser follows the 303 to Auth0.
 * - Idempotent: repeated POSTs always produce the same 303 sequence; a request with no
 *   cookies left simply clears nothing extra.
 * - Local logout is complete before the upstream navigation; an Auth0 outage cannot
 *   resurrect the cleared local cookies.
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import { buildClearCookieHeaders } from "./session-cookies";

export type LogoutDeps = {
  getConfig(): AuthConfig;
  generateRequestId(): string;
};

/**
 * Builds the OIDC RP-Initiated Logout URL from the validated issuer.
 * The issuer is validated as canonical `https://dns-host/` with trailing slash.
 */
export function buildUpstreamLogoutUrl(
  issuer: string,
  clientId: string,
  postLogoutRedirectUri: string
): string {
  const upstream = new URL("oidc/logout", issuer);
  upstream.searchParams.set("client_id", clientId);
  upstream.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
  return upstream.toString();
}

/**
 * GET /auth/logout must never mutate session state.
 */
export function handleLogoutGet(deps: LogoutDeps): NextResponse {
  deps.generateRequestId();
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for logout." } },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "POST" } }
  );
}

export function handleLogoutPost(request: NextRequest, deps: LogoutDeps): NextResponse {
  const requestId = deps.generateRequestId();

  let config: AuthConfig;
  try {
    config = deps.getConfig();
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  // 1. Exact Origin equality — fail closed before anything else.
  const origin = request.headers.get("origin");
  if (!origin || origin !== config.appOrigin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Origin validation failed.", requestId } },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  // 2. Immediately clear session + transaction cookies that actually exist on the
  //    request. Repeated POSTs remain idempotent: already-cleared cookies are absent
  //    from the request and simply produce no additional Set-Cookie entries.
  const response = new NextResponse(null, { status: 303 });
  for (const cookie of buildClearCookieHeaders(request, config, true)) {
    response.headers.append("Set-Cookie", cookie);
  }

  // 3. Server-constructed upstream logout URL and 303 See Other.
  const upstreamLogoutUrl = buildUpstreamLogoutUrl(
    config.authIssuer,
    config.authClientId,
    config.authLogoutUrl
  );
  response.headers.set("Location", upstreamLogoutUrl);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
}
