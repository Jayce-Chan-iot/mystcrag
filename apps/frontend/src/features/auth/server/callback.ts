/**
 * GET /auth/callback — OAuth 2.0 Authorization Code + PKCE callback.
 *
 * The SDK performs state/nonce/PKCE/code validation and session creation. This module wraps
 * the SDK result and classifies it against the frozen contract instead of trusting the URL:
 *
 * Classification matrix (SDK code | wrapped OAuth2 cause code), matching the real
 * Auth0 Next.js SDK 4.27 error shapes:
 * - missing_state / invalid_state (replayed or forged state) → 401.
 * - issuer_validation_error / session_domain_mismatch / domain_validation_error
 *   (issuer or session-domain rejection) → 401.
 * - session_expired (login transaction expired) → 401.
 * - Provider-declared user denial (access_denied, login_required, interaction_required,
 *   consent_required, account_selection_required) → 401.
 * - authorization_error / authorization_code_grant_error wrapping:
 *   - a denial cause or invalid_grant (invalid/replayed nonce, PKCE verifier or code) → 401;
 *   - `unknown_error`, which SDK 4.27 assigns when its own local
 *     authorization-response / code-response validation throws → 401;
 *   - invalid_client, unauthorized_client, invalid_scope, invalid_request,
 *     server_error, temporarily_unavailable → 500;
 *   - any other or missing cause → 500 (fail closed).
 * - discovery_error, authorization_code_grant_request_error (transport),
 *   invalid_configuration, domain_resolution_error, JWKS/dependency outage → 500.
 * - Unknown top-level SDK/runtime exceptions and unknown provider extension codes →
 *   500 (the decrypted session, if any, is never cleared on 500).
 *
 * Only internal whitelisted classifications (UNAUTHORIZED / INTERNAL_ERROR) are ever
 * emitted — raw provider codes and error details never leave the server.
 *
 * - Success → a real 303 See Other that preserves the session Cookie the SDK created.
 * - 401 authentication failures clear the actual transaction material (`__txn_*`),
 *   never the session itself.
 * - Every response keeps Cache-Control: no-store and Pragma: no-cache.
 *
 * The SDK appends its transaction-cleanup Set-Cookie to the response it returns, so this
 * module copies those Set-Cookie headers onto the final response on success AND failure.
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import { buildClearTransactionCookieHeaders } from "./session-cookies";
import { CALLBACK_ERROR_HEADER } from "./auth0-server";
import type { AuthEventLogger } from "./auth-events";

export type CallbackDeps = {
  middleware(request: NextRequest): Promise<Response>;
  getConfig(): AuthConfig;
  generateRequestId(): string;
  /** Privacy-safe auth event logging (whitelisted fields only, no provider detail). */
  logAuthEvent: AuthEventLogger;
};

// SDK top-level codes that mean the local transaction itself was rejected/forged or
// the issuer/session-domain claim cannot be trusted → authentication failure (401).
const AUTH_TOP_LEVEL_CODES = new Set([
  "missing_state",
  "invalid_state",
  "issuer_validation_error",
  "session_domain_mismatch",
  "domain_validation_error",
  "session_expired"
]);

// SDK top-level codes whose wrapped OAuth2 cause decides 401 vs 500.
const CAUSE_CLASSIFIED_CODES = new Set([
  "authorization_error",
  "authorization_code_grant_error"
]);

// Wrapped causes meaning the transaction itself was rejected: provider-declared user
// denial, or invalid/replayed grant material (state/nonce/PKCE/code). `unknown_error`
// is what SDK 4.27 assigns when its own local authorization-response or code-response
// validation throws inside these known wrappers → still an authentication failure.
const AUTHENTICATION_REJECTION_CAUSE_CODES = new Set([
  "access_denied",
  "login_required",
  "interaction_required",
  "consent_required",
  "account_selection_required",
  "invalid_grant",
  "unknown_error"
]);

