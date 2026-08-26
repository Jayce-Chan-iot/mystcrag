/**
 * Same-origin Backend-for-Frontend (BFF) proxy.
 *
 * Frozen contract:
 * - The browser never sees Access/Refresh/ID tokens; the BFF attaches the short-lived
 *   Bearer token server-to-server.
 * - Origin validation happens BEFORE any session/token operation for mutations.
 * - The request body is read exactly once and the same value is forwarded.
 * - Content-Length is never forwarded or computed by hand; the server fetch generates it.
 * - The target path cannot escape `/api/**` via `..`, percent-encoding, or backslashes,
 *   and the final URL is re-asserted against the configured backend origin.
 * - getAccessToken failures are classified: missing/expired/revoked/renewal-rejection →
 *   401 (and the invalid session cookie is cleared); provider/JWKS/SDK outage → 500 (the
 *   decrypted session is preserved).
 * - Every accepted request triggers the SDK's REAL passive session rolling (middleware
 *   default-case touch) after the Origin check and before any token operation; rolling
 *   failure fails closed with a stable 500. Rolling can never extend the 7d absolute
 *   expiry (the SDK caps maxAge at createdAt + absoluteDuration).
 * - Any Set-Cookie produced by the SDK (rolling + session rotation) is propagated on
 *   success and on terminating responses, including backend-unavailable responses.
 * - A Backend 401 (after the BFF attached the Bearer token) invalidates the local
 *   session: stable UNAUTHORIZED envelope + clearing of the session main cookie, chunks
 *   and SDK legacy cookies. Backend 403 preserves the session.
 * - Backend Set-Cookie is never forwarded to the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import { buildClearCookieHeaders, hasSessionCookie } from "./session-cookies";
import type { AuthEventCategory, AuthEventLogger, AuthEventName } from "./auth-events";

// Minimal header allowlist copied from the browser request. Anything not listed here —
// including cookie, authorization, host, content-length and forwarding headers — is never
// forwarded.
const ALLOWED_HEADERS = new Set([
  "accept",
  "accept-language",
  "accept-encoding",
  "content-type",
  "user-agent",
  "referer",
  "origin",
  "x-request-id"
]);

export type BffDeps = {
  getConfig(): AuthConfig;
  getAccessToken(request: NextRequest, sink: NextResponse): Promise<{ token: string }>;
  /**
   * Triggers the SDK's real passive session rolling and returns the Set-Cookie headers
   * it produced. Must throw on SDK failure (the caller fails closed with 500).
   */
  touchSession(request: NextRequest): Promise<string[]>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  generateRequestId(): string;
  /** Privacy-safe auth event logging (whitelisted fields only). */
  logAuthEvent: AuthEventLogger;
};

type ErrorKind = "unauthorized" | "internal";

// AccessTokenError codes that mean the session itself is unusable and must be cleared.
const UNAUTHORIZED_TOKEN_CODES = new Set([
  "missing_session",
  "session_expired",
  "missing_refresh_token"
]);

// OAuth provider codes that mean the refresh grant itself was explicitly rejected or
// revoked (invalid_grant = expired/revoked grant material; access_denied = explicit
// grant-denied/revoked semantics). Anything else behind failed_to_refresh_token —
// invalid_client, unauthorized_client, invalid_request, invalid_scope, server_error,
// temporarily_unavailable, transport/discovery failures, missing or unknown cause — is
// a configuration/infrastructure failure: the decrypted session is preserved.
const REFRESH_REJECTION_CODES = new Set([
  "invalid_grant",
  "access_denied"
]);

/**
 * Classifies a getAccessToken failure.
 *
 * - Missing/expired session, missing refresh token, or an explicit provider grant
 *   rejection/revocation (invalid_grant, access_denied) → "unauthorized" (clear the
 *   session).
 * - failed_to_refresh_token with any other cause (client configuration errors,
 *   authorization-server outages, transport/discovery failures) and missing or unknown
 *   causes → "internal": configuration/infrastructure failures must never log the user
 *   out; the decrypted session is preserved for retry.
 * - discovery_error and anything unknown are treated as transient → preserve session.
 */
