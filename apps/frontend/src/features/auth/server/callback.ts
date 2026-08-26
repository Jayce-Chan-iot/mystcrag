/**
 * GET /auth/callback — OAuth 2.0 Authorization Code + PKCE callback.
 *
 * The SDK performs state/nonce/PKCE/code validation and session creation. This module wraps
 * the SDK result and classifies it against the frozen contract instead of trusting the URL:
 *
 * - state/nonce/PKCE/code/replay/provider-denial → 401 UNAUTHORIZED.
 * - provider/JWKS/SDK dependency outage → 500 INTERNAL_ERROR.
 * - Success → a real 303 See Other that preserves the session Cookie the SDK created.
 * - Every response keeps Cache-Control: no-store and Pragma: no-cache.
 *
 * The SDK appends its transaction-cleanup Set-Cookie to the response it returns, so this
 * module copies those Set-Cookie headers onto the final response on success AND failure.
 */

import { NextRequest, NextResponse } from "next/server";
import { CALLBACK_ERROR_HEADER } from "./auth0-server";

export type CallbackDeps = {
  middleware(request: NextRequest): Promise<Response>;
  generateRequestId(): string;
};

// SDK callback error codes that represent an authentication failure (the transaction was
// rejected or replayed), not an infrastructure outage.
const CALLBACK_AUTH_CODES = new Set([
  "missing_state",
  "invalid_state",
  "authorization_error",
  "authorization_code_grant_error",
  "session_expired"
]);

// Provider-declared denial codes that may surface directly as an OAuth2Error.
const OAUTH_DENIAL_CODES = new Set([
  "access_denied",
  "login_required",
  "interaction_required",
  "consent_required",
  "account_selection_required"
]);

export function classifyCallbackErrorCode(code: string): "unauthorized" | "internal" {
  if (CALLBACK_AUTH_CODES.has(code) || OAUTH_DENIAL_CODES.has(code)) {
    return "unauthorized";
  }
  // discovery_error, authorization_code_grant_request_error, issuer_validation_error,
  // invalid_configuration, and anything unknown are treated as infrastructure outage.
  return "internal";
}

function extractCode(error: unknown): string {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : "";
}

function errorResponse(kind: "unauthorized" | "internal", requestId: string): NextResponse {
  if (kind === "unauthorized") {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication failed.", requestId } },
      { status: 401, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
    );
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Authentication service error.", requestId } },
    { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
  );
}

function copySetCookies(target: NextResponse, source: Response): void {
  const cookies = source.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    target.headers.append("Set-Cookie", cookie);
  }
}

export async function handleCallback(request: NextRequest, deps: CallbackDeps): Promise<NextResponse> {
  const requestId = deps.generateRequestId();

  let sdkResponse: Response;
  try {
    sdkResponse = await deps.middleware(request);
  } catch (error) {
    // The middleware itself threw (configuration / unexpected failure). Classify by code.
    return errorResponse(classifyCallbackErrorCode(extractCode(error)), requestId);
  }

  const errorCode = sdkResponse.headers.get(CALLBACK_ERROR_HEADER);
  if (errorCode) {
    // Authentication or infrastructure failure. Preserve the SDK transaction-cleanup
    // Set-Cookie, but never leak the private error header or raw error detail.
    const response = errorResponse(classifyCallbackErrorCode(errorCode), requestId);
    copySetCookies(response, sdkResponse);
    return response;
  }

  // Success: emit a real 303 See Other, preserving the session + transaction Set-Cookie
  // the SDK created/rotated.
  const response = new NextResponse(null, { status: 303 });
  const location = sdkResponse.headers.get("location");
  if (location) {
    response.headers.set("Location", location);
  }
  copySetCookies(response, sdkResponse);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
}
