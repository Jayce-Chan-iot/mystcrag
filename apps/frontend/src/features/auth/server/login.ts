/**
 * GET /auth/login — interactive login initiation.
 *
 * Frozen contract:
 * - The returnTo parameter is validated server-side (same-origin relative paths only);
 *   a rejected returnTo falls back to "/" and emits auth.open_redirect_rejected carrying
 *   the SAME requestId as the response — never the raw returnTo value.
 * - Configuration/SDK initialization failures (getAuth0Client throwing during
 *   startInteractiveLogin) fail closed with a stable 500 INTERNAL_ERROR envelope and a
 *   privacy-safe auth.dependency_failed event. The single generated requestId is shared
 *   by the response envelope and the structured log record.
 * - No raw error detail, token, or claim ever reaches the response or the log.
 * - Every response keeps Cache-Control: no-store and Pragma: no-cache.
 */

import { NextRequest, NextResponse } from "next/server";
import { isReturnToRejected, validateReturnTo } from "../model/return-to";
import type { AuthEventLogger } from "./auth-events";

export type LoginDeps = {
  /**
   * Starts the SDK interactive login. Must throw on configuration/SDK initialization
   * failure (the caller fails closed with 500).
   */
  startInteractiveLogin(options: { returnTo: string }): Promise<Response>;
  generateRequestId(): string;
  /** Privacy-safe auth event logging (whitelisted fields only). */
  logAuthEvent: AuthEventLogger;
};

export async function handleLoginRequest(request: NextRequest, deps: LoginDeps): Promise<Response> {
  // One requestId for both the response envelope and any structured log record.
  const requestId = deps.generateRequestId();

  const rawReturnTo = request.nextUrl.searchParams.get("returnTo");
  const returnTo = validateReturnTo(rawReturnTo);
  if (isReturnToRejected(rawReturnTo)) {
    // A malicious/malformed returnTo was sanitized to the safe fallback. Log the
    // rejection with the requestId only — never the raw value itself.
    deps.logAuthEvent("auth.open_redirect_rejected", {
      category: "open_redirect",
      requestId,
      outcome: "failure"
    });
  }

  let redirectResponse: Response;
  try {
    redirectResponse = await deps.startInteractiveLogin({ returnTo });
  } catch {
    // Configuration/SDK dependency failure. Do NOT log raw error details (may contain
    // tokens or claims).
    deps.logAuthEvent("auth.dependency_failed", {
      category: "dependency",
      requestId,
      outcome: "failure"
    });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Authentication service unavailable.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
    );
  }

  // Prevent caching of auth redirects.
  redirectResponse.headers.set("Cache-Control", "no-store");
  redirectResponse.headers.set("Pragma", "no-cache");
  return redirectResponse;
}
