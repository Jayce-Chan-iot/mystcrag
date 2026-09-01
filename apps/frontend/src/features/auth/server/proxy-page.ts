/**
 * Page-navigation SDK middleware handling for the Next.js 16 network boundary.
 *
 * Frozen contract (fail closed):
 * - Any failure of getAuth0Client()/configuration resolution or of the SDK middleware
 *   during a page navigation returns a stable HTTP 500 with the unified error envelope
 *   `{error:{code:"INTERNAL_ERROR",message,requestId}}`, Cache-Control: no-store and
 *   Pragma: no-cache. It is NEVER `NextResponse.next()` — a page request must not enter
 *   the application behind a broken session/configuration dependency.
 * - The 500 response carries no Set-Cookie: existing cookies are neither cleared nor
 *   overwritten (they might still be valid after a transient outage).
 * - The failure emits a privacy-safe auth.dependency_failed event; no raw error, URL
 *   query, cookie, token, or claim is ever logged.
 * - On success the SDK middleware response is returned unchanged; when it actually
 *   produced rolling Set-Cookie, auth.session_rotation is emitted.
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthEventLogger } from "./auth-events";

export type ProxyPageDeps = {
  /**
   * Runs the SDK middleware for a page navigation. Must throw on configuration or SDK
   * failure (the caller fails closed with 500).
   */
  middleware(request: NextRequest): Promise<Response>;
  generateRequestId(): string;
  /** Privacy-safe auth event logging (whitelisted fields only). */
  logAuthEvent: AuthEventLogger;
};

export async function handleProxyPageRolling(
  request: NextRequest,
  deps: ProxyPageDeps
): Promise<Response> {
  const requestId = deps.generateRequestId();

  let sdkResponse: Response;
  try {
    sdkResponse = await deps.middleware(request);
  } catch {
    // Session/config dependency failure — fail closed. Never pass the request through
    // to the application, never clear or overwrite cookies, never log raw error
    // details (may contain tokens or claims).
    deps.logAuthEvent("auth.dependency_failed", {
      category: "dependency",
      requestId,
      outcome: "failure"
    });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Page temporarily unavailable.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
    );
  }

  if ((sdkResponse.headers.getSetCookie?.() ?? []).length > 0) {
    deps.logAuthEvent("auth.session_rotation", {
      category: "session_rotation",
      requestId,
      outcome: "success"
    });
  }
  return sdkResponse;
}
