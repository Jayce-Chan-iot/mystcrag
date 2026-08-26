import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client, projectSessionState, generateRequestId } from "../../../src/features/auth/server/auth0-server";

export const dynamic = "force-dynamic";

/**
 * GET /auth/session — Safe session projection endpoint.
 *
 * Contract:
 * - unauthenticated/expired/malformed cookie → 200 + {"authenticated": false}
 * - dependency failure (decryption, SDK error) → 500 + INTERNAL_ERROR envelope
 *   (MUST NOT return authenticated:false to fake anonymity)
 * - Never returns: issuer, subject, audience, actorId, session id, tokens, or raw claims
 * - idleExpiresAt is derived from real session/rolling state, capped by absoluteExpiresAt
 * - absoluteExpiresAt is derived from real createdAt + absoluteDuration
 * - Response always has Cache-Control: no-store
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId();

  let session;
  try {
    const auth0Client = getAuth0Client();
    session = await auth0Client.getSession(request);
  } catch {
    // Dependency failure (cookie decryption, SDK internal error).
    // MUST return 500 — do NOT fake anonymity.
    console.error("Session retrieval failed");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Session service unavailable.", requestId } },
      { status: 500, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } }
    );
  }

  // No session or null session → unauthenticated
  const projected = projectSessionState(session);

  return NextResponse.json(projected, {
    headers: {
      "Cache-Control": "no-store",
      "Pragma": "no-cache"
    }
  });
}
