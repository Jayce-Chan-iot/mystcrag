/**
 * GET /auth/session — safe session projection endpoint.
 *
 * Frozen contract:
 * - Returns the real session projection (never issuer/subject/audience/tokens/claims).
 * - A successfully decrypted session use triggers the SDK's REAL passive rolling; all
 *   Set-Cookie produced by the rolling write are merged into the response. Rolling
 *   failure fails closed with a stable 500 (never a silent passthrough) and never
 *   clears the still-valid session. The projected idleExpiresAt matches the Max-Age
 *   really written by the rolling response.
 * - Missing/invalid sessions are never rolled.
 * - Expired, malformed, or authentication-tag-invalid cookies produce
 *   `200 {"authenticated": false}` AND the invalid cookie is cleared. The SDK returns
 *   null for both "no cookie" and "undecryptable cookie", so this module inspects the
 *   request to detect an invalid cookie that must be cleared.
 * - SDK/runtime dependency failures produce 500 INTERNAL_ERROR and never fake anonymity;
 *   a successfully decrypted session is preserved (no cookie clearing).
 * - Response always uses Cache-Control: no-store and Pragma: no-cache.
 */

import { NextRequest, NextResponse } from "next/server";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import type { AuthConfig } from "../model/auth-config";
import { buildClearCookieHeaders, hasSessionCookie } from "./session-cookies";
import { getSessionCookieName, parseSessionCookieMaxAge, projectSessionState } from "./auth0-server";

export type SessionDeps = {
  getConfig(): AuthConfig;
  getSession(request: NextRequest): Promise<SessionData | null | undefined>;
  /**
   * Triggers the SDK's real passive session rolling and returns its Set-Cookie headers.
   * Must throw on SDK failure (the caller fails closed with 500).
   */
  touchSession(request: NextRequest): Promise<string[]>;
  generateRequestId(): string;
};

export async function handleSessionRequest(
  request: NextRequest,
  deps: SessionDeps
): Promise<NextResponse> {
  const requestId = deps.generateRequestId();
  const config = deps.getConfig();

  let session: SessionData | null | undefined;
  try {
    session = await deps.getSession(request);
  } catch {
    // SDK/runtime dependency failure. MUST return 500 — never fake anonymity, and never
    // clear a cookie that might still decrypt after a transient outage.
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Session service unavailable.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
    );
  }

  if (session) {
    // Valid session use → real SDK passive rolling. Fail closed on rolling failure:
    // never return a 200 projection while the session persistence layer is broken, and
    // never clear a session that decrypted successfully.
    let rollingCookies: string[];
    try {
      rollingCookies = await deps.touchSession(request);
    } catch {
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Session service unavailable.", requestId } },
        { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
      );
    }

    // idleExpiresAt must equal the cookie expiry really written by this rolling response.
    const rollingMaxAge = parseSessionCookieMaxAge(rollingCookies, getSessionCookieName(config));
    const response = NextResponse.json(projectSessionState(session, rollingMaxAge), {
      headers: { "Cache-Control": "no-store", "Pragma": "no-cache" }
    });
    for (const cookie of rollingCookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  }

  // No session. If the request still carries a session cookie it is expired/malformed/
  // authentication-tag-invalid — clear it so the browser does not keep resending it.
  const response = NextResponse.json(
    { authenticated: false },
    { headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
  );
  if (hasSessionCookie(request, config)) {
    for (const cookie of buildClearCookieHeaders(request, config, false)) {
      response.headers.append("Set-Cookie", cookie);
    }
  }
  return response;
}