export function classifyTokenError(error: unknown): ErrorKind {
  const code = typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : undefined;

  if (!code) return "internal";
  if (UNAUTHORIZED_TOKEN_CODES.has(code)) return "unauthorized";

  if (code === "failed_to_refresh_token") {
    const causeCode = (error as { cause?: { code?: unknown } })?.cause;
    const cause = typeof causeCode?.code === "string" ? causeCode.code : undefined;
    if (cause && REFRESH_REJECTION_CODES.has(cause)) return "unauthorized";
    return "internal";
  }

  // discovery_error and anything unknown are treated as transient → preserve session.
  return "internal";
}

function extractTokenErrorCode(error: unknown): string | undefined {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : undefined;
}

/**
 * Maps a getAccessToken failure to its privacy-safe auth event. The semantics are
 * deliberately distinct:
 * - missing_session WITHOUT any known session cookie on the request → session missing.
 *   The Auth0 SDK emits missing_session for BOTH "no cookie at all" and "a stale,
 *   corrupted or undecryptable cookie is present", so the event is resolved together
 *   with `hasSessionCookie(request, config)`: a present main/chunk/legacy cookie means
 *   session expired/malformed, NOT missing.
 * - session_expired → session expired/malformed.
 * - missing_refresh_token → the session cannot be continued, but NO provider revocation
 *   was observed: conservative session expired/malformed semantics (never
 *   renewal_revoked).
 * - failed_to_refresh_token whose underlying cause is an explicit provider grant
 *   rejection or revocation (invalid_grant, access_denied) → renewal rejected/revoked.
 * - anything else (configuration/infrastructure) → dependency failure.
 *
 * HTTP classification, cookie cleanup and the privacy whitelist are unaffected by this
 * mapping.
 */
export function resolveTokenFailureEvent(
  error: unknown,
  options: { sessionCookiePresent?: boolean } = {}
): { event: AuthEventName; category: AuthEventCategory } {
  const code = extractTokenErrorCode(error);
  if (code === "missing_session") {
    if (options.sessionCookiePresent) {
      return { event: "auth.session_invalid", category: "session_expired_or_malformed" };
    }
    return { event: "auth.session_missing", category: "session_missing" };
  }
  if (code === "session_expired") {
    return { event: "auth.session_invalid", category: "session_expired_or_malformed" };
  }
  if (code === "missing_refresh_token") {
    // Accurate, conservative semantics: the session cannot continue. No provider
    // revoke was observed, so this is NOT renewal_revoked.
    return { event: "auth.session_invalid", category: "session_expired_or_malformed" };
  }
  if (code === "failed_to_refresh_token") {
    const cause = (error as { cause?: { code?: unknown } })?.cause;
    const causeCode = typeof cause?.code === "string" ? cause.code : undefined;
    if (causeCode && REFRESH_REJECTION_CODES.has(causeCode)) {
      return { event: "auth.renewal_rejected", category: "renewal_revoked" };
    }
  }
  return { event: "auth.dependency_failed", category: "dependency" };
}

/**
 * Validates a catch-all API path and resolves it to a Backend URL, or returns null when the
 * path could escape `/api/**`.
 *
 * Next.js supplies URL-decoded segments, so a single-encoded `..` arrives as a literal `..`
 * and a double-encoded traversal still carries `%`. Rejecting literal `.`/`..`, any `%`,
 * empty segments and `\` therefore covers literal, encoded and double-encoded traversal.
 * The final URL is then re-asserted against the configured origin and `/api/` prefix.
 */
export function resolveBackendUrl(rawSegments: readonly string[], backendOrigin: string): URL | null {
  if (rawSegments.length === 0) return null;

  for (const segment of rawSegments) {
    if (segment.length === 0) return null;
    if (segment === "." || segment === "..") return null;
    if (segment.includes("%")) return null;
    if (segment.includes("\\")) return null;
  }

  let url: URL;
  let expectedOrigin: string;
  try {
    url = new URL(`/api/${rawSegments.join("/")}`, backendOrigin);
    expectedOrigin = new URL(backendOrigin).origin;
  } catch {
    return null;
  }

  if (url.origin !== expectedOrigin) return null;
  if (!url.pathname.startsWith("/api/")) return null;
  return url;
}

