import { NextRequest } from "next/server";
import { getAuth0Client, generateRequestId } from "../../../src/features/auth/server/auth0-server";
import { handleLoginRequest, type LoginDeps } from "../../../src/features/auth/server/login";
import { logAuthEvent } from "../../../src/features/auth/server/auth-events";

export const dynamic = "force-dynamic";

/**
 * GET /auth/login — interactive login initiation.
 *
 * Thin adapter: the full contract logic (server-validated returnTo, open-redirect
 * rejection logging with the response requestId, configuration/SDK dependency failure
 * failing closed with a stable 500 envelope, no-store caching) lives in
 * `src/features/auth/server/login.ts` so it is unit-testable. A getAuth0Client()
 * configuration failure surfaces as a thrown dependency inside startInteractiveLogin
 * and fails closed there.
 */

const deps: LoginDeps = {
  startInteractiveLogin: (options) => getAuth0Client().startInteractiveLogin(options),
  generateRequestId,
  logAuthEvent
};

export async function GET(request: NextRequest) {
  return handleLoginRequest(request, deps);
}
