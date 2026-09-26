/**
 * GET /auth/callback — OIDC Authorization Code + PKCE callback (Authing).
 *
 * Classification:
 * - missing/invalid/replayed state, provider denial, invalid_grant, nonce mismatch → 401
 * - discovery/token/JWKS outage → 500
 * - success → 303 to validated returnTo with session cookies
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import type { AuthEventLogger } from "./auth-events";
import { completeOidcCallback } from "./oidc-server";

export type CallbackDeps = {
  getConfig(): AuthConfig;
  generateRequestId(): string;
  logAuthEvent: AuthEventLogger;
};

function errorResponse(kind: "unauthorized" | "internal", requestId: string): NextResponse {
  if (kind === "unauthorized") {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication failed.", requestId } },
      { status: 401, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
    );
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Authentication service error.", requestId } },
    { status: 500, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}

export async function handleCallback(request: NextRequest, deps: CallbackDeps): Promise<NextResponse> {
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
    return errorResponse("internal", requestId);
  }

  const outcome = await completeOidcCallback(request, config);

  if (outcome.kind === "unauthorized") {
    const response = errorResponse("unauthorized", requestId);
    for (const cookie of outcome.setCookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    deps.logAuthEvent("auth.callback_failed", {
      category: "authentication",
      requestId,
      outcome: "failure"
    });
    return response;
  }

  if (outcome.kind === "internal") {
    deps.logAuthEvent("auth.dependency_failed", {
      category: "dependency",
      requestId,
      outcome: "failure"
    });
    const response = errorResponse("internal", requestId);
    for (const cookie of outcome.setCookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  }

  const location = new URL(outcome.returnTo, config.appOrigin).toString();
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store", Pragma: "no-cache" }
  });
  for (const cookie of outcome.setCookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  deps.logAuthEvent("auth.sign_in", { category: "authentication", requestId, outcome: "success" });
  return response;
}