function errorEnvelope(status: number, code: string, message: string, requestId: string): NextResponse {
  return NextResponse.json(
    { error: { code, message, requestId } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function appendSinkCookies(target: NextResponse, sink: NextResponse): void {
  const cookies = sink.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    target.headers.append("Set-Cookie", cookie);
  }
}

/**
 * Emits auth.session_rotation only when the response actually carries rolling/rotation
 * Set-Cookie produced by the SDK. Called only on paths that preserve the session
 * (never on the 401 session-clearing paths).
 */
function logRotationIfProduced(
  logAuthEvent: AuthEventLogger,
  requestId: string,
  rollingCookies: string[],
  sinkCookies: string[]
): void {
  if (rollingCookies.length > 0 || sinkCookies.length > 0) {
    logAuthEvent("auth.session_rotation", {
      category: "session_rotation",
      requestId,
      outcome: "success"
    });
  }
}

export async function handleBffRequest(
  request: NextRequest,
  path: readonly string[],
  deps: BffDeps
): Promise<NextResponse> {
  const requestId = deps.generateRequestId();

  let config: AuthConfig;
  try {
    config = deps.getConfig();
  } catch {
    // Configuration resolution failure: stable 500 before any side effect. No cookie is
    // cleared (it might still be valid).
    deps.logAuthEvent("auth.dependency_failed", {
      category: "dependency",
      requestId,
      outcome: "failure"
    });
    return errorEnvelope(500, "INTERNAL_ERROR", "Authentication service unavailable.", requestId);
  }

  const method = request.method.toUpperCase();

  // 1. Path boundary — before any side effect.
  const backendUrl = resolveBackendUrl(path, config.backendOrigin);
  if (!backendUrl) {
    return errorEnvelope(403, "FORBIDDEN", "Invalid request path.", requestId);
  }
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    backendUrl.searchParams.append(key, value);
  }

  // 2. Origin validation BEFORE any session/token operation (mutations only).
  const isMutation = method !== "GET" && method !== "HEAD";
  if (isMutation) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== config.appOrigin) {
      deps.logAuthEvent("auth.origin_rejected", {
        category: "origin_rejected",
        requestId,
        outcome: "failure"
      });
      return errorEnvelope(403, "FORBIDDEN", "Origin validation failed.", requestId);
    }
  }

  // 3. Read the request body exactly once for mutations.
  let body: string | undefined;
  if (isMutation) {
    body = await request.text();
  }

  // 4. Real SDK passive rolling BEFORE any token operation (Origin was already checked
  //    above for mutations). The SDK only writes when it decrypted a valid session, so
  //    missing/invalid sessions are never rolled. Rolling failure fails closed — never a
  //    silent passthrough.
  let rollingCookies: string[];
  try {
    rollingCookies = await deps.touchSession(request);
  } catch {
    deps.logAuthEvent("auth.dependency_failed", {
      category: "dependency",
      requestId,
      outcome: "failure"
    });
    return errorEnvelope(500, "INTERNAL_ERROR", "Session service unavailable.", requestId);
  }

  // 5. Obtain the access token server-side; capture any SDK session-rotation Set-Cookie.
  const sink = new NextResponse();
  let accessToken: string;
  try {
    const result = await deps.getAccessToken(request, sink);
    accessToken = result.token;
  } catch (error) {
    if (classifyTokenError(error) === "unauthorized") {
      // Distinct semantics per token failure class (never one bucket): session missing
      // (no session cookie on the request) vs session expired/malformed (cookie present
      // but stale/corrupted/undecryptable, session_expired, or missing_refresh_token)
      // vs renewal rejected/revoked (explicit provider invalid_grant/access_denied).
      const failureEvent = resolveTokenFailureEvent(error, {
        sessionCookiePresent: hasSessionCookie(request, config)
      });
      deps.logAuthEvent(failureEvent.event, {
        category: failureEvent.category,
        requestId,
        outcome: "failure"
      });
      const response = errorEnvelope(401, "UNAUTHORIZED", "Authentication is required.", requestId);
      for (const cookie of buildClearCookieHeaders(request, config, false)) {
        response.headers.append("Set-Cookie", cookie);
      }
      appendSinkCookies(response, sink);
      return response;
    }
    deps.logAuthEvent("auth.dependency_failed", {
      category: "dependency",
      requestId,
      outcome: "failure"
    });
    const response = errorEnvelope(500, "INTERNAL_ERROR", "Authentication service unavailable.", requestId);
    // Preserve cookies already produced by rolling/rotation for this valid session.
    for (const cookie of rollingCookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    appendSinkCookies(response, sink);
    logRotationIfProduced(deps.logAuthEvent, requestId, rollingCookies, sink.headers.getSetCookie?.() ?? []);
    return response;
  }

  if (!accessToken) {
    const response = errorEnvelope(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    for (const cookie of buildClearCookieHeaders(request, config, false)) {
      response.headers.append("Set-Cookie", cookie);
    }
    appendSinkCookies(response, sink);
    return response;
  }

  // 6. Build forwarded headers from the allowlist; attach the Bearer token server-side.
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (ALLOWED_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.delete("content-length"); // let fetch compute it from the body

  // 7. Forward to the Backend.
  let backendResponse: Response;
  try {
    backendResponse = await deps.fetch(backendUrl.toString(), {
      method,
      headers,
      body: isMutation ? body : undefined,
      cache: "no-store"
    });
  } catch {
    // Backend unreachable. Never drop rolling/rotation cookies already produced by the SDK.
    const response = errorEnvelope(502, "INTERNAL_ERROR", "Backend service unavailable.", requestId);
    for (const cookie of rollingCookies) {
      response.headers.append("Set-Cookie", cookie);
    }
    appendSinkCookies(response, sink);
    logRotationIfProduced(deps.logAuthEvent, requestId, rollingCookies, sink.headers.getSetCookie?.() ?? []);
    return response;
  }

  // 8. A Backend 401 (after the BFF attached the server-side Bearer token) means the
  //    Backend observed an invalid/expired/wrong-issuer/wrong-audience/bad-signature/
  //    revoked token. Invalidate the local session: stable envelope + clearing of the
  //    session main cookie, chunks and SDK legacy cookies. Rolling/rotation cookies are
  //    intentionally NOT re-appended — they would resurrect the invalidated session.
  if (backendResponse.status === 401) {
    // Backend token verification failure — distinct from renewal rejection: the BFF's
    // own session renewal succeeded; the Backend observed an unusable token.
    deps.logAuthEvent("auth.verification_failed", {
      category: "verification_failed",
      requestId,
      outcome: "failure"
    });
    const response = errorEnvelope(401, "UNAUTHORIZED", "Session is no longer valid.", requestId);
    for (const cookie of buildClearCookieHeaders(request, config, false)) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  }

  // 9. Assemble the response: safe Backend headers (no Set-Cookie) + SDK cookies.
  //    Rolling cookies first, rotation cookies last: if the token set was rotated the
  //    rotation carries the newer session and wins in Set-Cookie order.
  const responseHeaders = new Headers();
  for (const [key, value] of backendResponse.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey !== "set-cookie" && lowerKey !== "transfer-encoding" && lowerKey !== "connection") {
      responseHeaders.set(key, value);
    }
  }
  responseHeaders.set("Cache-Control", "no-store");

  const response = new NextResponse(backendResponse.body, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders
  });
  for (const cookie of rollingCookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  appendSinkCookies(response, sink);
  logRotationIfProduced(deps.logAuthEvent, requestId, rollingCookies, sink.headers.getSetCookie?.() ?? []);
  return response;
}