// Provider-declared denial codes arriving as a bare top-level OAuth2Error → 401.
const PROVIDER_DENIAL_TOP_LEVEL_CODES = new Set([
  "access_denied",
  "login_required",
  "interaction_required",
  "consent_required",
  "account_selection_required"
]);

/**
 * Classifies a callback failure from the SDK error code plus the wrapped OAuth2 cause
 * code. Never trusts URL parameters; never leaks provider detail. Wrapped causes that
 * are client-configuration/authorization-server failures (invalid_client,
 * unauthorized_client, invalid_scope, invalid_request, server_error,
 * temporarily_unavailable), missing or unknown, fail closed as "internal" so a valid
 * decrypted session is never cleared.
 */
export function classifyCallbackError(
  code: string,
  causeCode: string | undefined
): "unauthorized" | "internal" {
  if (AUTH_TOP_LEVEL_CODES.has(code)) {
    return "unauthorized";
  }
  if (CAUSE_CLASSIFIED_CODES.has(code)) {
    if (causeCode && AUTHENTICATION_REJECTION_CAUSE_CODES.has(causeCode)) return "unauthorized";
    // Dependency/configuration causes, missing causes and unknown provider extension
    // codes → fail closed as infrastructure error and preserve any decrypted session.
    return "internal";
  }
  if (PROVIDER_DENIAL_TOP_LEVEL_CODES.has(code)) {
    return "unauthorized";
  }
  // discovery_error, authorization_code_grant_request_error, invalid_configuration,
  // domain_resolution_error, JWKS/transport failures and anything unknown → outage.
  return "internal";
}

function parseSentinel(header: string): { code: string; causeCode: string | undefined } {
  const separator = header.indexOf("|");
  if (separator === -1) {
    return { code: header, causeCode: undefined };
  }
  const causeCode = header.slice(separator + 1);
  return { code: header.slice(0, separator), causeCode: causeCode || undefined };
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
    // The middleware itself threw (no SDK response exists, hence no SDK txn cleanup
    // Set-Cookie). Classify by code/cause and clear the actual transaction material.
    const code = typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : "";
    const cause = (error as { cause?: { code?: unknown } })?.cause;
    const causeCode = typeof cause?.code === "string" ? cause.code : undefined;
    const kind = classifyCallbackError(code, causeCode);
    const response = errorResponse(kind, requestId);
    if (kind === "unauthorized") {
      const config = deps.getConfig();
      for (const cookie of buildClearTransactionCookieHeaders(request, config)) {
        response.headers.append("Set-Cookie", cookie);
      }
    }
    deps.logAuthEvent(
      kind === "unauthorized" ? "auth.callback_failed" : "auth.dependency_failed",
      { category: kind === "unauthorized" ? "authentication" : "dependency", requestId, outcome: "failure" }
    );
    return response;
  }

  const sentinel = sdkResponse.headers.get(CALLBACK_ERROR_HEADER);
  if (sentinel) {
    // Authentication or infrastructure failure. Preserve the SDK transaction-cleanup
    // Set-Cookie, but never leak the private error header or raw error detail.
    const { code, causeCode } = parseSentinel(sentinel);
    const kind = classifyCallbackError(code, causeCode);
    const response = errorResponse(kind, requestId);
    copySetCookies(response, sdkResponse);
    if (kind === "unauthorized") {
      // Belt-and-braces: clear any transaction material the SDK cleanup missed. Session
      // cookies are never touched here.
      const config = deps.getConfig();
      for (const cookie of buildClearTransactionCookieHeaders(request, config)) {
        response.headers.append("Set-Cookie", cookie);
      }
    }
    deps.logAuthEvent(
      kind === "unauthorized" ? "auth.callback_failed" : "auth.dependency_failed",
      { category: kind === "unauthorized" ? "authentication" : "dependency", requestId, outcome: "failure" }
    );
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
  deps.logAuthEvent("auth.sign_in", { category: "authentication", requestId, outcome: "success" });
  return response;
}
