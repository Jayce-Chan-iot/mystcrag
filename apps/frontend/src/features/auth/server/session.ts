/**
 * GET /auth/session — safe session projection endpoint.
 *
 * Frozen contract:
 * - Returns the real session projection (never issuer/subject/audience/tokens/claims).
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
import { projectSessionState } from "./auth0-server";

export type SessionDeps = {
  getConfig(): AuthConfig;
  getSession(request: NextRequest): Promise<SessionData | null | undefined>;
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
    return NextResponse.json(projectSessionState(session), {
      headers: { "Cache-Control": "no-store", "Pragma": "no-cache" }
    });
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
