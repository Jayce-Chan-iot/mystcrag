import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client, generateRequestId } from "../../../src/features/auth/server/auth0-server";

export const dynamic = "force-dynamic";

/**
 * GET /auth/callback — OAuth 2.0 Authorization Code + PKCE callback.
 *
 * Delegates to the Auth0 SDK middleware for code exchange and session creation.
 * Wraps the call to classify errors:
 * - Authentication failures (state/nonce/PKCE/code/provider denial/replay) → 401
 * - Infrastructure failures (provider/JWKS/dependency) → 500
 *
 * Never logs raw error details, code, state, nonce, verifier, claims, or tokens.
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId();

  try {
    const auth0Client = getAuth0Client();
    const response = await auth0Client.middleware(request);

    // If the SDK returns an error in the response, classify it
    if (response.status >= 400) {
      // Check if this is an authentication failure (401-class) or infrastructure (500-class)
      const isAuthError = isAuthenticationError(request);

      if (isAuthError) {
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

    // Success — the SDK has set session cookies in the response.
    // Add cache control and requestId headers.
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Pragma", "no-cache");

    return response;
  } catch {
    // Exception during middleware processing.
    // Classify based on request parameters (without logging them).
    const hasErrorParam = request.nextUrl.searchParams.has("error");
    const hasErrorDescription = request.nextUrl.searchParams.has("error_description");

    if (hasErrorParam || hasErrorDescription) {
      // Provider returned an error — authentication failure
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication failed.", requestId } },
        { status: 401, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
      );
    }

    // Infrastructure failure (JWKS, session creation, etc.)
    console.error("Auth0 callback processing failed");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Authentication service error.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
    );
  }
}

/**
 * Checks if the callback request contains provider error parameters
 * indicating an authentication failure (as opposed to infrastructure failure).
 * Does NOT log or expose the actual error values.
 */
function isAuthenticationError(request: NextRequest): boolean {
  const params = request.nextUrl.searchParams;
  // Auth0 returns error/error_description for authentication failures
  return params.has("error") || params.has("error_description");
}
