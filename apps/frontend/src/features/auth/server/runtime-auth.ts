/**
 * Server-only runtime selector between the Auth0 browser session and the explicit
 * desktop development identity.
 *
 * Contract:
 * - Auth0 remains the sole production browser session. Desktop mode is a short-lived,
 *   development-only convenience identity that is never a production fallback and is
 *   reachable only when the full fail-closed matrix in auth-config.ts resolves.
 * - The desktop Access Token lives exclusively in server memory (AuthConfig) and is
 *   forwarded server-to-server as `Authorization: Bearer`; it never enters a browser
 *   cookie, React state, HTML/RSC payload, URL, log or error message.
 * - Desktop shims must never instantiate or invoke the Auth0 SDK; this module has no
 *   Auth0 dependency.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import { isReturnToRejected, validateReturnTo } from "../model/return-to";
import type { AuthEventLogger } from "./auth-events";

export type AuthRuntimeMode = "auth0" | "desktop";

export function detectAuthMode(config: AuthConfig): AuthRuntimeMode {
  return config.desktopAutoAuth ? "desktop" : "auth0";
}

export const DESKTOP_DISPLAY_NAME = "本地演示用户";

export type DesktopSessionProjection = {
  readonly authenticated: true;
  readonly user: { readonly displayName: string };
};

export function projectDesktopSession(): DesktopSessionProjection {
  return { authenticated: true, user: { displayName: DESKTOP_DISPLAY_NAME } };
}

export function buildDesktopSessionResponse(): NextResponse {
  return NextResponse.json(projectDesktopSession(), {
    headers: { "Cache-Control": "no-store", "Pragma": "no-cache" }
  });
}

export function getDesktopBearerToken(config: AuthConfig): string {
  return config.desktopAccessToken;
}

export type DesktopLoginDeps = {
  generateRequestId(): string;
  logAuthEvent: AuthEventLogger;
};

/**
 * Desktop-mode /auth/login: never touches Auth0 or creates a cookie; it validates the
 * caller's returnTo through the same validateReturnTo boundary and 303s back to the
 * same-origin application.
 */
export function handleDesktopLoginRequest(
  request: NextRequest,
  config: AuthConfig,
  deps: DesktopLoginDeps
): NextResponse {
  const requestId = deps.generateRequestId();
  const rawReturnTo = request.nextUrl.searchParams.get("returnTo");
  const returnTo = validateReturnTo(rawReturnTo);
  if (isReturnToRejected(rawReturnTo)) {
    deps.logAuthEvent("auth.open_redirect_rejected", {
      category: "open_redirect",
      requestId,
      outcome: "failure"
    });
  }
  const target = new URL(returnTo, config.appOrigin).toString();
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
      "Pragma": "no-cache"
    }
  });
}

export type AccessTokenResolver = (request: NextRequest, sink: NextResponse) => Promise<{ token: string }>;
export type TouchSessionFn = (request: NextRequest) => Promise<string[]>;

/**
 * Selects the BFF access-token source by runtime mode. In desktop mode the server Token
 * is returned without ever invoking the injected Auth0 SDK resolver.
 */
export function makeAccessTokenResolver(
  getConfig: () => AuthConfig,
  auth0Resolver: AccessTokenResolver
): AccessTokenResolver {
  return async (request, sink) => {
    const config = getConfig();
    return detectAuthMode(config) === "desktop"
      ? { token: config.desktopAccessToken }
      : auth0Resolver(request, sink);
  };
}

/**
 * Selects the BFF passive-session-rolling source. Desktop mode performs no rolling and
 * never invokes the injected Auth0 SDK rolling primitive.
 */
export function makeTouchSession(
  getConfig: () => AuthConfig,
  auth0TouchSession: TouchSessionFn
): TouchSessionFn {
  return async (request) => {
    const config = getConfig();
    return detectAuthMode(config) === "desktop" ? [] : auth0TouchSession(request);
  };
}