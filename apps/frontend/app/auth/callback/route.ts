import { NextRequest } from "next/server";
import { getAuth0Client, generateRequestId } from "../../../src/features/auth/server/auth0-server";
import { handleCallback, type CallbackDeps } from "../../../src/features/auth/server/callback";

export const dynamic = "force-dynamic";

/**
 * GET /auth/callback — OAuth 2.0 Authorization Code + PKCE callback.
 *
 * Thin adapter: the full contract logic (401 vs 500 classification from the typed SDK
 * error code, real 303 on success, SDK Set-Cookie preservation, no-store caching) lives
 * in `src/features/auth/server/callback.ts` so it is unit-testable.
 */

const deps: CallbackDeps = {
  middleware: (request) => getAuth0Client().middleware(request),
  generateRequestId
};

export async function GET(request: NextRequest) {
  return handleCallback(request, deps);
}
