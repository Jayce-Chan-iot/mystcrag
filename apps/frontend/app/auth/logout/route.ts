import { NextRequest } from "next/server";
import type { AuthConfig } from "../../../src/features/auth/model/auth-config";
import { getAuthConfig, generateRequestId } from "../../../src/features/auth/server/auth0-server";
import { handleLogoutGet, handleLogoutPost, type LogoutDeps } from "../../../src/features/auth/server/logout";
import { logAuthEvent } from "../../../src/features/auth/server/auth-events";
import { detectAuthMode, handleDesktopLogoutRequest } from "../../../src/features/auth/server/runtime-auth";

export const dynamic = "force-dynamic";

/**
 * /auth/logout — explicit Contract wrapper around the logout flow.
 *
 * Thin adapter: the full contract logic (exact Origin validation, real SDK cookie
 * cleanup, 303 See Other to the server-constructed Auth0 logout URL, idempotence)
 * lives in `src/features/auth/server/logout.ts` so it is unit-testable.
 *
 * GET never mutates session state (405). POST performs the logout; the client keeps a
 * top-level POST form navigation and the browser follows the 303 to Auth0.
 *
 * Desktop mode routes to `handleDesktopLogoutRequest`: it still enforces exact Origin
 * but never touches Auth0, never sets cookies and returns a controlled no-store result.
 */

const deps: LogoutDeps = {
  getConfig: () => getAuthConfig(),
  generateRequestId,
  logAuthEvent
};

export async function GET() {
  return handleLogoutGet(deps);
}

export async function POST(request: NextRequest) {
  let config: AuthConfig;
  try {
    config = getAuthConfig();
  } catch {
    return handleLogoutPost(request, deps);
  }
  if (detectAuthMode(config) === "desktop") {
    return handleDesktopLogoutRequest(request, config, deps);
  }
  return handleLogoutPost(request, deps);
}
