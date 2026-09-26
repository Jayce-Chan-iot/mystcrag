/**
 * GET /auth/session — safe session projection endpoint (Authing OIDC BFF).
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import { buildClearCookieHeaders, hasSessionCookie } from "./session-cookies";
import {
  getSessionCookieName,
  parseSessionCookieMaxAge,
  projectSessionState
} from "./oidc-server";
import type { AuthEventLogger } from "./auth-events";
import type { OidcSessionPayload } from "./oidc-session-store";

export type SessionDeps = {
  getConfig(): AuthConfig;
  getSession(request: NextRequest): Promise<OidcSessionPayload | null | undefined>;
  touchSession(request: NextRequest): Promise<string[]>;
  generateRequestId(): string;
  logAuthEvent: AuthEventLogger;
};

export async function handleSessionRequest(
  request: NextRequest,
  deps: SessionDeps
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
      { error: { code: "INTERNAL_ERROR", message: "Session service unavailable.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
    );
  }

  let session: OidcSessionPayload | null | undefined;
  try {
    session = await deps.getSession(request);
  } catch {
    deps.logAuthEvent("auth.dependency_failed", {
      category: "dependency",
      requestId,
      outcome: "failure"
    });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Session service unavailable.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
    );
  }

  if (session) {
    let rollingCookies: string[];
    try {
      rollingCookies = await deps.touchSession(request);
    } catch {
      deps.logAuthEvent("auth.dependency_failed", {
        category: "dependency",
        requestId,
        outcome: "failure"
      });
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Session service unavailable.", requestId } },
        { status: 500, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
      );
    }

    const rollingMaxAge = parseSessionCookieMaxAge(rollingCookies, getSessionCookieName(config));
    const response = NextResponse.json(projectSessionState(session, rollingMaxAge), {
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" }
    });
    for (const cookie of rollingCookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    if (rollingCookies.length > 0) {
      deps.logAuthEvent("auth.session_rotation", {
        category: "session_rotation",
        requestId,
        outcome: "success"
      });
    }
    return response;
  }

  const response = NextResponse.json(
    { authenticated: false },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
  if (hasSessionCookie(request, config)) {
    for (const cookie of buildClearCookieHeaders(request, config, false)) {
      response.headers.append("Set-Cookie", cookie);
    }
    deps.logAuthEvent("auth.session_invalid", {
      category: "session_expired_or_malformed",
      requestId,
      outcome: "failure"
    });
  }
  return response;
}
