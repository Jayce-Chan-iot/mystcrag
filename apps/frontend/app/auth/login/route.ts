import { NextRequest } from "next/server";
import type { AuthConfig } from "../../../src/features/auth/model/auth-config";
import { getAuth0Client, getAuthConfig, generateRequestId } from "../../../src/features/auth/server/auth0-server";
import { handleLoginRequest, type LoginDeps } from "../../../src/features/auth/server/login";
import { logAuthEvent } from "../../../src/features/auth/server/auth-events";
import { detectAuthMode, handleDesktopLoginRequest } from "../../../src/features/auth/server/runtime-auth";

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
  let config: AuthConfig;
  try {
    config = getAuthConfig();
  } catch {
    return handleLoginRequest(request, deps);
  }
  if (detectAuthMode(config) === "desktop") {
    return handleDesktopLoginRequest(request, config, {
      generateRequestId,
      logAuthEvent
    });
  }
  return handleLoginRequest(request, deps);
}
