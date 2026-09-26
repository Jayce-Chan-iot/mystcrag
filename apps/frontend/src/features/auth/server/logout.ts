/**
 * GET /auth/logout — active logout with CSRF protection.
 *
 * Frozen contract:
 * - Validates the exact Origin BEFORE any other step; missing/mismatched Origin fails
 *   closed with 403 FORBIDDEN and never touches cookies.
 * - Immediately clears the local session and transaction cookies (deletion attributes
 *   mirror creation attributes).
 * - Returns a real 303 See Other to the discovery `end_session_endpoint` (or the
 *   configured same-origin logout URL when the pool does not advertise one). No token
 *   or session material is ever placed in the URL.
 * - GET never mutates session state (405).
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import type { AuthEventLogger } from "./auth-events";
import { buildLogoutRedirect, clearAllAuthCookies } from "./oidc-server";

export type LogoutDeps = {
  getConfig(): AuthConfig;
  generateRequestId(): string;
  logAuthEvent: AuthEventLogger;
};

/**
 * GET /auth/logout must never mutate session state.
 */
export function handleLogoutGet(deps: LogoutDeps): NextResponse {
  const requestId = deps.generateRequestId();
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST for logout.", requestId } },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "POST" } }
  );
}

export async function handleLogoutPost(
  request: NextRequest,
  deps: LogoutDeps
): Promise<NextResponse> {
  const requestId = deps.generateRequestId();

  let config: AuthConfig;
  try {
    config = deps.getConfig();
  } catch {
    deps.logAuthEvent("auth.dependency_failed", {
      category: "dependency",
      requestId,
      outcome: "failure"
    });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  // 1. Exact Origin equality — fail closed before anything else.
  const origin = request.headers.get("origin");
  if (!origin || origin !== config.appOrigin) {
    deps.logAuthEvent("auth.origin_rejected", {
      category: "origin_rejected",
      requestId,
      outcome: "failure"
    });
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Origin validation failed.", requestId } },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  // 2. Immediately clear session + transaction cookies.
  const response = new NextResponse(null, { status: 303 });
  for (const cookie of clearAllAuthCookies(request, config)) {
    response.headers.append("Set-Cookie", cookie);
  }

  // 3. Server-constructed upstream logout URL (discovery end_session_endpoint).
  let location: string;
  try {
    location = await buildLogoutRedirect(config);
  } catch {
    // Local logout already completed. Prefer the configured same-origin URL so an
    // Authing outage cannot leave the user stranded on a failed 303 target.
    location = config.authLogoutUrl;
  }
  response.headers.set("Location", location);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  deps.logAuthEvent("auth.logout", { category: "authentication", requestId, outcome: "success" });
  return response;
}
